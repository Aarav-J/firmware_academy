import { GPIOPinState, Simulator } from 'rp2040js';
import type { SimulatorMessage, TraceEvent } from '../contracts';
import { QSPIControlPeripheral } from './qspi';
import { FlashSSIPeripheral, XIPControlPeripheral } from './flash';
import { UARTControlPeripheral } from './uart';

const TRACE_LIMIT = 4096;
const UART_CHUNK_BYTES = 512;
const BUTTON_PIN = 14;

/** One freshly powered RP2040. Scheduling belongs exclusively to the worker. */
export class RP2040Simulation {
  private readonly simulator = new Simulator();
  readonly mcu = this.simulator.rp2040;
  readonly clock = this.simulator.clock;
  private readonly pins = new Array<number>(30).fill(0);
  private readonly trace = new Array<TraceEvent | undefined>(TRACE_LIMIT);
  private traceOverflow = false;
  private traceCount = 0;
  private readonly uartBuffers = [new Uint8Array(UART_CHUNK_BYTES), new Uint8Array(UART_CHUNK_BYTES)];
  private readonly uartLengths = [0, 0];
  private readonly uartTimes = [0, 0];
  private readonly decoders = [new TextDecoder(), new TextDecoder()];
  private buttonPressed = false;

  constructor(flash: Uint8Array, bootrom: Uint32Array) {
    if (bootrom.byteLength !== 16384 || bootrom[0] !== 0x20041f00) {
      throw new Error('The RP2040 B1 boot ROM asset is missing or corrupt.');
    }
    this.mcu.logger = {
      debug: () => {},
      info: () => {},
      warn: (component, message) => {
        // Unsupported instructions must never silently execute as NOPs.
        throw new Error(`${component}: ${message}`);
      },
      error: (component, message) => {
        throw new Error(`${component}: ${message}`);
      },
    };
    this.mcu.onBreak = (code) => {
      throw new Error(`CPU breakpoint/undefined instruction ${code} at 0x${this.mcu.core.PC.toString(16)}.`);
    };
    const flashSSI = new FlashSSIPeripheral(this.mcu, this.mcu.peripherals[0x18000]);
    this.mcu.peripherals[0x18000] = flashSSI;
    this.mcu.peripherals[0x14000] = new XIPControlPeripheral(this.mcu, 'XIP_CTRL');
    this.mcu.peripherals[0x40018] = new QSPIControlPeripheral(this.mcu, (high) => flashSSI.chipSelect(high));
    this.mcu.peripherals[0x40034] = new UARTControlPeripheral(this.mcu, 0);
    this.mcu.peripherals[0x40038] = new UARTControlPeripheral(this.mcu, 1);
    this.mcu.loadBootrom(bootrom);
    this.mcu.flash.set(flash);
    // ROM flash_init_spi selects slave 0 before handing control to boot2.
    flashSSI.writeUint32(0x10, 1);
    // Match the official rp2040js runner: execute the real flash boot2, retaining
    // ROM vectors and routines. Full ROM SSI flash discovery/USB boot is not modelled.
    this.mcu.core.PC = 0x10000000;

    for (const pin of this.mcu.gpio) {
      pin.addListener((state) => {
        // Feed the resolved pad level back into SIO/PIO and GPIO interrupts.
        // GPIO14 has a physical external pull-up independent of firmware pulls.
        const high = pin.index === BUTTON_PIN && this.buttonPressed
          ? false
          : state === GPIOPinState.High || (state !== GPIOPinState.Low &&
            (pin.index === BUTTON_PIN || state === GPIOPinState.InputPullUp));
        const level = high ? 1 : 0;
        if (this.pins[pin.index] !== level) {
          pin.setInputValue(high);
          this.pins[pin.index] = level;
          this.enqueue({ type: 'pin', timeUs: this.timeUs, pin: pin.index, level });
        }
      });
    }
    this.mcu.gpio[BUTTON_PIN].setInputValue(true);
    this.pins[BUTTON_PIN] = 1;
    this.enqueue({ type: 'pin', timeUs: 0, pin: BUTTON_PIN, level: 1 });
    for (let port = 0; port < this.mcu.uart.length; port++) {
      this.mcu.uart[port].onByte = (byte) => {
        if (this.uartLengths[port] === 0) this.uartTimes[port] = this.timeUs;
        this.uartBuffers[port][this.uartLengths[port]++] = byte;
        if (this.uartLengths[port] === UART_CHUNK_BYTES) this.flushUART(port);
      };
    }
  }

  get timeUs() {
    return this.clock.micros;
  }

  setButton(pressed: boolean) {
    if (this.buttonPressed === pressed) return;
    this.buttonPressed = pressed;
    const pin = this.mcu.gpio[BUTTON_PIN];
    const high = !pressed && (!pin.outputEnable || pin.outputValue);
    const level = high ? 1 : 0;
    if (this.pins[BUTTON_PIN] !== level) {
      pin.setInputValue(high);
      this.pins[BUTTON_PIN] = level;
      this.enqueue({ type: 'pin', timeUs: this.timeUs, pin: BUTTON_PIN, level });
    }
  }

  /** Advance CPU cycles and real peripheral alarms, bounded in wall time and instructions. */
  step(targetUs: number, wallBudgetMs = 6) {
    if (this.traceOverflow) throw new Error('Trace capacity exceeded; reset before running again.');
    const deadline = performance.now() + wallBudgetMs;
    const targetNanos = targetUs * 1000;
    let instructions = 0;
    while (this.clock.nanos < targetNanos && instructions < 100_000) {
      if ((instructions & 255) === 0 && performance.now() >= deadline) break;
      if (this.mcu.core.waiting) {
        const nextAlarm = this.clock.nanosToNextAlarm;
        const remaining = targetNanos - this.clock.nanos;
        // With no alarm, a sleeping CPU remains asleep but external time progresses.
        this.clock.tick(nextAlarm > 0 ? Math.min(nextAlarm, remaining) : remaining);
      } else {
        const cycles = this.mcu.core.executeInstruction();
        if (!Number.isFinite(cycles) || cycles <= 0 || !Number.isFinite(this.mcu.clkSys) || this.mcu.clkSys <= 0) {
          throw new Error('RP2040 returned an invalid CPU cycle count or system clock.');
        }
        this.clock.tick(cycles * (1e9 / this.mcu.clkSys));
      }
      instructions++;
    }
  }

  frame(): Extract<SimulatorMessage, { type: 'frame' }> {
    if (!this.traceOverflow) {
      this.flushUART(0);
      this.flushUART(1);
    }
    const events = new Array<TraceEvent>(this.traceCount);
    for (let index = 0; index < events.length; index++) {
      events[index] = this.trace[index]!;
      this.trace[index] = undefined;
    }
    this.traceCount = 0;
    // UART chunks carry their first byte's timestamp and can span pin transitions.
    events.sort((a, b) => a.timeUs - b.timeUs);
    return { type: 'frame', timeUs: this.timeUs, pins: this.pins.slice(), events };
  }

  private flushUART(port: number) {
    const length = this.uartLengths[port];
    if (!length) return;
    const text = this.decoders[port].decode(this.uartBuffers[port].subarray(0, length), { stream: true });
    this.uartLengths[port] = 0;
    if (text) this.enqueue({ type: 'uart_tx', timeUs: this.uartTimes[port], port, text });
  }

  private enqueue(event: TraceEvent) {
    if (this.traceCount === TRACE_LIMIT) {
      this.traceOverflow = true;
      throw new Error('Trace capacity exceeded (4096 pending events). Simulation stopped to preserve timeline accuracy; reset before running again.');
    }
    this.trace[this.traceCount++] = event;
  }
}
