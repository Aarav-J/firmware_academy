import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, rm } from 'node:fs/promises';
import { compileArduino } from '../server/stm32-build/arduino';
import { projectTempDirectory } from '../server/stm32-build/storage';
import { ATmega328PSimulation, parseIntelHex } from '../src/simulator/avr-engine';
import { pinTransitions, measurePin } from '../src/trace';
import type { TraceEvent } from '../src/contracts';

async function run(source: string, setup?: (sim: ATmega328PSimulation) => void) {
  const directory = await projectTempDirectory('request');
  try {
    const { hexPath } = await compileArduino(directory, source);
    const hex = await readFile(hexPath, 'utf8');
    const sim = new ATmega328PSimulation(parseIntelHex(hex));
    setup?.(sim);
    let trace: TraceEvent[] = [];
    let frame = sim.frame();
    const deadline = performance.now() + 19_000;
    while (frame.timeUs < 3_000_000 && performance.now() < deadline) {
      sim.step(3_000_000, 10);
      frame = sim.frame();
      trace = trace.concat(frame.events);
    }
    return { sim, frame, trace };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('ADC smoke: analogRead reflects a real injected voltage over Serial', async () => {
  const { sim, trace } = await run(`void setup() { Serial.begin(9600); }
void loop() { Serial.println(analogRead(A0)); delay(200); }
`, sim => sim.setAnalogInput(14, 2.5));
  const text = trace.filter(event => event.type === 'uart_tx').map(event => event.text).join('');
  const values = text.split('\n').map(line => Number(line.trim())).filter(value => Number.isFinite(value) && value > 0);
  assert.ok(values.length > 0, `expected analogRead output, got: ${JSON.stringify(text)}`);
  for (const value of values) assert.ok(Math.abs(value - 512) <= 10, `analogRead(A0) at 2.5V should read ~512, got ${value}`);
  void sim;
});

test('I2C smoke: a real Wire transaction reads the simulated device ID and NACKs a wrong address', async () => {
  const { trace } = await run(`#include <Wire.h>
void setup() {
  Serial.begin(9600);
  Wire.begin();
  Wire.beginTransmission(0x50);
  Wire.write(0x00);
  Wire.endTransmission();
  Wire.requestFrom(0x50, 1);
  if (Wire.available()) Serial.print("ID:"); Serial.println(Wire.read(), HEX);
  Wire.beginTransmission(0x12);
  uint8_t error = Wire.endTransmission();
  Serial.print("ERR:"); Serial.println(error);
}
void loop() {}
`);
  const text = trace.filter(event => event.type === 'uart_tx').map(event => event.text).join('');
  assert.match(text, /ID:5A/i, `expected device ID 0x5A, got: ${JSON.stringify(text)}`);
  assert.match(text, /ERR:[1-4]/, `expected a nonzero Wire error for the unsupported address, got: ${JSON.stringify(text)}`);
});

test('PWM smoke: analogWrite drives a measurable real duty cycle on D9', async () => {
  const { trace } = await run(`void setup() { pinMode(9, OUTPUT); analogWrite(9, 128); }
void loop() {}
`);
  const duty = measurePin(trace, 9);
  assert.ok(duty, 'expected measurable PWM transitions on D9');
  assert.ok(Math.abs(duty!.duty - 50) <= 5, `analogWrite(9, 128) should be ~50% duty, got ${duty!.duty}`);
  assert.ok(pinTransitions(trace, 9).length > 4, 'expected multiple real PWM edges');
});
