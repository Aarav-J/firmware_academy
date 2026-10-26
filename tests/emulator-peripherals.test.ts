import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { RP2040Simulation } from '../src/simulator/engine';

async function createHardware() {
  const rom = await readFile(new URL('../public/rp2040-bootrom.bin', import.meta.url));
  const words = new Uint32Array(rom.buffer.slice(rom.byteOffset, rom.byteOffset + rom.byteLength));
  // Exercise actual emulated MMIO on a chip with erased flash, without replacing peripherals.
  return new RP2040Simulation(new Uint8Array(0), words);
}

for (const [port, base] of [[0, 0x40034000], [1, 0x40038000]]) {
  test(`UART${port} only transmits when both UARTEN and TXE are set`, async () => {
    const simulation = await createHardware();
    simulation.frame();
    const mcu = simulation.mcu;
    mcu.writeUint32(base, 0x41);
    assert.equal(simulation.frame().events.filter(event => event.type === 'uart_tx').length, 0);
    mcu.writeUint32(base + 0x30, 1);
    mcu.writeUint32(base, 0x42);
    assert.equal(simulation.frame().events.filter(event => event.type === 'uart_tx').length, 0);
    mcu.writeUint32(base + 0x30, 0x101);
    mcu.writeUint32(base, 0x43);
    assert.deepEqual(simulation.frame().events, [{ type: 'uart_tx', timeUs: 0, port, text: 'C' }]);
    // Hardware atomic clear of TXE must immediately stop subsequent transmissions.
    mcu.writeUint32(base + 0x3030, 0x100);
    mcu.writeUint32(base, 0x44);
    assert.equal(simulation.frame().events.filter(event => event.type === 'uart_tx').length, 0);
  });
}

test('UART UTF-8 bytes survive frame boundaries without replacement characters', async () => {
  const simulation = await createHardware();
  simulation.frame();
  simulation.mcu.writeUint32(0x40034030, 0x101);
  simulation.mcu.writeUint32(0x40034000, 0xe2);
  assert.equal(simulation.frame().events.length, 0);
  simulation.mcu.writeUint32(0x40034000, 0x82);
  assert.equal(simulation.frame().events.length, 0);
  simulation.mcu.writeUint32(0x40034000, 0xac);
  assert.deepEqual(simulation.frame().events, [{ type: 'uart_tx', timeUs: 0, port: 0, text: '€' }]);
});

test('GPIO14 pull changes do not synthesize an edge while the external pad stays high', async () => {
  const simulation = await createHardware();
  const mcu = simulation.mcu;
  const gpio14Pad = 0x4001c03c;
  const gpio14Control = 0x40014074;
  const bankInterrupt1 = 0x400140f4;
  const rising = 0x08000000;
  const falling = 0x04000000;
  mcu.writeUint32(gpio14Control, 5);
  mcu.writeUint32(gpio14Pad, 0x44);
  mcu.writeUint32(bankInterrupt1, rising | falling);
  assert.equal(mcu.readUint32(bankInterrupt1) & rising, 0);
  mcu.writeUint32(gpio14Pad, 0x48);
  assert.equal(simulation.frame().pins[14], 1);
  assert.equal(mcu.readUint32(bankInterrupt1) & rising, 0);
  simulation.setButton(true);
  assert.equal(simulation.frame().pins[14], 0);
  assert.notEqual(mcu.readUint32(bankInterrupt1) & falling, 0);
  mcu.writeUint32(bankInterrupt1, rising | falling);
  simulation.setButton(false);
  assert.equal(simulation.frame().pins[14], 1);
  assert.notEqual(mcu.readUint32(bankInterrupt1) & rising, 0);
});

test('trace overload preserves its prefix and faults until reset instead of fabricating continuity', async () => {
  const simulation = await createHardware();
  simulation.mcu.writeUint32(0x400140cc, 5);
  simulation.mcu.writeUint32(0xd0000020, 1 << 25);
  simulation.frame();
  for (let index = 0; index < 4096; index++) simulation.mcu.writeUint32(0xd000001c, 1 << 25);
  assert.throws(() => simulation.mcu.writeUint32(0xd000001c, 1 << 25), /Trace capacity exceeded/);
  const frame = simulation.frame();
  assert.equal(frame.events.length, 4096);
  assert.deepEqual(frame.events[0], { type: 'pin', timeUs: 0, pin: 25, level: 1 });
  assert.deepEqual(frame.events[4095], { type: 'pin', timeUs: 0, pin: 25, level: 0 });
  assert.throws(() => simulation.step(1), /reset before running again/);
});
