#!/usr/bin/env python3
"""Build trusted bare-metal proof firmware and generate absolute-path Renode launchers."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / '.stm32'


def generate_launchers():
    for name, elf in [('baremetal', CACHE / 'baremetal.elf'), ('zephyr', CACHE / 'zephyr-build/zephyr/zephyr.elf')]:
        if not elf.is_file():
            continue
        # Quoted monitor paths support repository locations containing spaces.
        script = '\n'.join([
            f'mach create "stm32-{name}"',
            f'machine LoadPlatformDescription "{ROOT / "proofs/stm32/board.repl"}"',
            'cpu PerformanceInMips 80',
            f'sysbus LoadELF "{elf}"',
            'showAnalyzer sysbus.usart2',
            'logLevel -1 sysbus.gpioPortD.UserLED',
            'logLevel -1 sysbus.gpioPortD.ButtonLED',
            'start',
            '',
        ])
        launcher = CACHE / f'{name}.resc'
        launcher.write_text(script)
        print(f'Renode Monitor: include @{launcher}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--launchers-only', action='store_true', help='Regenerate launchers after the Zephyr build')
    options = parser.parse_args()
    CACHE.mkdir(exist_ok=True)
    if not options.launchers_only:
        compiler = shutil.which(os.environ.get('ARM_CC', 'arm-none-eabi-gcc'))
        if not compiler:
            raise SystemExit('Install Arm GNU Toolchain and put arm-none-eabi-gcc on PATH, or set ARM_CC.')
        subprocess.run([
            compiler, '-mcpu=cortex-m4', '-mthumb', '-mfloat-abi=soft', '-Og', '-g3',
            '-ffreestanding', '-fno-builtin', '-nostdlib', '-Wall', '-Wextra', '-Werror',
            '-T', str(ROOT / 'proofs/stm32/baremetal/linker.ld'),
            '-Wl,--build-id=none', f'-Wl,-Map={CACHE / "baremetal.map"}',
            str(ROOT / 'proofs/stm32/baremetal/main.c'), '-o', str(CACHE / 'baremetal.elf'),
        ], check=True, cwd=ROOT)
        print(f'Built {CACHE / "baremetal.elf"}')
    generate_launchers()


if __name__ == '__main__':
    main()
