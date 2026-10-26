import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, rm } from 'node:fs/promises';
import { CompileError } from '../server/compiler';
import { compileArduino } from '../server/stm32-build/arduino';
import { buildProject, getProfiles } from '../server/projects';
import { projectTempDirectory } from '../server/stm32-build/storage';
import { ARDUINO_EXAMPLES } from '../src/examples';
import { ATmega328PSimulation, parseIntelHex } from '../src/simulator/avr-engine';
import { measurePin } from '../src/trace';
import { parseDiagnostics } from '../src/diagnostics';
import type { TraceEvent } from '../src/contracts';

async function createSimulation(source: string) {
  const directory = await projectTempDirectory('request');
  try {
    const { elfPath, hexPath } = await compileArduino(directory, source);
    const elf = await readFile(elfPath);
    assert.equal(elf.subarray(0, 4).toString('hex'), '7f454c46');
    const hex = await readFile(hexPath, 'utf8');
    return new ATmega328PSimulation(parseIntelHex(hex));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function advance(simulation: ATmega328PSimulation, targetUs: number): TraceEvent[] {
  const events: TraceEvent[] = [];
  const deadline = performance.now() + 20_000;
  while (simulation.timeUs < targetUs && performance.now() < deadline) {
    simulation.step(targetUs, 10);
    events.push(...simulation.frame().events);
  }
  assert.ok(simulation.timeUs >= targetUs, `AVR core stalled at ${simulation.timeUs} us before ${targetUs} us`);
  return events;
}

test('editable Arduino sketch compiles into real AVR firmware with measured LED and UART', async () => {
  const blink = ARDUINO_EXAMPLES.find(example => example.id === 'arduino-blink')!;
  const simulation = await createSimulation(blink.source);
  const events = advance(simulation, 2_200_000);
  const measurement = measurePin(events, 13);
  assert.ok(measurement);
  assert.ok(Math.abs(measurement.frequency - 1) < 0.02, JSON.stringify(measurement));
  const uart = events.filter(event => event.type === 'uart_tx').map(event => event.text).join('');
  assert.match(uart, /Blink started/);
  assert.match(uart, /LED on\r\nLED off/);
});

test('moving the blink to a different pin tracks that pin, not just D13', async () => {
  const blink = ARDUINO_EXAMPLES.find(example => example.id === 'arduino-blink')!;
  const movedSource = blink.source.replace(/\b13\b/g, '3');
  assert.doesNotMatch(movedSource, /\b13\b/);
  const simulation = await createSimulation(movedSource);
  const events = advance(simulation, 2_200_000);
  const onPin3 = measurePin(events, 3);
  assert.ok(onPin3, 'Pin 3 was never tracked after moving the blink there');
  assert.ok(Math.abs(onPin3.frequency - 1) < 0.02, JSON.stringify(onPin3));
  assert.ok(!events.some(event => event.type === 'pin' && event.pin === 13), 'D13 still reported activity after the sketch stopped using it');
});

test('changing the sketch changes executed AVR timing, not just build metadata', async () => {
  const blink = ARDUINO_EXAMPLES.find(example => example.id === 'arduino-blink')!;
  const simulation = await createSimulation(blink.source.replaceAll('delay(500)', 'delay(250)'));
  const measurement = measurePin(advance(simulation, 1_200_000), 13);
  assert.ok(measurement);
  assert.ok(Math.abs(measurement.frequency - 2) < 0.02, JSON.stringify(measurement));
});

test('external button on D2 drives the real AVR input and firmware output', async () => {
  const buttonExample = ARDUINO_EXAMPLES.find(example => example.id === 'arduino-button')!;
  const simulation = await createSimulation(buttonExample.source);
  advance(simulation, 50_000);
  assert.equal(simulation.frame().pins[13], 0);
  simulation.setButton(true);
  const pressed = advance(simulation, 100_000);
  assert.equal(simulation.frame().pins[13], 1);
  assert.match(pressed.filter(event => event.type === 'uart_tx').map(event => event.text).join(''), /Button pressed/);
  simulation.setButton(false);
  const released = advance(simulation, 150_000);
  assert.equal(simulation.frame().pins[13], 0);
  assert.match(released.filter(event => event.type === 'uart_tx').map(event => event.text).join(''), /Button released/);
});

test('non-blocking millis() example keeps correct timing without delay()', async () => {
  const timerExample = ARDUINO_EXAMPLES.find(example => example.id === 'arduino-timer')!;
  const simulation = await createSimulation(timerExample.source);
  const measurement = measurePin(advance(simulation, 2_200_000), 13);
  assert.ok(measurement);
  assert.ok(Math.abs(measurement.frequency - 1) < 0.02, JSON.stringify(measurement));
});

test('invalid Arduino sketch returns real avr-gcc diagnostics', async () => {
  const directory = await projectTempDirectory('request');
  try {
    await assert.rejects(compileArduino(directory, 'void setup() { undefinedFunctionCall(); }\nvoid loop() {}\n'), error => {
      assert.ok(error instanceof CompileError);
      assert.equal(error.status, 422);
      assert.match(error.diagnostics || '', /sketch\.ino:1:\d+: error:.*undefinedFunctionCall/);
      return true;
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('sketch #include cannot escape the sketch directory', async () => {
  const directory = await projectTempDirectory('request');
  try {
    await assert.rejects(compileArduino(directory, '#include "../../../../etc/passwd"\nvoid setup() {}\nvoid loop() {}\n'), error => {
      assert.ok(error instanceof CompileError);
      assert.equal(error.status, 422);
      return true;
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('project service exposes the Arduino profile and rejects extra files', async () => {
  const profiles = await getProfiles();
  const arduino = profiles.find(profile => profile.id === 'arduino-uno');
  assert.ok(arduino);
  assert.equal(arduino.files.length, 1);
  assert.equal(arduino.files[0].path, 'sketch.ino');
  assert.ok(arduino.files[0].editable);
  await assert.rejects(buildProject({ profile: 'arduino-uno', files: { 'sketch.ino': 'void setup(){}\nvoid loop(){}\n', 'extra.h': 'int x;' } }), error => error instanceof CompileError && error.status === 400);
});

test('real compiler diagnostics resolve to the exact editor line and column that failed', async () => {
  const directory = await projectTempDirectory('request');
  try {
    const source = 'void setup() {\n  Serial.begin(9600);\n  undefinedFunctionCall();\n}\n\nvoid loop() {}\n';
    await assert.rejects(compileArduino(directory, source), error => {
      assert.ok(error instanceof CompileError);
      const diagnostics = parseDiagnostics(error.diagnostics ?? '', 'sketch.ino', source);
      assert.ok(diagnostics.length > 0, 'parseDiagnostics returned no markers for a real compiler error');
      const lineThree = diagnostics.find(d => source.slice(0, d.from).split('\n').length === 3);
      assert.ok(lineThree, `expected a diagnostic positioned on line 3; got ${JSON.stringify(diagnostics)}`);
      assert.equal(lineThree.severity, 'error');
      assert.match(lineThree.message, /undefinedFunctionCall/);
      return true;
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('diagnostics clear to an empty array once the build succeeds', () => {
  assert.deepEqual(parseDiagnostics('', 'sketch.ino', 'void setup() {}\nvoid loop() {}\n'), []);
});
