#!/usr/bin/env python3
"""Execute trusted source-built firmware in an isolated Renode instance and assert observable behavior."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.stm32'


class Monitor:
    def __init__(self, connection):
        self.connection = connection
        self.read_prompt()

    def read_prompt(self):
        output = bytearray()
        while True:
            chunk = self.connection.recv(65536)
            if not chunk:
                raise RuntimeError('Renode monitor disconnected')
            # Renode's TCP monitor is Telnet: decline options, retaining text only.
            index = 0
            while index < len(chunk):
                if chunk[index] == 255 and index + 2 < len(chunk):
                    verb, option = chunk[index + 1:index + 3]
                    if verb in (253, 251):
                        self.connection.sendall(bytes([255, 252 if verb == 253 else 254, option]))
                    index += 3
                else:
                    output.append(chunk[index])
                    index += 1
            text = output.decode('utf-8', 'replace')
            if re.search(r'\([^\r\n]*\) $', text):
                return re.sub(r'\x1b\[[0-9;?]*[A-Za-z]', '', text)

    def command(self, value):
        self.connection.sendall((value + '\r').encode())
        result = self.read_prompt()
        if any(marker in result for marker in ['There was an error', 'Could not execute command', 'No such command', 'Error while']):
            raise RuntimeError(result)
        return result

    def boolean(self, value):
        result = self.command(value)
        states = re.findall(r'\b(True|False)\b', result)
        if not states:
            raise AssertionError(result)
        return states[-1] == 'True'

    def register(self, address):
        result = self.command(f'sysbus ReadDoubleWord 0x{address:x}')
        values = re.findall(r'0x[0-9a-fA-F]+', result)
        if len(values) < 2:
            raise AssertionError(result)
        return int(values[-1], 16)


def free_port():
    with socket.socket() as reservation:
        reservation.bind(('127.0.0.1', 0))
        return reservation.getsockname()[1]


def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--firmware', choices=['baremetal', 'zephyr', 'both'], default='both')
    parser.add_argument('--renode', default=os.environ.get('RENODE', shutil.which('renode') or '/Applications/Renode.app/Contents/MacOS/renode'))
    parser.add_argument('--skip-gdb', action='store_true', help='Only verify firmware behavior, not debugger stepping')
    arguments = parser.parse_args()
    CACHE.mkdir(exist_ok=True)
    names = ['baremetal', 'zephyr'] if arguments.firmware == 'both' else [arguments.firmware]
    images = {name: CACHE / ('baremetal.elf' if name == 'baremetal' else 'zephyr-build/zephyr/zephyr.elf') for name in names}
    for name, image in images.items():
        if not image.is_file():
            raise SystemExit(f'Missing {image}; run scripts/setup-stm32-proof.py and scripts/setup-zephyr-proof.py first.')
    port = free_port()
    report = {'renode': arguments.renode, 'targets': {}}
    report['coverage'] = 'GPIO PD12 blink via SysTick, PA0 polled input to PD13, UART2, bare-metal ARM debugger'
    report['limitations'] = [
        'Trusted local proof programs only; not a sandboxed multi-user execution service.',
        'HSI and modeled SysTick explicitly set to 16 MHz; general-purpose timers retain stock model clocks.',
        'Button is polled, not an external-interrupt validation; no analog or cycle-exact silicon claim.',
        'Zephyr startup touches partially modeled fault-status, flash-cache and debug-control registers; warnings remain visible.',
        'No physical board, flashing, or browser integration is exercised by this proof.',
    ]
    log_path = CACHE / 'renode-proof.log'
    with log_path.open('w') as log:
        process = subprocess.Popen([arguments.renode, '--disable-gui', '--plain', '--port', str(port)], stdout=log, stderr=subprocess.STDOUT, cwd=ROOT)
        connection = None
        try:
            deadline = time.monotonic() + 20
            while connection is None:
                if process.poll() is not None:
                    raise RuntimeError(log_path.read_text())
                try:
                    connection = socket.create_connection(('127.0.0.1', port), timeout=1)
                except OSError:
                    if time.monotonic() >= deadline:
                        raise RuntimeError('Renode did not open its monitor; inspect .stm32/renode-proof.log')
                    # Process readiness polling, not a firmware timing assertion.
                    time.sleep(0.05)
            connection.settimeout(30)
            monitor = Monitor(connection)
            for name, image in images.items():
                monitor.command(f'mach create "proof-{name}"')
                monitor.command(f'machine LoadPlatformDescription "{ROOT / "proofs/stm32/board.repl"}"')
                monitor.command('cpu PerformanceInMips 80')
                monitor.command(f'sysbus LoadELF "{image}"')
                uart = CACHE / f'{name}-proof-uart.log'
                if uart.exists():
                    uart.unlink()
                monitor.command(f'sysbus.usart2 CreateFileBackend "{uart}" true')
                samples = []
                # Absolute times are virtual time; no real-time sleeps prove firmware behavior.
                for duration in ['0.60', '0.50', '0.50']:
                    monitor.command(f'emulation RunFor "{duration}"')
                    samples.append(monitor.boolean('sysbus.gpioPortD.UserLED State'))
                assert samples == [True, False, True], f'{name}: invalid LED sequence {samples}'
                assert not monitor.boolean('sysbus.gpioPortD.ButtonLED State'), f'{name}: button initially pressed'
                monitor.command('sysbus.gpioPortA.UserButton Press')
                monitor.command('emulation RunFor "0.020"')
                assert monitor.boolean('sysbus.gpioPortD.ButtonLED State'), f'{name}: button press not handled'
                pressed_odr = monitor.register(0x40020c14)
                assert pressed_odr & 0x2000, f'{name}: PD13 output not high'
                monitor.command('sysbus.gpioPortA.UserButton Release')
                monitor.command('emulation RunFor "0.020"')
                assert not monitor.boolean('sysbus.gpioPortD.ButtonLED State'), f'{name}: release not handled'
                released_odr = monitor.register(0x40020c14)
                assert not released_odr & 0x2000, f'{name}: PD13 output not low'
                monitor.command(f'sysbus.usart2 CloseFileBackend "{uart}"')
                serial = uart.read_text()
                banner = 'Bare-metal STM32 proof ready' if name == 'baremetal' else 'Zephyr STM32 proof ready'
                for expected in [banner, 'LED on', 'LED off', 'Button pressed', 'Button released']:
                    assert expected in serial, f'{name}: UART missing {expected!r}: {serial!r}'
                result = {'elf_sha256': hashlib.sha256(image.read_bytes()).hexdigest(), 'led_at_0_6_1_1_1_6_seconds': samples, 'button_press_odr': hex(pressed_odr), 'button_release_odr': hex(released_odr), 'uart': serial, 'gpio_mode': hex(monitor.register(0x40020c00))}
                report['targets'][name] = result
                print(f'PASS {name}: source-built firmware blink, button, UART and GPIO registers')
                monitor.command('mach clear')

            if 'baremetal' in images and not arguments.skip_gdb:
                debugger = shutil.which('arm-none-eabi-gdb')
                if not debugger:
                    raise RuntimeError('arm-none-eabi-gdb is required for register/step proof; --skip-gdb explicitly limits coverage')
                debug_port = free_port()
                monitor.command('mach create "proof-debug"')
                monitor.command(f'machine LoadPlatformDescription "{ROOT / "proofs/stm32/board.repl"}"')
                monitor.command(f'sysbus LoadELF "{images["baremetal"]}"')
                monitor.command(f'machine StartGdbServer {debug_port} true')
                inspected = subprocess.run([debugger, '--batch', str(images['baremetal']), '-ex', f'target remote 127.0.0.1:{debug_port}', '-x', str(ROOT / 'proofs/stm32/inspect.gdb')], capture_output=True, text=True, timeout=30)
                (CACHE / 'gdb-proof.log').write_text(inspected.stdout + inspected.stderr)
                assert inspected.returncode == 0 and 'REGISTER_STEP_PROOF_PASS' in inspected.stdout, inspected.stdout + inspected.stderr
                report['debugger'] = {'breakpoint_and_instruction_step': True, 'transcript': str(CACHE / 'gdb-proof.log')}
                print('PASS debugger: breakpoint, ARM registers, instruction stepping and GPIO output 0x0 -> 0x1000')
                monitor.command('pause')
                assert monitor.boolean('sysbus.gpioPortD.UserLED State'), 'Debugger MMIO write did not drive actual LED'
            connection.sendall(b'quit\r')
            process.wait(timeout=5)
        finally:
            if connection is not None:
                connection.close()
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
    report['renode_warnings'] = [line for line in log_path.read_text().splitlines() if '[WARNING]' in line or '[ERROR]' in line]
    report_path = CACHE / 'proof-results.json'
    report_path.write_text(json.dumps(report, indent=2) + '\n')
    print(f'Evidence: {report_path}')


if __name__ == '__main__':
    run()
