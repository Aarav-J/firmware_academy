import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { examples } from '../src/examples';

// Start a real API process and await its listening event; no mocked compiler or timed sleeps.
test('HTTP compile API serves real images and rejects invalid request boundaries', { timeout: 60_000 }, async t => {
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: process.cwd(), env: { ...process.env, PORT: '3219' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8000); });
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const closed = once(child, 'close');
    child.kill('SIGTERM');
    await closed;
  });
  const ready = Promise.withResolvers<void>();
  child.stdout.on('data', chunk => {
    if (chunk.toString().includes('Firmware compiler listening')) ready.resolve();
  });
  child.once('error', ready.reject);
  child.once('exit', code => ready.reject(new Error(`API exited ${code}: ${stderr}`)));
  await ready.promise;
  const endpoint = 'http://127.0.0.1:3219/api/compile';
  const health = await fetch('http://127.0.0.1:3219/api/health');
  assert.equal(health.status, 200);
  const healthBody = await health.json() as { ready: boolean; message: string };
  assert.ok(healthBody.ready, healthBody.message);

  const built = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: examples[0].source }),
  });
  const firmware = await built.json() as { elf: string; uf2: string; error?: string };
  assert.equal(built.status, 200, firmware.error);
  assert.equal(Buffer.from(firmware.elf, 'base64').subarray(0, 4).toString('hex'), '7f454c46');
  assert.equal(Buffer.from(firmware.uf2, 'base64').readUInt32LE(28), 0xe48bff56);

  const foreign = await fetch(endpoint, { method: 'POST', headers: { Origin: 'https://not-the-workbench.example', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(foreign.status, 403);
  const malformed = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  const wrongType = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'int main() {}' });
  assert.equal(wrongType.status, 415);
  const oversized = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'x'.repeat(65_537) }) });
  assert.equal(oversized.status, 413);
});
