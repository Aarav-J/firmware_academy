import { spawn } from 'node:child_process';

export class ProcessFailure extends Error {
  constructor(message: string, public diagnostics = '') { super(message); }
}

export async function runProcess(command: string, args: string[], options: {
  cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; outputLimit?: number;
} = {}): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const child = spawn(command, args, {
    cwd: options.cwd, env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
  });
  const chunks: Buffer[] = [];
  const limit = options.outputLimit ?? 64 * 1024;
  let bytes = 0;
  let failure: string | undefined;
  const stop = (reason: string) => {
    failure ??= reason;
    try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  };
  const timer = setTimeout(() => stop('Compiler process exceeded its time limit'), options.timeoutMs ?? 20_000);
  const collect = (chunk: Buffer) => {
    const available = Math.max(0, limit - bytes);
    if (available) chunks.push(chunk.subarray(0, available));
    bytes += chunk.length;
    if (bytes > limit) stop('Compiler diagnostics exceeded their output limit');
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.once('error', error => { clearTimeout(timer); reject(new ProcessFailure(error.message)); });
  child.once('close', code => {
    clearTimeout(timer);
    const diagnostics = Buffer.concat(chunks).toString('utf8');
    if (failure || code !== 0) reject(new ProcessFailure(failure ?? `Compiler process exited with code ${code}`, diagnostics));
    else resolve(diagnostics);
  });
  return promise;
}
