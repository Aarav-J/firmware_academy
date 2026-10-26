import assert from 'node:assert/strict';
import test from 'node:test';
import type { TraceEvent } from '../src/contracts';
import { appendSerial, digitalPath, measurePin, retainPinTrace } from '../src/trace';

const pin = (timeUs: number, level: 0 | 1, pinNumber = 25): TraceEvent => ({ type: 'pin', timeUs, pin: pinNumber, level });

test('frequency counts complete cycles rather than individual toggles', () => {
  const events = [pin(0, 1), pin(500_000, 0), pin(1_000_000, 1), pin(1_500_000, 0), pin(2_000_000, 1)];
  assert.deepEqual(measurePin(events, 25), { frequency: 1, duty: 50 });
  assert.deepEqual(measurePin([pin(0, 1), pin(250_000, 0), pin(1_000_000, 1)], 25), { frequency: 1, duty: 25 });
  assert.equal(measurePin([pin(0, 1), pin(500_000, 0)], 25), null);
});

test('duplicate pin observations do not add cycles or distort duty', () => {
  const events = [pin(0, 1), pin(100, 1), pin(250_000, 0), pin(400_000, 0), pin(1_000_000, 1)];
  assert.deepEqual(measurePin(events, 25), { frequency: 1, duty: 25 });
  assert.equal(measurePin(events, 14), null);
});

test('rolling traces retain the last known level before the visible window', () => {
  const previous = [pin(0, 1, 14), pin(0, 0), pin(1_000_000, 1), pin(2_000_000, 0)];
  const retained = retainPinTrace(previous, [pin(10_000_000, 1)], 10_000_000);
  assert.ok(retained.some(event => event.type === 'pin' && event.pin === 14 && event.level === 1));
  assert.equal(digitalPath(retained, 14, 8_000_000, 10_000_000, 100, 0, 20), 'M 0 0 H 100');
  assert.equal(digitalPath(retained, 25, 8_000_000, 10_000_000, 100, 0, 20), 'M 0 20 H 100.00 V 0 H 100');
});

test('high-rate trace retention is bounded and UART is not copied into waveforms', () => {
  const events: TraceEvent[] = Array.from({ length: 20_000 }, (_, index) => pin(index, index % 2 as 0 | 1));
  events.push({ type: 'uart_tx', timeUs: 20_000, port: 0, text: 'serial' });
  const retained = retainPinTrace([], events, 20_000);
  assert.ok(retained.length <= 8000);
  assert.ok(retained.every(event => event.type === 'pin'));
  assert.equal(retained.at(-1)?.timeUs, 19_999);
});

test('serial output truncates oldest data without losing the newest text', () => {
  assert.equal(appendSerial('abcdef', 'ghijkl', 8), 'efghijkl');
});

test('waveforms do not invent levels before the first retained observation', () => {
  assert.equal(digitalPath([pin(500_000, 1)], 25, 0, 1_000_000, 100, 0, 20), 'M 50.00 0 H 100');
  assert.equal(digitalPath([], 25, 0, 1_000_000, 100, 0, 20), '');
});
