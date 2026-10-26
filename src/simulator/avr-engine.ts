/**
 * ATmega328P simulation engine using avr8js.
 *
 * Peripheral wiring (Arduino Uno pin numbering):
 *   Pin 13 = PB5 — onboard LED, active-high output
 *   Pin  2 = PD2 — external active-low button (INT0), pulled up externally
 *   USART0  — Serial.begin()/print() at 9600 or 57600 baud (firmware configures)
 *
 * CPU clock: 16 MHz  →  16 cycles per microsecond
 * Flash: 32 KB  |  SRAM: 2 KB  (ATmega328P spec)
 */

import {
  AVRADC,
  AVRIOPort,
  AVRTWI,
  AVRTimer,
  AVRUSART,
  CPU,
  PinState,
  adcConfig,
  avrInstruction,
  portBConfig,
  portCConfig,
  portDConfig,
  timer0Config,
  timer1Config,
  timer2Config,
  twiConfig,
  usart0Config,
} from 'avr8js';
import type { TWIEventHandler } from 'avr8js';
import type { SimulatorMessage, TraceEvent } from '../contracts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const F_CPU = 16_000_000; // Hz
const CYCLES_PER_US = F_CPU / 1_000_000; // 16
const FLASH_SIZE = 32 * 1024; // 32 768 bytes
const SRAM_SIZE = 2048; // 2 KB
const TRACE_LIMIT = 4096;
const UART_CHUNK_BYTES = 512;

/** A fixed 7-bit I2C address for the course's one simulated peripheral — not a real commercial part. */
const I2C_DEVICE_ADDRESS = 0x50;
const I2C_DEVICE_ID = 0x5a;
/** A fixed simulated reading, not a live measurement — documented as such in lesson copy. */
const I2C_FIXED_READING = 164;

/** Responds only to I2C_DEVICE_ADDRESS; any other address is a real, unmodified NACK. */
class SimulatedI2CSensor implements TWIEventHandler {
  private pointer = 0;
  private readonly registers = new Uint8Array([I2C_DEVICE_ID, I2C_FIXED_READING]);
  constructor(private readonly twi: AVRTWI) {}
  start(): void { this.twi.completeStart(); }
  stop(): void { this.twi.completeStop(); }
  connectToSlave(address: number): void { this.twi.completeConnect(address === I2C_DEVICE_ADDRESS); }
  writeByte(value: number): void {
    const ack = value < this.registers.length;
    if (ack) this.pointer = value;
    this.twi.completeWrite(ack);
  }
  readByte(): void {
    this.twi.completeRead(this.registers[this.pointer] ?? 0xff);
    this.pointer = (this.pointer + 1) % this.registers.length;
  }
}
// Arduino digital pin numbering, standard ATmega328P/Uno mapping:
// D0-D7 = PORTD bits 0-7; D8-D13 = PORTB bits 0-5 (6,7 are the crystal);
// A0-A5 = PORTC bits 0-5, numbered 14-19 (6 is reset, 7 unused).
const PORTD_PINS = [0, 1, 2, 3, 4, 5, 6, 7] as const;
const PORTB_PINS = [8, 9, 10, 11, 12, 13] as const;
const PORTC_PINS = [14, 15, 16, 17, 18, 19] as const;

/** Arduino digital pin 2 = PD2 (INT0, active-low button) — driven explicitly via setButton(), not read generically. */
const BUTTON_PIN = 2;
const BUTTON_BIT = 2; // bit index within PORTD

// ---------------------------------------------------------------------------
// Intel HEX parser
// ---------------------------------------------------------------------------

/**
 * Parse an Intel HEX string (arduino-cli .hex output) into a 32 KB flash image.
 * Unwritten bytes are left as 0xFF (erased flash).
 */
export function parseIntelHex(hex: string): Uint8Array {
  const flash = new Uint8Array(FLASH_SIZE).fill(0xff);
  for (const line of hex.split('\n')) {
    const l = line.trim();
    // Minimum valid record: ':LLAAAATTCC' = 11 chars
    if (l.length < 11 || l[0] !== ':') continue;
    const byteCount = parseInt(l.slice(1, 3), 16);
    const addr = parseInt(l.slice(3, 7), 16);
    const recType = parseInt(l.slice(7, 9), 16);
    if (recType === 0x01) break; // EOF record
    if (recType !== 0x00) continue; // skip extended-address and other meta records
    for (let i = 0; i < byteCount; i++) {
      const byte = parseInt(l.slice(9 + i * 2, 11 + i * 2), 16);
      const dest = addr + i;
      if (dest < FLASH_SIZE) flash[dest] = byte;
    }
  }
  return flash;
}

// ---------------------------------------------------------------------------
// Simulation class
// ---------------------------------------------------------------------------

/**
 * One freshly-powered ATmega328P at 16 MHz.
 * Scheduling (the run/pause loop) belongs exclusively to the worker.
 */
export class ATmega328PSimulation {
  // Public for worker to inspect F_CPU or attach additional hooks if needed.
  readonly cpu: CPU;

  private readonly portB: AVRIOPort;
  private readonly portC: AVRIOPort;
  private readonly portD: AVRIOPort;

  /**
   * USART0 peripheral – exposed so the worker (or tests) can call writeByte()
   * to simulate data arriving on the RX pin.
   */
  readonly usart: AVRUSART;

  /** ADC0-ADC5 (A0-A5) channel voltages; set from the UI via setAnalogInput(). */
  private readonly adc: AVRADC;
  private readonly twi: AVRTWI;

  // Timers are required for Arduino millis()/micros()/delay() to function.
  // They register clock-event callbacks on the CPU; cpu.tick() dispatches them.
  private readonly timer0: AVRTimer;
  private readonly timer1: AVRTimer;
  private readonly timer2: AVRTimer;

  // Pin shadow: 20 entries, indexed by Arduino digital pin number.
  // Every pin the firmware actually configures as an output is tracked —
  // not just the onboard LED/button — via the generic attachPort() below.
  private readonly pins = new Array<number>(20).fill(0);

  // Trace ring (pre-allocated, never grown)
  private readonly trace = new Array<TraceEvent | undefined>(TRACE_LIMIT);
  private traceOverflow = false;
  private traceCount = 0;

  // UART accumulator – batch characters into text chunks the way engine.ts does.
  private readonly uartBuffer = new Uint8Array(UART_CHUNK_BYTES);
  private uartLength = 0;
  private uartFirstByteTimeUs = 0;
  private readonly decoder = new TextDecoder();

  private buttonPressed = false;

  constructor(flash: Uint8Array) {
    // avr8js CPU accepts a Uint16Array of 16-bit instruction words.
    // Intel HEX bytes are little-endian: byte[0] is the low byte of word[0].
    const progWords = new Uint16Array(FLASH_SIZE / 2);
    for (let i = 0; i < progWords.length; i++) {
      progWords[i] = flash[i * 2] | (flash[i * 2 + 1] << 8);
    }

    this.cpu = new CPU(progWords, SRAM_SIZE);

    // GPIO ports – construction hooks the read/write hooks into cpu.data[].
    this.portB = new AVRIOPort(this.cpu, portBConfig);
    this.portC = new AVRIOPort(this.cpu, portCConfig);
    this.portD = new AVRIOPort(this.cpu, portDConfig);

    // USART0 – construction hooks UDR/UCSRA-C/UBRR into cpu.writeHooks[].
    this.usart = new AVRUSART(this.cpu, usart0Config, F_CPU);

    // ADC – construction hooks ADMUX/ADCSRA/ADCL/ADCH into cpu.writeHooks[]; channel
    // voltages start at 0 V until the UI (or a test) calls setAnalogInput().
    this.adc = new AVRADC(this.cpu, adcConfig);

    // TWI (I2C) – one fixed simulated peripheral answering only I2C_DEVICE_ADDRESS.
    this.twi = new AVRTWI(this.cpu, twiConfig, F_CPU);
    this.twi.eventHandler = new SimulatedI2CSensor(this.twi);

    // Timers – construction hooks TCCR*/TIMSK*/TCNT*/OCR* into cpu.writeHooks[].
    // All three are required: timer0 drives millis/micros, timer1/2 are used by
    // many libraries and PWM generation.
    this.timer0 = new AVRTimer(this.cpu, timer0Config);
    this.timer1 = new AVRTimer(this.cpu, timer1Config);
    this.timer2 = new AVRTimer(this.cpu, timer2Config);

    // -----------------------------------------------------------------------
    // Every GPIO pin the firmware drives as an output is tracked generically:
    // addListener fires on any PORTx/DDRx/PINx write, attachPort() resolves
    // each bit's output level (skipping bits currently configured as input —
    // avr8js's pinState() can't tell us a floating/externally-driven input
    // level, only that it's not an output) and emits a 'pin' event on change.
    // This is what lets a learner move the LED to any pin, not just D13.
    // -----------------------------------------------------------------------
    this.attachPort(this.portB, PORTB_PINS);
    this.attachPort(this.portC, PORTC_PINS);
    this.attachPort(this.portD, PORTD_PINS);

    // -----------------------------------------------------------------------
    // Pin 2 (PD2 / INT0): active-low external button.
    // We model an external pull-up: released → HIGH, pressed → LOW.
    // setPin() injects the logical value that the firmware reads from the PIN
    // register; it also triggers the INT0 edge-detect logic inside AVRIOPort.
    // -----------------------------------------------------------------------
    this.portD.setPin(BUTTON_BIT, true); // released = HIGH
    this.pins[BUTTON_PIN] = 1;
    this.enqueue({ type: 'pin', timeUs: 0, pin: BUTTON_PIN, level: 1 });

    // -----------------------------------------------------------------------
    // USART0 TX: capture every transmitted byte.
    // onByteTransmit fires synchronously inside the cpu.writeHooks[UDR] path,
    // so timeUs here is accurate to the instruction that wrote to UDR.
    // -----------------------------------------------------------------------
    this.usart.onByteTransmit = (byte: number) => {
      if (this.uartLength === 0) this.uartFirstByteTimeUs = this.timeUs;
      this.uartBuffer[this.uartLength++] = byte;
      if (this.uartLength === UART_CHUNK_BYTES) this.flushUART();
    };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** Simulation time in microseconds, derived from cpu.cycles at 16 MHz. */
  get timeUs(): number {
    return this.cpu.cycles / CYCLES_PER_US;
  }

  /**
   * Drive the external button on PD2 (INT0, active-low).
   * pressed=true → PD2 pulled LOW (INT0 asserted if firmware uses falling/low).
   * pressed=false → PD2 returns HIGH (released).
   */
  setButton(pressed: boolean): void {
    if (this.buttonPressed === pressed) return;
    this.buttonPressed = pressed;
    // Active-low: pressed=false for HIGH (released), pressed=true for LOW.
    this.portD.setPin(BUTTON_BIT, !pressed);
    const level: 0 | 1 = pressed ? 0 : 1;
    if (this.pins[BUTTON_PIN] !== level) {
      this.pins[BUTTON_PIN] = level;
      this.enqueue({ type: 'pin', timeUs: this.timeUs, pin: BUTTON_PIN, level });
    }
  }

  /** Set a simulated analog input voltage (0-5 V) on A0-A5 (Arduino pin 14-19). */
  setAnalogInput(pin: number, voltage: number): void {
    const channel = pin - 14;
    if (channel < 0 || channel > 5) return;
    this.adc.channelValues[channel] = Math.max(0, Math.min(5, voltage));
  }

  /**
   * Advance the simulation toward `targetUs`, bounded by wall-clock budget.
   *
   * Each iteration: execute one AVR instruction (avrInstruction) then dispatch
   * any due clock events (cpu.tick). This matches the canonical avr8js usage
   * pattern and is required for timers and UART baud-rate timing to work.
   *
   * The 100 000 instruction cap prevents a single step from monopolizing
   * the worker thread. The wall-clock check (every 256 iterations) keeps
   * frame delivery timely on slow hosts.
   *
   * SLEEP (opcode 0x9588) is a no-op in avr8js — the CPU continues fetching
   * instructions. Arduino's delay() uses timer-interrupt-driven busy waiting,
   * which works correctly with this loop.
   */
  step(targetUs: number, wallBudgetMs = 6): void {
    if (this.traceOverflow) {
      throw new Error('Trace capacity exceeded; reset before running again.');
    }
    const deadline = performance.now() + wallBudgetMs;
    const targetCycles = Math.floor(targetUs * CYCLES_PER_US);
    let iterations = 0;
    while (this.cpu.cycles < targetCycles && iterations < 100_000) {
      if ((iterations & 255) === 0 && performance.now() >= deadline) break;
      avrInstruction(this.cpu);
      this.cpu.tick();
      iterations++;
    }
  }

  /**
   * Drain the current event trace and return a frame message.
   * Sorts events by timestamp before returning (UART chunk events can span
   * pin transitions, so ordering is not guaranteed by insertion order).
   */
  frame(): Extract<SimulatorMessage, { type: 'frame' }> {
    if (!this.traceOverflow) {
      this.flushUART();
    }
    const events = new Array<TraceEvent>(this.traceCount);
    for (let i = 0; i < events.length; i++) {
      events[i] = this.trace[i]!;
      this.trace[i] = undefined;
    }
    this.traceCount = 0;
    events.sort((a, b) => a.timeUs - b.timeUs);
    return { type: 'frame', timeUs: this.timeUs, pins: this.pins.slice(), events };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private flushUART(): void {
    const length = this.uartLength;
    if (!length) return;
    const text = this.decoder.decode(this.uartBuffer.subarray(0, length), { stream: true });
    this.uartLength = 0;
    if (text) {
      this.enqueue({ type: 'uart_tx', timeUs: this.uartFirstByteTimeUs, port: 0, text });
    }
  }

  /**
   * Listen for any PORTx/DDRx/PINx write on `port` and emit a 'pin' event for
   * every bit whose resolved level actually changed. `pinNumbers[bit]` gives
   * the Arduino digital pin number for that bit; BUTTON_PIN is skipped since
   * it has its own externally-driven path via setButton().
   */
  private attachPort(port: AVRIOPort, pinNumbers: readonly number[]): void {
    port.addListener(() => {
      for (let bit = 0; bit < pinNumbers.length; bit++) {
        const arduinoPin = pinNumbers[bit];
        if (arduinoPin === BUTTON_PIN) continue;
        const state = port.pinState(bit);
        // An input-configured bit has no authoritative driven level here —
        // InputPullUp reads HIGH (matches the internal pull-up), a floating
        // Input is left at its last known value rather than guessed at.
        let level: 0 | 1;
        if (state === PinState.High) level = 1;
        else if (state === PinState.Low) level = 0;
        else if (state === PinState.InputPullUp) level = 1;
        else continue;
        if (this.pins[arduinoPin] !== level) {
          this.pins[arduinoPin] = level;
          this.enqueue({ type: 'pin', timeUs: this.timeUs, pin: arduinoPin, level });
        }
      }
    });
  }

  private enqueue(event: TraceEvent): void {
    if (this.traceCount === TRACE_LIMIT) {
      this.traceOverflow = true;
      throw new Error(
        'Trace capacity exceeded (4096 pending events). Simulation stopped to preserve ' +
          'timeline accuracy; reset before running again.',
      );
    }
    this.trace[this.traceCount++] = event;
  }
}
