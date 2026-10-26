import type { ComponentDef } from './breadboard-contracts';

// A small, intentionally mixed-voltage parts bin: some parts tolerate 5V,
// one (the OLED) does not — wiring it to an Arduino's 5V rail instead of
// 3V3 is a real, teachable mistake, not a simulator limitation.
//
// The resistor and LED come first deliberately: wiring a pin -> resistor ->
// LED -> GND is the canonical first breadboard circuit, and it's the one
// pair of components whose state the simulator can actually drive live
// today (through a pin the engine already tracks: D13/D2, or PA0/PD12/PD13).
export const BREADBOARD_PARTS: ComponentDef[] = [
  {
    id: 'resistor',
    name: 'Resistor',
    category: 'digital',
    description: 'Current-limiting resistor. Non-polarized — either leg can go to a pin, the other continues the circuit (e.g. to an LED).',
    pins: [
      { id: 'A', label: 'Leg A', kind: 'digital' },
      { id: 'B', label: 'Leg B', kind: 'digital' },
    ],
    internalLinks: [['A', 'B']],
  },
  {
    id: 'led',
    name: 'LED',
    category: 'digital',
    description: 'Wire the anode to a digital pin and cathode to GND. Lights up live on pins the simulator already tracks (D13/D2, or PA0/PD12/PD13).',
    pins: [
      { id: 'ANODE', label: 'Anode (+)', kind: 'digital' },
      { id: 'CATHODE', label: 'Cathode (−)', kind: 'ground' },
    ],
  },
  {
    id: 'temp-sensor',
    name: 'Temp/Humidity Sensor',
    category: 'i2c',
    description: 'I2C digital temperature and humidity sensor, 3.3–5V tolerant.',
    pins: [
      { id: 'VCC', label: 'VCC', kind: 'power', maxVoltage: 5 },
      { id: 'GND', label: 'GND', kind: 'ground' },
      { id: 'SDA', label: 'SDA', kind: 'i2c-sda' },
      { id: 'SCL', label: 'SCL', kind: 'i2c-scl' },
    ],
  },
  {
    id: 'oled-display',
    name: 'OLED Display 128×64',
    category: 'i2c',
    description: 'I2C monochrome OLED. 3.3V only — do not wire VCC to 5V.',
    pins: [
      { id: 'VCC', label: 'VCC', kind: 'power', maxVoltage: 3.3 },
      { id: 'GND', label: 'GND', kind: 'ground' },
      { id: 'SDA', label: 'SDA', kind: 'i2c-sda' },
      { id: 'SCL', label: 'SCL', kind: 'i2c-scl' },
    ],
  },
  {
    id: 'eeprom',
    name: 'I2C EEPROM 256Kb',
    category: 'i2c',
    description: 'Serial EEPROM for non-volatile storage over I2C.',
    pins: [
      { id: 'VCC', label: 'VCC', kind: 'power', maxVoltage: 5 },
      { id: 'GND', label: 'GND', kind: 'ground' },
      { id: 'SDA', label: 'SDA', kind: 'i2c-sda' },
      { id: 'SCL', label: 'SCL', kind: 'i2c-scl' },
    ],
  },
  {
    id: 'sd-card',
    name: 'MicroSD Card Module',
    category: 'spi',
    description: 'SPI microSD breakout for logging data to a real filesystem.',
    pins: [
      { id: 'VCC', label: 'VCC', kind: 'power', maxVoltage: 5 },
      { id: 'GND', label: 'GND', kind: 'ground' },
      { id: 'SCK', label: 'SCK', kind: 'spi-sck' },
      { id: 'MOSI', label: 'MOSI', kind: 'spi-mosi' },
      { id: 'MISO', label: 'MISO', kind: 'spi-miso' },
      { id: 'CS', label: 'CS', kind: 'spi-cs' },
    ],
  },
  {
    id: 'shift-register',
    name: 'Shift Register (8-bit)',
    category: 'spi',
    description: 'Serial-in, parallel-out shift register for driving extra outputs over SPI-like signaling.',
    pins: [
      { id: 'VCC', label: 'VCC', kind: 'power', maxVoltage: 5 },
      { id: 'GND', label: 'GND', kind: 'ground' },
      { id: 'SRCLK', label: 'SRCLK', kind: 'spi-sck' },
      { id: 'SER', label: 'SER', kind: 'spi-mosi' },
      { id: 'RCLK', label: 'RCLK', kind: 'spi-cs' },
    ],
  },
  {
    id: 'potentiometer',
    name: 'Potentiometer',
    category: 'analog',
    description: 'Variable resistor wired as a voltage divider for an analog input.',
    pins: [
      { id: 'VCC', label: 'VCC', kind: 'power', maxVoltage: 5 },
      { id: 'GND', label: 'GND', kind: 'ground' },
      { id: 'WIPER', label: 'Wiper', kind: 'analog' },
    ],
  },
];
