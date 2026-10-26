const FLASH_BASE = 0x10000000;
const PICO_FLASH_SIZE = 2 * 1024 * 1024;
const RP2040_FAMILY = 0xe48bff56;
const BLOCK_SIZE = 512;

/** Decode a flash-targeting RP2040 UF2 without trusting its offsets or block counts. */
export function parseUF2(buffer: ArrayBuffer): Uint8Array {
  if (!(buffer instanceof ArrayBuffer) || !buffer.byteLength || buffer.byteLength % BLOCK_SIZE) {
    throw new Error('Invalid UF2: expected complete 512-byte blocks.');
  }
  const blockCount = buffer.byteLength / BLOCK_SIZE;
  if (blockCount > PICO_FLASH_SIZE / 4) {
    throw new Error('Invalid UF2: image has too many blocks for a Pico.');
  }
  const view = new DataView(buffer);
  const seen = new Set<number>();
  const ranges: { start: number; end: number; source: number }[] = [];
  let imageSize = 0;
  for (let index = 0; index < blockCount; index++) {
    const offset = index * BLOCK_SIZE;
    const word = (field: number) => view.getUint32(offset + field, true);
    if (word(0) !== 0x0a324655 || word(4) !== 0x9e5d5157 || word(508) !== 0x0ab16f30) {
      throw new Error(`Invalid UF2: corrupt magic in block ${index}.`);
    }
    const flags = word(8);
    if (!(flags & 0x2000) || word(28) !== RP2040_FAMILY) {
      throw new Error('This is not an RP2040-family UF2 image.');
    }
    if (flags & (0x1 | 0x1000)) {
      throw new Error('UF2 must contain flash firmware, not file-container or non-flash blocks.');
    }
    const size = word(16);
    const start = word(12) - FLASH_BASE;
    if (!size || size > 476 || size % 4 || start % 4 || start < 0 || start + size > PICO_FLASH_SIZE) {
      throw new Error(`Invalid UF2: block ${index} is outside Pico's 2 MiB flash or has an invalid payload.`);
    }
    const sequence = word(20);
    if (word(24) !== blockCount || sequence >= blockCount || seen.has(sequence)) {
      throw new Error('Invalid UF2: missing, duplicate, or inconsistent block sequence.');
    }
    seen.add(sequence);
    ranges.push({ start, end: start + size, source: offset + 32 });
    imageSize = Math.max(imageSize, start + size);
  }
  ranges.sort((a, b) => a.start - b.start);
  let contiguousBootBytes = 0;
  let previousEnd = 0;
  for (const range of ranges) {
    if (range.start < previousEnd) throw new Error('Invalid UF2: overlapping flash payloads.');
    if (range.start === contiguousBootBytes) contiguousBootBytes = range.end;
    previousEnd = range.end;
  }
  if (contiguousBootBytes < 256) {
    throw new Error('UF2 is missing the RP2040 second-stage bootloader at 0x10000000.');
  }
  const image = new Uint8Array(imageSize).fill(0xff);
  const source = new Uint8Array(buffer);
  for (const range of ranges) {
    image.set(source.subarray(range.source, range.source + range.end - range.start), range.start);
  }
  return image;
}
