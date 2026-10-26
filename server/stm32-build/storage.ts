import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from '../compiler.js';

let storage: Promise<string> | undefined;
async function initializeStorage(): Promise<string> {
  const parent = path.join(await realpath(os.tmpdir()), `firmware-academy-stm32-${createHash('sha256').update(ROOT).digest('hex').slice(0, 16)}`);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const info = await lstat(parent);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) throw new Error('STM32 temporary storage is not a private owned directory.');
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[1-9][0-9]*$/.test(entry.name)) continue;
    const pid = Number(entry.name);
    if (pid === process.pid) continue;
    try { process.kill(pid, 0); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') await rm(path.join(parent, entry.name), { recursive: true, force: true });
    }
  }
  const directory = path.join(parent, String(process.pid));
  // A reused PID can leave stale artifacts, but no live process shares our PID.
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { mode: 0o700 });
  return directory;
}

export async function projectTempDirectory(kind: 'request' | 'artifact'): Promise<string> {
  storage ??= initializeStorage().catch(error => { storage = undefined; throw error; });
  return realpath(await mkdtemp(path.join(await storage, `${kind}-`)));
}
