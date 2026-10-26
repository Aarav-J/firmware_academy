# Trusted Renode-only instrumentation. This file is never supplied by a project.
import json
from System.Threading import Monitor
from System import Object
from Antmicro.Renode.Time import TimeDomainsManager

_wb_lock = Object()
_wb_events = []
_wb_overflow = False
_wb_machine = self.Machine


def _wb_time():
    return float(_wb_machine.ElapsedVirtualTime.TimeElapsed.TotalMicroseconds)


def _wb_event_time():
    # GPIO/UART callbacks execute on the model's own virtual-time thread.
    return float(TimeDomainsManager.Instance.VirtualTimeStamp.TimeElapsed.TotalMicroseconds)


def _wb_append(event):
    global _wb_overflow
    Monitor.Enter(_wb_lock)
    try:
        if len(_wb_events) < 4096:
            _wb_events.append(event)
        else:
            _wb_overflow = True
    finally:
        Monitor.Exit(_wb_lock)


def _wb_uart(value):
    _wb_append({'type': 'uart_tx', 'timeUs': _wb_event_time(), 'port': 2, 'text': chr(value)})


_wb_machine['sysbus.usart2'].CharReceived += _wb_uart

# Every pin on GPIOA, GPIOB and GPIOD is tracked generically by polling each
# port's IDR (input data register -- on STM32 this always reflects a pin's
# actual current level, whether it's configured as an input or an
# output the firmware is driving) once per RunFor slice and diffing against
# the previous read. This is a strict superset of watching only PA0/PD12/
# PD13 through named aliases: a learner can move the blink to any pin on
# these ports and it shows up live, in the trace, with no extra wiring.
_WB_GPIO_BASE = {'A': 0x40020000, 'B': 0x40020400, 'D': 0x40020C00}
_WB_GPIO_OFFSET = {'A': 0, 'B': 16, 'D': 48}  # matches LIVE_PIN_INDEX in board-pinouts.ts
_WB_IDR_OFFSET = 0x10
_wb_port_shadow = {}


def _wb_poll_ports():
    t = None
    for letter, base in _WB_GPIO_BASE.items():
        value = int(_wb_machine.SystemBus.ReadDoubleWord(base + _WB_IDR_OFFSET)) & 0xFFFF
        previous = _wb_port_shadow.get(letter, value)
        changed = previous ^ value
        if changed:
            if t is None:
                t = _wb_time()
            offset = _WB_GPIO_OFFSET[letter]
            for bit in range(16):
                if changed & (1 << bit):
                    level = (value >> bit) & 1
                    _wb_append({'type': 'pin', 'timeUs': t, 'pin': offset + bit, 'level': int(level)})
        _wb_port_shadow[letter] = value


def wb_drain():
    global _wb_events, _wb_overflow
    _wb_poll_ports()
    Monitor.Enter(_wb_lock)
    try:
        events = _wb_events
        overflow = _wb_overflow
        _wb_events = []
        _wb_overflow = False
    finally:
        Monitor.Exit(_wb_lock)
    pins = [0] * 80
    for letter, offset in _WB_GPIO_OFFSET.items():
        value = _wb_port_shadow.get(letter, 0)
        for bit in range(16):
            pins[offset + bit] = (value >> bit) & 1
    print('WB:' + json.dumps({'timeUs': _wb_time(), 'pins': pins, 'events': events, 'overflow': overflow}))


def wb_registers():
    cpu = _wb_machine['sysbus.cpu']
    names = ['R' + str(i) for i in range(13)] + ['SP', 'LR', 'PC']
    values = dict((name, '0x%08x' % cpu.GetRegister(i).RawValue) for i, name in enumerate(names))
    values['xPSR'] = '0x%08x' % cpu.CPSR.RawValue
    allowed = [('GPIOA_IDR', 0x40020010), ('GPIOD_MODER', 0x40020c00), ('GPIOD_ODR', 0x40020c14),
               ('RCC_CR', 0x40023800), ('RCC_CFGR', 0x40023808), ('USART2_SR', 0x40004400), ('USART2_BRR', 0x40004408)]
    registers = [{'name': name, 'address': '0x%08x' % address, 'value': '0x%08x' % _wb_machine.SystemBus.ReadDoubleWord(address)} for name, address in allowed]
    print('WB:' + json.dumps({'timeUs': _wb_time(), 'cpu': values, 'peripherals': registers}))
