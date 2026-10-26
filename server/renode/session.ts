import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFile, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import type { TraceEvent } from '../../src/contracts.js';
import type { RegisterSnapshot, RenodeCommand, RenodeFrame, RenodeState } from '../../src/workbench-contracts.js';
import { CompileError, ROOT } from '../compiler.js';
import { getBuiltProject } from '../projects.js';
import { RenodeMonitor } from './monitor.js';

const APP = '/Applications/Renode.app/Contents/MacOS';
const ASSETS = path.dirname(fileURLToPath(import.meta.url));
const MAX_SESSIONS = 2;
const sessions = new Map<string, RenodeSession>();
let shuttingDown = false;
const CAVEATS = [
  'Native localhost development only: deny-default macOS sandbox; no hard RAM cap or hostile multi-user isolation claim.',
  'Exact modeled GPIO/UART event timestamps, not cycle-exact physical silicon. HSI/SysTick 16 MHz; stock general-purpose timer clocks differ.',
  'Trusted platform SVD network initialization is disabled; stock register Tags remain. No network fetches are permitted.',
];

function sandbox(directory: string) {
  const q = JSON.stringify;
  return `(version 1)\n(deny default)\n(import "dyld-support.sb")
(allow process-fork)
(allow process-exec (subpath ${q(APP)}))
(allow signal (target self))
(allow sysctl-read)
(allow file-read-metadata)
(allow file-read* (subpath ${q(APP)}) (subpath "/System/Library") (subpath "/usr/lib") (subpath "/usr/share/icu") (subpath "/private/var/db/dyld") (subpath ${q(directory)}) (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random"))
(allow file-write* (subpath ${q(directory)}) (literal "/dev/null"))
`;
}

function jsonPayload<T>(output: string): T {
  const line = output.split(/[\r\n]+/).find(value => value.startsWith('WB:'));
  if (!line) throw new Error('Renode instrumentation returned no structured result');
  return JSON.parse(line.slice(3)) as T;
}

export class RenodeSession {
  readonly id = randomBytes(24).toString('hex');
  readonly token = randomBytes(32).toString('hex');
  state: RenodeState = 'ready';
  private process: ChildProcess | undefined;
  private monitor: RenodeMonitor | undefined;
  private directory = '';
  private queue: Promise<unknown> = Promise.resolve();
  private pendingCommands = 0;
  private timer: NodeJS.Timeout | undefined;
  private grace: NodeJS.Timeout | undefined;
  private expiry: NodeJS.Timeout;
  private subscriber: ServerResponse | undefined;
  private frame: RenodeFrame = { state: 'ready', timeUs: 0, pins: Array<number>(16).fill(0), events: [], warnings: [...CAVEATS] };
  private warnings: string[] = [];
  private logTail = '';
  private logBytes = 0;
  private disposed = false;

  constructor() {
    this.expiry = setTimeout(() => { void this.dispose(); }, 15 * 60_000);
    this.expiry.unref();
  }

  async initialize(buildId: string) {
    if (process.env.FIRMWARE_COMPILER_MODE !== 'native' || process.platform !== 'darwin') {
      throw new CompileError('STM32 Renode currently requires explicit native localhost mode on macOS with sandbox-exec.', 503);
    }
    const build = await getBuiltProject(buildId);
    this.directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'firmware-renode-')));
    await copyFile(build.elfPath, path.join(this.directory, 'firmware.elf'));
    const stock = await readFile(path.join(APP, 'platforms/cpus/stm32f4.repl'), 'utf8');
    const svd = /^\s*ApplySVD @https:\/\/dl\.antmicro\.com\/projects\/renode\/svd\/STM32F40x\.svd\.gz\s*$/m;
    if (!svd.test(stock)) throw new CompileError('Installed STM32 model differs from the trusted SVD initialization pattern', 503);
    await writeFile(path.join(this.directory, 'stm32f4.repl'), stock.replace(svd, ''));
    const board = await readFile(path.join(ROOT, 'proofs/stm32/board.repl'), 'utf8');
    if (!board.includes('using "platforms/cpus/stm32f4.repl"')) throw new Error('Trusted STM32 board base changed');
    await writeFile(path.join(this.directory, 'board.repl'), board.replace('using "platforms/cpus/stm32f4.repl"', `using "${this.directory}/stm32f4.repl"`));
    await copyFile(path.join(ASSETS, 'instrumentation.py'), path.join(this.directory, 'instrumentation.py'));
    const profile = path.join(this.directory, 'runtime.sb');
    await writeFile(profile, sandbox(this.directory), { mode: 0o600 });
    // --hide-log keeps INFO/WARNING lines off stdout so the monitor pipe cannot back-pressure under
    // rapid RunFor slices. Renode logs are redirected to a session-dir file and read back on dispose.
    this.process = spawn('/usr/bin/sandbox-exec', ['-f', profile, path.join(APP, 'renode'), '--disable-gui', '--plain', '--console', '--hide-log', '--config', path.join(this.directory, 'renode.config')], {
      cwd: this.directory, detached: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: '/usr/bin:/bin', HOME: this.directory, TMPDIR: this.directory, TEMP: this.directory, TMP: this.directory, LANG: 'C', LC_ALL: 'C', DOTNET_EnableDiagnostics: '0' },
    });
    this.process.stdout?.on('data', chunk => this.log(chunk));
    this.process.stderr?.on('data', chunk => this.log(chunk));
    this.process.on('error', error => { void this.fail(error); });
    this.process.on('exit', (code, signal) => {
      if (!this.disposed) void this.fail(new Error(`Renode exited (${signal ?? code}). ${this.logTail.slice(-1800)}`));
    });
    if (!this.process.stdin || !this.process.stdout) throw new Error('Renode pipe transport is unavailable');
    this.monitor = await RenodeMonitor.connect(this.process.stdin, this.process.stdout);
    await this.loadMachine();
    // Direct model warnings and session logs to the session-owned file; the file backend
    // stays open until dispose reads the tail and removes the directory.
    await this.command(`logFile "${path.join(this.directory, 'session.log')}"`);
    await this.drain();
    this.armGrace(15_000);
  }

  private log(chunk: Buffer) {
    this.logBytes += chunk.length;
    this.logTail += chunk.toString('utf8');
    const lines = this.logTail.split(/[\r\n]+/);
    this.logTail = lines.pop()?.slice(-2000) ?? '';
    for (const line of lines) {
      if (/warning|error|fatal|unhandled|abort/i.test(line)) {
        if (this.warnings.length < 40) this.warnings.push(line.slice(0, 1000));
        else if (!this.warnings.includes('Additional model warnings omitted (bounded log).')) this.warnings.push('Additional model warnings omitted (bounded log).');
      }
    }
    if (this.logBytes > 8 * 1024 * 1024) void this.fail(new Error('Renode log output exceeded the 8 MiB session limit'));
  }

  private async command(value: string) {
    if (this.disposed || !this.monitor) throw new Error('Renode session is closed');
    return this.monitor.command(value);
  }

  private async loadMachine() {
    await this.command('mach create "workbench"');
    await this.command(`machine LoadPlatformDescription "${this.directory}/board.repl"`);
    await this.command('cpu IsSemihostingEnabled false');
    await this.command('cpu PerformanceInMips 80');
    await this.command(`sysbus LoadELF "${this.directory}/firmware.elf"`);
    await this.command(`python "execfile('${this.directory}/instrumentation.py')"`);
  }

  private async drain() {
    const data = jsonPayload<{ timeUs: number; pins: number[]; events: TraceEvent[]; overflow: boolean }>(await this.command('python "wb_drain()"'));
    if (data.overflow) throw new Error('GPIO/UART event buffer overflow: trace stopped rather than silently dropping events');
    this.frame = { state: this.state, timeUs: data.timeUs, pins: data.pins, events: data.events, warnings: [...CAVEATS, ...this.warnings] };
    this.publish(this.frame);
  }

  private publish(frame: RenodeFrame) {
    const response = this.subscriber;
    if (!response || response.destroyed) return;
    // write() returns false when the socket output buffer is full; the data is still
    // buffered and will be sent. Killing the session on this signal would drop
    // the client each time a large frame fills the kernel write buffer.
    // The session stops publishing if the response is actually closed/destroyed.
    response.write(`data: ${JSON.stringify(frame)}\n\n`);
  }

  private serialize<T>(work: () => Promise<T>) {
    if (this.disposed) return Promise.reject<T>(new CompileError('Renode session is closed', 410));
    if (this.pendingCommands >= 8) return Promise.reject<T>(new CompileError('Renode command queue is full', 429));
    this.pendingCommands++;
    const result = this.queue.then(work);
    this.queue = result.then(() => undefined, () => undefined);
    void result.finally(() => { this.pendingCommands--; }).catch(() => undefined);
    return result;
  }

  private schedule() {
    if (this.timer || this.state !== 'running' || this.disposed) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.serialize(async () => {
        if (this.state !== 'running' || this.disposed) return;
        await this.command('emulation RunFor "0.020"');
        await this.drain();
      }).then(() => this.schedule(), error => this.fail(error));
    }, 20);
    // Keep the event loop alive so scheduled slices can complete; only expiry and grace are unreffed.
  }

  private stopScheduling() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  async control(control: RenodeCommand) {
    return this.serialize(async () => {
      try {
        if (control.type === 'run') {
          this.state = 'running';
          clearTimeout(this.grace);
          await this.drain();
          this.schedule();
        } else if (control.type === 'pause') {
          this.state = 'paused';
          this.stopScheduling();
          // Never send 'pause' to Renode through the monitor: after a RunFor auto-pause,
          // an explicit 'pause' leaves the machine in a state where the next RunFor blocks.
          // The machine is already halted after each completed RunFor slice; we only
          // track running/paused state here. Step uses 'cpu Step' which does not block.
          await this.drain();
        } else if (control.type === 'reset') {
          this.state = 'ready';
          this.stopScheduling();
          await this.command('Clear');
          await this.loadMachine();
          await this.drain();
        } else if (control.type === 'step') {
          if (this.state === 'running') throw new CompileError('Pause before stepping one instruction', 409);
          // Wake the core from WFI sleep unconditionally; Step on a sleeping core executes the WFI
          // without advancing to application code. RequestWakeUpFromWfi is a no-op on a running core.
          await this.command('cpu RequestWakeUpFromWfi');
          await this.command('cpu Step 4');
          // Renode leaves the CPU in SingleStep mode after cpu.Step; restore continuous mode.
          await this.command('cpu ExecutionMode Continuous');
          this.state = 'paused';
          await this.drain();
        } else if (control.type === 'button') {
          await this.command(`sysbus.gpioPortA.UserButton ${control.pressed ? 'Press' : 'Release'}`);
          await this.drain();
        }
      } catch (error) {
        if (!(error instanceof CompileError)) await this.fail(error);
        throw error;
      }
    });
  }

  async registers() {
    return this.serialize(async () => {
      if (this.state === 'running') throw new CompileError('Pause before reading registers', 409);
      try {
        const snapshot = jsonPayload<Omit<RegisterSnapshot, 'disassembly'>>(await this.command('python "wb_registers()"'));
        const pc = snapshot.cpu.PC;
        if (!/^0x[0-9a-f]{1,16}$/i.test(pc)) throw new Error('Invalid PC returned by Renode');
        const disassembly = await this.command(`cpu DisassembleBlock ${pc} 24`);
        return { ...snapshot, disassembly: disassembly.split(/[\r\n]+/).filter(line => /^0x[0-9a-f]+:/i.test(line)).join('\n') } satisfies RegisterSnapshot;
      } catch (error) { await this.fail(error); throw error; }
    });
  }

  subscribe(response: ServerResponse) {
    if (this.disposed) throw new CompileError('Renode session is closed', 410);
    if (this.subscriber) throw new CompileError('This session already has an event subscriber', 409);
    clearTimeout(this.grace);
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    this.subscriber = response;
    this.publish({ ...this.frame, events: [] });
    response.on('close', () => {
      if (this.subscriber !== response) return;
      this.subscriber = undefined;
      this.armGrace(3000);
    });
  }

  private armGrace(milliseconds: number) {
    clearTimeout(this.grace);
    this.grace = setTimeout(() => { void this.dispose(); }, milliseconds);
    this.grace.unref();
  }

  private async fail(error: unknown) {
    if (this.disposed) return;
    this.state = 'error';
    this.publish({ ...this.frame, state: 'error', events: [], warnings: [...CAVEATS, ...this.warnings], error: error instanceof Error ? error.message : String(error) });
    await this.dispose(false);
  }

  async dispose(notify = true) {
    if (this.disposed) return;
    this.disposed = true;
    this.stopScheduling();
    clearTimeout(this.expiry);
    clearTimeout(this.grace);
    if (notify) this.publish({ ...this.frame, state: 'closed', events: [] });
    this.subscriber?.end();
    this.subscriber = undefined;
    this.monitor?.close();
    const child = this.process;
    if (child?.pid) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already exited. */ }
      await delay(200);
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already exited. */ }
    }
    if (this.directory) await rm(this.directory, { recursive: true, force: true });
    sessions.delete(this.id);
  }

  killSync() {
    if (this.process?.pid) { try { process.kill(-this.process.pid, 'SIGKILL'); } catch { /* Already exited. */ } }
  }
}

export async function createRenodeSession(buildId: string) {
  if (shuttingDown) throw new CompileError('Server is shutting down', 503);
  if (sessions.size >= MAX_SESSIONS) throw new CompileError('Both Renode session slots are busy; close an existing tab first.', 429);
  const session = new RenodeSession();
  sessions.set(session.id, session);
  try {
    await session.initialize(buildId);
    return session;
  } catch (error) {
    await session.dispose(false);
    if (error instanceof CompileError) throw error;
    throw new CompileError(error instanceof Error ? error.message : 'Renode startup failed', 503);
  }
}

export function ownedRenodeSession(id: string, token: string) {
  const session = sessions.get(id);
  if (!session || !token || token !== session.token) throw new CompileError('Renode session not found', 404);
  return session;
}

export async function disposeRenodeSessions() {
  shuttingDown = true;
  await Promise.all([...sessions.values()].map(session => session.dispose()));
}

process.once('exit', () => { for (const session of sessions.values()) session.killSync(); });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void disposeRenodeSessions().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143)); });
}
