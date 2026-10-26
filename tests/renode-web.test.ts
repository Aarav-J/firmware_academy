import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ProjectProfile, ProjectBuildResult, RegisterSnapshot, RenodeFrame, RenodeSessionInfo } from '../src/workbench-contracts';
import { measurePin } from '../src/trace';

// Global pin index scheme (board-pinouts.ts / instrumentation.py): port A = 0-15, B = 16-31, D = 48-63.
const PD12 = 48 + 12;
const PD13 = 48 + 13;

// Exercise real HTTP, compiler, Renode process and SSE; no synthetic firmware events or mocked transports.
test('editable STM32 profiles execute and expose owned paused debugger state', { timeout: 180_000 }, async t => {
  const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    cwd: process.cwd(), env: { ...process.env, PORT: '3227' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  server.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8000); });
  t.after(async () => {
    if (server.exitCode !== null || server.signalCode !== null) return;
    const closed = once(server, 'close');
    server.kill('SIGTERM');
    await closed;
  });
  const ready = Promise.withResolvers<void>();
  server.stdout.on('data', chunk => { if (chunk.toString().includes('Firmware compiler listening')) ready.resolve(); });
  server.once('error', ready.reject);
  server.once('exit', code => ready.reject(new Error(`API exited ${code}: ${stderr}`)));
  await ready.promise;
  const base = 'http://127.0.0.1:3227';
  async function request<T>(route: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
    const response = await fetch(base + route, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
    const result = await response.json() as T & { error?: string; diagnostics?: string };
    assert.ok(response.ok, `${response.status}: ${result.diagnostics || result.error}`);
    return result;
  }
  const profiles = await request<ProjectProfile[]>('/api/projects');
  const baremetal = profiles.find(profile => profile.id === 'stm32-baremetal')!;
  const zephyr = profiles.find(profile => profile.id === 'stm32-zephyr')!;
  assert.ok(baremetal?.available, baremetal?.message);
  assert.ok(zephyr?.available, zephyr?.message);
  const files = Object.fromEntries(baremetal.files.filter(file => file.editable).map(file => [file.path, file.content]));
  files['main.c'] = files['main.c'].replace('Bare-metal STM32 proof ready', 'Edited web firmware ready').replace('>= 500u', '>= 250u');
  const build = await request<ProjectBuildResult>('/api/projects/build', { profile: baremetal.id, files });
  const artifactResponse = await fetch(`${base}/api/projects/builds/${build.buildId}/elf`);
  assert.equal(artifactResponse.status, 200);
  const elf = Buffer.from(await artifactResponse.arrayBuffer());
  assert.equal(elf.subarray(0, 4).toString('hex'), '7f454c46');
  assert.ok(elf.includes(Buffer.from('Edited web firmware ready')));

  async function execute(buildId: string, expectedBanner: string, expectedHz: number, inspect: boolean, ledPin = PD12) {
    const session = await request<RenodeSessionInfo>('/api/renode/sessions', { buildId });
    const route = `/api/renode/sessions/${session.sessionId}`;
    const token = encodeURIComponent(session.token);
    const stream = await fetch(`${base}${route}/events?token=${token}`, { signal: AbortSignal.timeout(60_000) });
    assert.equal(stream.status, 200);
    const reader = stream.body!.getReader();
    t.after(() => reader.cancel().catch(() => {}));
    const decoder = new TextDecoder();
    let pending = '';
    const queued: RenodeFrame[] = [];
    const frames: RenodeFrame[] = [];
    async function until(predicate: (frame: RenodeFrame) => boolean): Promise<RenodeFrame> {
      for (;;) {
        while (queued.length) {
          const frame = queued.shift()!;
          frames.push(frame);
          if (predicate(frame)) return frame;
        }
        const read = await reader.read();
        assert.ok(!read.done, 'Renode event stream closed before expected behavior');
        pending += decoder.decode(read.value, { stream: true }).replaceAll('\r\n', '\n');
        let boundary: number;
        while ((boundary = pending.indexOf('\n\n')) >= 0) {
          const message = pending.slice(0, boundary);
          pending = pending.slice(boundary + 2);
          const data = message.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (data) queued.push(JSON.parse(data) as RenodeFrame);
        }
      }
    }
    const command = (value: unknown) => request<{ ok: boolean }>(`${route}/command`, { token: session.token, command: value });
    try {
      const foreign = await fetch(`${base}${route}/registers?token=wrong-token`);
      assert.ok(foreign.status === 403 || foreign.status === 404, 'Foreign token could inspect another session');
      const raw = await fetch(`${base}${route}/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: session.token, command: { type: 'monitor', text: 'python arbitrary_code' } }) });
      assert.equal(raw.status, 400);
      await command({ type: 'run' });
      const running = await until(frame => frame.timeUs >= (expectedHz < 2 ? 2_500_000 : 1_200_000) || frame.state === 'error');
      assert.notEqual(running.state, 'error', running.error);
      const events = frames.flatMap(frame => frame.events);
      const uart = events.filter(event => event.type === 'uart_tx').map(event => event.text).join('');
      assert.ok(uart.includes(expectedBanner), uart);
      const measurement = measurePin(events, ledPin);
      assert.ok(measurement, 'No actual GPIO cycles emitted');
      assert.ok(Math.abs(measurement.frequency - expectedHz) < 0.05, JSON.stringify(measurement));
      await command({ type: 'button', pressed: true });
      await until(frame => frame.pins[PD13] === 1 || frame.state === 'error');
      await command({ type: 'button', pressed: false });
      await until(frame => frame.pins[PD13] === 0 || frame.state === 'error');
      await command({ type: 'pause' });
      const paused = await until(frame => frame.state === 'paused');
      const snapshot = await request<RegisterSnapshot>(`${route}/registers?token=${token}`);
      assert.equal(snapshot.timeUs, paused.timeUs);
      assert.ok(Object.keys(snapshot.cpu).some(name => name.toUpperCase() === 'PC'));
      assert.ok(snapshot.peripherals.some(register => register.name === 'GPIOD_ODR'));
      assert.ok(snapshot.disassembly.length > 0);
      if (inspect) {
        await command({ type: 'reset' });
        const reset = await until(frame => frame.timeUs === 0 && frame.state === 'ready');
        assert.equal(reset.pins[ledPin], 0);
        const before = await request<RegisterSnapshot>(`${route}/registers?token=${token}`);
        await command({ type: 'step' });
        await until(frame => frame.state === 'paused');
        const after = await request<RegisterSnapshot>(`${route}/registers?token=${token}`);
        const pc = (value: RegisterSnapshot) => Object.entries(value.cpu).find(([name]) => name.toUpperCase() === 'PC')?.[1];
        assert.notEqual(pc(before), pc(after), 'Instruction step did not change actual PC');
      }
    } finally {
      await request(`${route}?token=${token}`, undefined, 'DELETE');
      await reader.cancel().catch(() => {});
    }
    const closed = await fetch(`${base}${route}/registers?token=${token}`);
    assert.ok(closed.status === 404 || closed.status === 410, 'Disposed session remained accessible');
  }

  await execute(build.buildId, 'Edited web firmware ready', 2, true);
  const zephyrFiles = Object.fromEntries(zephyr.files.filter(file => file.editable).map(file => [file.path, file.content]));
  zephyrFiles['src/main.c'] = zephyrFiles['src/main.c'].replace('Zephyr STM32 proof ready', 'Edited Zephyr web ready');
  zephyrFiles['prj.conf'] = zephyrFiles['prj.conf'].replace('CONFIG_MAIN_STACK_SIZE=2048', 'CONFIG_MAIN_STACK_SIZE=3072');
  const zephyrBuild = await request<ProjectBuildResult>('/api/projects/build', { profile: zephyr.id, files: zephyrFiles });
  await execute(zephyrBuild.buildId, 'Edited Zephyr web ready', 1, false);

  // The whole point of generic IDR polling: moving the blink off PD12 must
  // not go dark. Retarget to PD14 (same port, same timer, different bit).
  // PD12's mode bits (24-25) move to PD14 (28-29); PD13's mode bits (26-27)
  // are deliberately left untouched — PD13 is the separate button-mirror
  // LED and must stay configured as an output for that half of the proof.
  const PD14 = 48 + 14;
  const retargetedFiles = {
    ...files,
    'main.c': files['main.c']
      .replace('GPIOD_MODER = (GPIOD_MODER & ~((3u << 24) | (3u << 26)))\n                | (1u << 24) | (1u << 26);', 'GPIOD_MODER = (GPIOD_MODER & ~((3u << 28) | (3u << 26)))\n                | (1u << 28) | (1u << 26);')
      .replace('high ? (1u << 12) : (1u << 28)', 'high ? (1u << 14) : (1u << 30)')
      .replace('GPIOD_BSRR = (1u << 28) | (1u << 29);', 'GPIOD_BSRR = (1u << 30) | (1u << 29);'),
  };
  assert.notEqual(retargetedFiles['main.c'], files['main.c']);
  const retargetedBuild = await request<ProjectBuildResult>('/api/projects/build', { profile: baremetal.id, files: retargetedFiles });
  await execute(retargetedBuild.buildId, 'Edited web firmware ready', 2, false, PD14);

  const privateDir = await mkdtemp(path.join(os.tmpdir(), 'web-build-private-'));
  t.after(() => rm(privateDir, { recursive: true, force: true }));
  const secret = path.join(privateDir, 'secret.h');
  await writeFile(secret, '#error WEB_PRIVATE_CONTENT_MUST_NOT_LEAK\n');
  for (const changed of [
    { ...files, 'main.c': `#include ${JSON.stringify(secret)}\nint main(void) { return 0; }` },
    { ...files, 'linker.ld': `INCLUDE ${JSON.stringify(secret)}\n${files['linker.ld']}` },
    { ...files, 'main.c': 'int main(void) { WEB_INVALID_SYMBOL; }' },
  ]) {
    const response = await fetch(`${base}/api/projects/build`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: baremetal.id, files: changed }) });
    const failure = await response.json() as { error?: string; diagnostics?: string };
    assert.equal(response.status, 422);
    assert.doesNotMatch(failure.diagnostics || failure.error || '', /WEB_PRIVATE_CONTENT_MUST_NOT_LEAK/);
  }
  for (const changed of [{ ...files, '../outside.c': 'int main() {}' }, { ...zephyrFiles, 'CMakeLists.txt': 'execute_process(COMMAND arbitrary)' }]) {
    const response = await fetch(`${base}/api/projects/build`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: '../outside.c' in changed ? baremetal.id : zephyr.id, files: changed }) });
    assert.equal(response.status, 400);
  }
});
