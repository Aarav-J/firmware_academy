import type { BoardPin, BoardKey, BoardPinout, PinKind } from './breadboard-contracts';

// ── Arduino Uno R3 ───────────────────────────────────────────────────────
// ids/labels match UnoBoard.tsx's existing silkscreen-accurate header labels
// exactly, so the real board's pins ARE the wiring targets — no separate
// schematic diagram. A4/A5 double as the I2C bus; D10–D13 double as SPI
// (D13 is also the onboard LED).
const ARDUINO_UNO: BoardPinout = {
  key: 'arduino-uno',
  name: 'Arduino Uno R3',
  logicVoltage: 5,
  headers: [
    {
      name: 'Digital',
      pins: [
        { id: 'RX', label: 'RX', kind: 'uart-rx' },
        { id: 'TX', label: 'TX', kind: 'uart-tx' },
        { id: 'D2', label: '2', kind: 'digital' },
        { id: 'D3', label: '3', kind: 'digital' },
        { id: 'D4', label: '4', kind: 'digital' },
        { id: 'D5', label: '5', kind: 'digital' },
        { id: 'D6', label: '6', kind: 'digital' },
        { id: 'D7', label: '7', kind: 'digital' },
        { id: 'D8', label: '8', kind: 'digital' },
        { id: 'D9', label: '9', kind: 'digital' },
        { id: 'D10', label: '10', kind: 'spi-cs' },
        { id: 'D11', label: '11', kind: 'spi-mosi' },
        { id: 'D12', label: '12', kind: 'spi-miso' },
        { id: 'D13', label: '13', kind: 'spi-sck' },
        { id: 'D-GND', label: 'GND', kind: 'ground' },
        { id: 'D-AREF', label: 'AREF', kind: 'analog' },
        { id: 'SDA', label: 'SDA', kind: 'i2c-sda' },
        { id: 'SCL', label: 'SCL', kind: 'i2c-scl' },
      ],
    },
    {
      name: 'Power/Analog',
      pins: [
        { id: 'VIN', label: 'Vin (external input)', kind: 'power' },
        { id: 'P-GND1', label: 'GND', kind: 'ground' },
        { id: 'P-GND2', label: 'GND', kind: 'ground' },
        { id: '5V', label: '5V', kind: 'power', voltage: 5 },
        { id: '3V3', label: '3V3', kind: 'power', voltage: 3.3 },
        { id: 'RESET', label: 'RESET', kind: 'digital' },
        { id: 'IOREF', label: 'IOREF', kind: 'power', voltage: 5 },
        { id: 'A0', label: 'A0', kind: 'analog' },
        { id: 'A1', label: 'A1', kind: 'analog' },
        { id: 'A2', label: 'A2', kind: 'analog' },
        { id: 'A3', label: 'A3', kind: 'analog' },
        { id: 'A4', label: 'A4', kind: 'i2c-sda' },
        { id: 'A5', label: 'A5', kind: 'i2c-scl' },
      ],
    },
  ],
};

/** Arduino digital-pin-number indices, matching avr-engine.ts's pins[] layout exactly (D0-D13=0-13, A0-A5=14-19). Every one of these is generically tracked — any pin the firmware drives as an output shows up live, not just D13/D2. */
const ARDUINO_LIVE_INDEX: Record<string, number> = {
  RX: 0, TX: 1, D2: 2, D3: 3, D4: 4, D5: 5, D6: 6, D7: 7, D8: 8, D9: 9, D10: 10, D11: 11, D12: 12, D13: 13,
  A0: 14, A1: 15, A2: 16, A3: 17, A4: 18, A5: 19,
  SDA: 18, SCL: 19,
};

// ── STM32F407VG Discovery ────────────────────────────────────────────────
// Every pin on GPIO ports A, B and D is exposed and wireable — not a curated
// subset — because instrumentation.py now polls the full IDR for each port
// every slice, so any pin the firmware drives shows up live. I2C1 (PB6/PB9),
// SPI1 (PA5/PA6/PA7/PA4) and USART2 (PA2/PA3) keep their real alternate-
// function kind; everything else is plain GPIO. PD12/PD13 are the onboard
// LED/button-LED, PA0 the user button — all already modeled.
function stm32Port(letter: 'A' | 'B' | 'D', specialKinds: Partial<Record<number, PinKind>>): BoardPin[] {
  return Array.from({ length: 16 }, (_, bit) => ({ id: `P${letter}${bit}`, label: `P${letter}${bit}`, kind: specialKinds[bit] ?? 'digital' }));
}

const STM32F4_DISCOVERY: BoardPinout = {
  key: 'stm32f4-discovery',
  name: 'STM32F407VG Discovery',
  logicVoltage: 3.3,
  headers: [
    { name: 'PA', pins: stm32Port('A', { 2: 'uart-tx', 3: 'uart-rx', 4: 'spi-cs', 5: 'spi-sck', 6: 'spi-miso', 7: 'spi-mosi' }) },
    { name: 'PB', pins: stm32Port('B', { 6: 'i2c-scl', 9: 'i2c-sda' }) },
    { name: 'PD', pins: stm32Port('D', {}) },
    {
      name: 'Power',
      pins: [
        { id: 'E-5V', label: '5V', kind: 'power', voltage: 5 },
        { id: 'E-3V3', label: '3V3', kind: 'power', voltage: 3.3 },
        { id: 'E-GND1', label: 'GND', kind: 'ground' },
        { id: 'E-GND2', label: 'GND', kind: 'ground' },
      ],
    },
  ],
};

/** Port+bit -> global index, matching instrumentation.py's poll scheme exactly (A=0-15, B=16-31, D=48-63). Every PA/PB/PD pin is covered; power/ground pins have none. */
function stm32PortIndex(letter: 'A' | 'B' | 'D', offset: number): Record<string, number> {
  return Object.fromEntries(Array.from({ length: 16 }, (_, bit) => [`P${letter}${bit}`, offset + bit]));
}

export const BOARD_PINOUTS: Record<BoardKey, BoardPinout> = {
  'arduino-uno': ARDUINO_UNO,
  'stm32f4-discovery': STM32F4_DISCOVERY,
};

/** Board pin id -> index into the simulator's live `pins[]` level array. */
export const LIVE_PIN_INDEX: Record<BoardKey, Record<string, number>> = {
  'arduino-uno': ARDUINO_LIVE_INDEX,
  'stm32f4-discovery': { ...stm32PortIndex('A', 0), ...stm32PortIndex('B', 16), ...stm32PortIndex('D', 48) },
};

/** Reverse of LIVE_PIN_INDEX — the Logic Analyzer uses this to label whichever pin the firmware actually touches, with no fixed channel list. */
export function pinLabelFor(boardKey: BoardKey, index: number): string {
  for (const [id, pinIndex] of Object.entries(LIVE_PIN_INDEX[boardKey])) if (pinIndex === index) return id;
  return `pin ${index}`;
}
