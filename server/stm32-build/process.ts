import { execFile, spawn } from 'node:child_process';
import { ProcessFailure } from '../process.js';

// Native macOS offers no reliable RLIMIT_AS. Bound observed process-group RSS
// instead, killing the complete group above 1 GiB. This is a sampled watchdog,
// not a hard kernel allocation quota; the UI describes that distinction.
export async function runBoundedCompiler(args: string[], options: {
  cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; outputLimit: number;
}): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const child = spawn('/usr/bin/sandbox-exec', args, {
    cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  let reason: string | undefined;
  let bytes = 0;
  let closed = false;
  let sampling = false;
  const chunks: Buffer[] = [];
  const kill = (message: string) => {
    reason ??= message;
    try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  };
  const collect = (chunk: Buffer) => {
    const remaining = Math.max(0, options.outputLimit - bytes);
    if (remaining) chunks.push(chunk.subarray(0, remaining));
    bytes += chunk.length;
    if (bytes > options.outputLimit) kill('Compiler diagnostics exceeded their output limit');
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const deadline = setTimeout(() => kill('Compiler process exceeded its wall-time limit'), options.timeoutMs);
  const monitor = setInterval(() => {
    if (sampling || closed || !child.pid) return;
    sampling = true;
    execFile('/bin/ps', ['-axo', 'pgid=,rss='], { timeout: 1500, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
      sampling = false;
      if (closed) return;
      if (error) { kill('Compiler memory watchdog failed; build stopped safely'); return; }
      let rssKiB = 0;
      for (const line of stdout.split('\n')) {
        const fields = line.trim().split(/\s+/);
        if (Number(fields[0]) === child.pid) rssKiB += Number(fields[1]) || 0;
      }
      if (rssKiB > 1024 * 1024) kill('Compiler process group exceeded the sampled 1 GiB memory limit');
    });
  }, 250);
  child.once('error', error => {
    closed = true;
    clearTimeout(deadline);
    clearInterval(monitor);
    reject(new ProcessFailure(error.message));
  });
  child.once('close', code => {
    closed = true;
    clearTimeout(deadline);
    clearInterval(monitor);
    const diagnostics = Buffer.concat(chunks).toString('utf8');
    if (reason || code !== 0) reject(new ProcessFailure(reason ?? `Compiler process exited with code ${code}`, diagnostics));
    else resolve(diagnostics);
  });
  return promise;
}
