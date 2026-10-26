import assert from 'node:assert/strict';
import test from 'node:test';
import { binaryToUf2 } from '../server/build';
import { parseUF2 } from '../src/simulator/uf2';
import { createUf2Download } from '../src/hardware';

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

test('UF2 conversion preserves multi-block payloads and RP2040 flash placement', () => {
  const binary = Buffer.from(Array.from({ length: 513 }, (_, index) => index % 251));
  const uf2 = binaryToUf2(binary);
  const flash = parseUF2(arrayBuffer(uf2));
  assert.deepEqual(Buffer.from(flash.subarray(0, binary.length)), binary);
  assert.equal(flash.length, 768);
});

test('UF2 loader rejects truncated images, wrong targets, duplicates and overlapping writes', () => {
  const valid = binaryToUf2(Buffer.alloc(512, 0xaa));
  assert.throws(() => parseUF2(arrayBuffer(valid.subarray(0, 513))), /512-byte/);
  const wrongFamily = Buffer.from(valid);
  wrongFamily.writeUInt32LE(0x12345678, 28);
  assert.throws(() => parseUF2(arrayBuffer(wrongFamily)), /RP2040/);
  const duplicated = Buffer.from(valid);
  duplicated.writeUInt32LE(0, 512 + 20);
  assert.throws(() => parseUF2(arrayBuffer(duplicated)), /duplicate/);
  const overlap = Buffer.from(valid);
  overlap.writeUInt32LE(0x10000000, 512 + 12);
  assert.throws(() => parseUF2(arrayBuffer(overlap)), /overlapping/);
  const beyondFlash = Buffer.from(valid);
  beyondFlash.writeUInt32LE(0x10200000, 12);
  assert.throws(() => parseUF2(arrayBuffer(beyondFlash)), /outside/);
});

test('hardware download owns exact firmware bytes and revokes its URL', async () => {
  const bytes = Uint8Array.from(binaryToUf2(Buffer.alloc(512, 0x5a)));
  const expected = bytes.slice();
  const download = createUf2Download(bytes);
  bytes.fill(0);
  assert.deepEqual(new Uint8Array(await (await fetch(download.url)).arrayBuffer()), expected);
  download.revoke();
  await assert.rejects(fetch(download.url));
});
