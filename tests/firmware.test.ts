import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compile, CompileError } from '../server/compiler';
import { examples } from '../src/examples';
import { RP2040Simulation } from '../src/simulator/engine';
import { parseUF2 } from '../src/simulator/uf2';
import { measurePin } from '../src/trace';
import type { TraceEvent } from '../src/contracts';

async function createSimulation(source: string) {
  const result = await compile(source);
  const elf = Buffer.from(result.elf, 'base64');
  assert.equal(elf.subarray(0, 4).toString('hex'), '7f454c46');
  const uf2 = Uint8Array.from(Buffer.from(result.uf2, 'base64'));
  const rom = await readFile(new URL('../public/rp2040-bootrom.bin', import.meta.url));
  const words = new Uint32Array(rom.buffer.slice(rom.byteOffset, rom.byteOffset + rom.byteLength));
  return new RP2040Simulation(parseUF2(uf2.buffer), words);
}

function advance(simulation: RP2040Simulation, targetUs: number): TraceEvent[] {
  const events: TraceEvent[] = [];
  const deadline = performance.now() + 20_000;
  while (simulation.timeUs < targetUs && performance.now() < deadline) {
    simulation.step(targetUs, 10);
    events.push(...simulation.frame().events);
  }
  assert.ok(simulation.timeUs >= targetUs, `CPU stalled at ${simulation.timeUs} us before ${targetUs} us`);
  return events;
}

test('editable C compiles into actual Pico firmware with measured 1 Hz GPIO and UART', async () => {
  const simulation = await createSimulation(examples[0].source);
  const events = advance(simulation, 2_200_000);
  const measurement = measurePin(events, 25);
  assert.ok(measurement);
  assert.ok(Math.abs(measurement.frequency - 1) < 0.01);
  assert.ok(Math.abs(measurement.duty - 50) < 0.1);
  const serial = events.filter(event => event.type === 'uart_tx').map(event => event.text).join('');
  assert.match(serial, /Pico is ready!/);
  assert.match(serial, /LED on\r\nLED off/);
});

test('changing learner source changes executed GPIO timing, not just build metadata', async () => {
  const simulation = await createSimulation(examples[0].source.replaceAll('sleep_ms(500)', 'sleep_ms(250)'));
  const measurement = measurePin(advance(simulation, 1_200_000), 25);
  assert.ok(measurement);
  assert.ok(Math.abs(measurement.frequency - 2) < 0.02);
});

test('external button drives actual GPIO input, firmware output and UART messages', async () => {
  const simulation = await createSimulation(examples[1].source);
  advance(simulation, 100_000);
  assert.equal(simulation.frame().pins[25], 0);
  simulation.setButton(true);
  const press = advance(simulation, 150_000);
  assert.equal(simulation.frame().pins[25], 1);
  assert.match(press.filter(event => event.type === 'uart_tx').map(event => event.text).join(''), /Button pressed/);
  simulation.setButton(false);
  const release = advance(simulation, 200_000);
  assert.equal(simulation.frame().pins[25], 0);
  assert.match(release.filter(event => event.type === 'uart_tx').map(event => event.text).join(''), /Button released/);
});

test('hardware timer interrupts wake a sleeping CPU and toggle the LED periodically', async () => {
  const simulation = await createSimulation(examples[2].source);
  const measurement = measurePin(advance(simulation, 2_200_000), 25);
  assert.ok(measurement);
  assert.ok(Math.abs(measurement.frequency - 1) < 0.01);
  assert.ok(Math.abs(measurement.duty - 50) < 0.1);
});

test('invalid C returns actual compiler diagnostics', async () => {
  await assert.rejects(compile('int main(void) { missing_symbol(); }'), error => {
    assert.ok(error instanceof CompileError);
    assert.equal(error.status, 422);
    assert.match(error.diagnostics || error.message, /missing_symbol/);
    return true;
  });
});

test('sandbox prevents learner includes from reading private host files', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'firmware-private-test-'));
  const secret = path.join(directory, 'private.h');
  await writeFile(secret, '#error PRIVATE_TEST_SECRET_MUST_NOT_LEAK\n');
  try {
    await assert.rejects(compile(`#include ${JSON.stringify(secret)}\nint main(void) { return 0; }`), error => {
      assert.ok(error instanceof CompileError);
      assert.equal(error.status, 422);
      assert.doesNotMatch(error.diagnostics || error.message, /PRIVATE_TEST_SECRET_MUST_NOT_LEAK/);
      return true;
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('source limits reject empty, oversized and binary input before invoking compiler', async () => {
  for (const source of ['', null, 'x'.repeat(65_537), 'int main() {}\0']) {
    await assert.rejects(compile(source), error => error instanceof CompileError && (error.status === 400 || error.status === 413));
  }
});
