import { access, chmod, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CompileResult, CompilerHealth } from '../src/contracts.js';
import { buildFirmware, MAX_ARTIFACT_BYTES, sandboxProfile, type BuildManifest } from './build.js';
import { ProcessFailure, runProcess } from './process.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MAX_SOURCE_BYTES = 64 * 1024;
const IMAGE = 'firmware-academy-compiler:latest';
let inFlight = 0;
let healthCache: { expires: number; result: CompilerHealth } | undefined;

export class CompileError extends Error {
  constructor(message: string, public status = 422, public diagnostics?: string) { super(message); }
}

async function nativeManifest(): Promise<BuildManifest> {
  const manifest = JSON.parse(await readFile(path.join(ROOT, '.pico/manifest.json'), 'utf8')) as BuildManifest;
  if (manifest.version !== 1 || manifest.root !== ROOT || !Array.isArray(manifest.compile) || !Array.isArray(manifest.link)) {
    throw new Error('Toolchain manifest is stale; run npm run setup:pico');
  }
  await Promise.all([manifest.compiler, manifest.linker, manifest.objcopy, manifest.build, manifest.sdk].map(location => access(location)));
  return manifest;
}

export async function compilerHealth(): Promise<CompilerHealth> {
  if (healthCache && healthCache.expires > Date.now()) return healthCache.result;
  const native = process.env.FIRMWARE_COMPILER_MODE === 'native';
  let result: CompilerHealth;
  try {
    if (native) {
      if (process.platform !== 'darwin') throw new Error('Native development requires macOS sandbox-exec; use Docker on this platform');
      const manifest = await nativeManifest();
      const probe = await realpath(await mkdtemp(path.join(os.tmpdir(), 'pico-sandbox-check-')));
      try {
        const profile = path.join(probe, 'check.sb');
        await writeFile(profile, sandboxProfile(manifest, probe));
        await runProcess('/usr/bin/sandbox-exec', ['-f', profile, '/bin/sh', '-c', 'set -e; ulimit -f 8192; ulimit -t 8; exec /usr/bin/true'], { timeoutMs: 3000 });
      } finally { await rm(probe, { recursive: true, force: true }); }
      result = { ready: true, backend: 'native-sandbox', message: 'Local development: macOS sandbox-exec, pinned Pico SDK 2.1.1. USB CDC and UART enabled. CPU/time/files are bounded; use Docker for a hard memory limit.' };
    } else {
      if (process.env.FIRMWARE_COMPILER_MODE && process.env.FIRMWARE_COMPILER_MODE !== 'docker') throw new Error('FIRMWARE_COMPILER_MODE must be docker or native');
      await runProcess('docker', ['info', '--format', '{{.ServerVersion}}'], { timeoutMs: 3000 });
      await runProcess('docker', ['image', 'inspect', IMAGE], { timeoutMs: 3000, outputLimit: 128 * 1024 });
      result = { ready: true, backend: 'docker', message: 'Docker compiler ready: no network, read-only root, unprivileged user, bounded CPU/memory/processes.' };
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    result = { ready: false, backend: native ? 'native-sandbox' : 'docker', message: native
      ? `Native compiler unavailable: ${detail}. Run npm run setup:pico; sandbox support is required.`
      : `Docker compiler unavailable: ${detail}. Start Docker and run docker build -t firmware-academy-compiler .; on macOS, explicitly opt into local development with npm run setup:pico then npm run dev:native.` };
  }
  healthCache = { expires: Date.now() + 5000, result };
  return result;
}

export async function compile(source: unknown): Promise<CompileResult> {
  if (typeof source !== 'string' || !source.trim()) throw new CompileError('source must be a non-empty C source string', 400);
  if (source.includes('\0')) throw new CompileError('Source cannot contain NUL bytes', 400);
  if (Buffer.byteLength(source, 'utf8') > MAX_SOURCE_BYTES) throw new CompileError('Source exceeds the 64 KiB limit', 413);
  if (inFlight >= 2) throw new CompileError('Both compiler slots are busy. Try again shortly.', 429);
  inFlight++;
  let directory: string | undefined;
  let containerName: string | undefined;
  try {
    const health = await compilerHealth();
    if (!health.ready) throw new CompileError(health.message, 503);
    directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'pico-compile-')));
    await writeFile(path.join(directory, 'main.c'), source, { mode: 0o644 });
    let diagnostics: string;
    if (health.backend === 'native-sandbox') {
      diagnostics = await buildFirmware(await nativeManifest(), directory, true);
    } else {
      await chmod(directory, 0o777);
      containerName = `pico-compile-${path.basename(directory).replace(/[^a-zA-Z0-9-]/g, '').toLowerCase()}`;
      diagnostics = await runProcess('docker', [
        'run', '--rm', '--name', containerName, '--network=none', '--read-only',
        '--cap-drop=ALL', '--security-opt=no-new-privileges', '--memory=384m', '--memory-swap=384m',
        '--cpus=1', '--pids-limit=64', '--ulimit', 'fsize=8388608:8388608', '--ulimit', 'cpu=15:15',
        '--user=65534:65534', '--tmpfs', '/tmp:rw,noexec,nosuid,size=32m',
        '--mount', `type=bind,src=${directory},dst=/job`, IMAGE,
      ], { timeoutMs: 25_000, outputLimit: 64 * 1024 });
    }
    const elfPath = path.join(directory, 'firmware.elf');
    const uf2Path = path.join(directory, 'firmware.uf2');
    const sizes = await Promise.all([stat(elfPath), stat(uf2Path)]);
    if (sizes.some(file => !file.isFile() || file.size > MAX_ARTIFACT_BYTES)) throw new CompileError('Compiled artifacts exceed the output limit');
    const [elf, uf2] = await Promise.all([readFile(elfPath), readFile(uf2Path)]);
    return { elf: elf.toString('base64'), uf2: uf2.toString('base64'), diagnostics: diagnostics.trim() };
  } catch (error) {
    if (error instanceof CompileError) throw error;
    if (error instanceof ProcessFailure) {
      const diagnostics = error.diagnostics.replaceAll(directory ?? '\0', '/build');
      throw new CompileError(error.message, 422, diagnostics);
    }
    throw new CompileError(error instanceof Error ? error.message : 'Compilation failed', 500);
  } finally {
    try {
      if (containerName) await runProcess('docker', ['rm', '-f', containerName], { timeoutMs: 3000 }).catch(() => undefined);
      if (directory) await rm(directory, { recursive: true, force: true });
    } finally { inFlight--; }
  }
}
