import { access, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runProcess } from '../process.js';
import { ROOT } from '../compiler.js';
import { runBoundedCompiler } from './process.js';

export type NativeTools = { compiler: string; cmake: string; ninja: string; dtc: string; gperf: string; python: string; roots: string[] };
const workspace = path.join(ROOT, '.stm32/zephyr-workspace');
const venv = path.join(ROOT, '.stm32/zephyr-venv');
export const MAX_DIAGNOSTICS = 192 * 1024;
export const MAX_ELF = 4 * 1024 * 1024;
const toolCache: Partial<Record<'baremetal' | 'zephyr', Promise<NativeTools>>> = {};

async function executable(name: string): Promise<string> {
  for (const directory of (process.env.PATH ?? '/opt/homebrew/bin:/usr/bin:/bin').split(path.delimiter)) {
    if (!path.isAbsolute(directory)) continue;
    const candidate = path.join(directory, name);
    try { await access(candidate, constants.X_OK); return await realpath(candidate); } catch { /* Try the next PATH directory. */ }
  }
  throw new Error(`Missing ${name}; install the STM32 source-build prerequisites.`);
}

function installationRoot(file: string): string {
  const brew = file.match(/^\/opt\/homebrew\/Cellar\/[^/]+\/[^/]+/);
  if (brew) return brew[0];
  const arm = file.match(/^\/Applications\/ArmGNUToolchain\/[^/]+\/arm-none-eabi/);
  if (arm) return arm[0];
  if (file.startsWith('/usr/bin/') || file.startsWith('/bin/')) return file;
  throw new Error(`Unsupported native tool installation: ${file}`);
}

async function loadTools(zephyr: boolean): Promise<NativeTools> {
  if (process.platform !== 'darwin' || process.env.FIRMWARE_COMPILER_MODE !== 'native') {
    throw new Error('STM32 builds require explicit FIRMWARE_COMPILER_MODE=native on macOS with sandbox-exec; no unsandboxed fallback is provided.');
  }
  await access('/usr/bin/sandbox-exec', constants.X_OK);
  const compiler = await executable('arm-none-eabi-gcc');
  const tools: NativeTools = { compiler, cmake: '', ninja: '', dtc: '', gperf: '', python: '', roots: [installationRoot(compiler)] };
  if (zephyr) {
    for (const name of ['cmake', 'ninja', 'dtc', 'gperf'] as const) tools[name] = await executable(name);
    tools.python = path.join(venv, 'bin/python');
    await access(tools.python, constants.X_OK);
    const pythonConfig = await readFile(path.join(venv, 'pyvenv.cfg'), 'utf8');
    const pythonExecutable = pythonConfig.match(/^executable = (.+)$/m)?.[1];
    if (!pythonExecutable) throw new Error('Missing trusted Zephyr Python environment; run scripts/setup-zephyr-proof.py.');
    tools.roots.push(installationRoot(await realpath(pythonExecutable)));
    for (const name of ['cmake', 'ninja', 'dtc', 'gperf'] as const) tools.roots.push(installationRoot(tools[name]));
    await Promise.all([path.join(workspace, 'zephyr/VERSION'), path.join(workspace, 'modules/hal/cmsis'), path.join(workspace, 'modules/hal/cmsis_6'), path.join(workspace, 'modules/hal/stm32')].map(file => access(file)));
    // Resolve non-system dylibs without granting all of Homebrew or the host filesystem.
    const pending = [compiler, tools.cmake, tools.ninja, tools.dtc, tools.gperf, pythonExecutable];
    const visited = new Set<string>();
    while (pending.length) {
      const file = pending.pop()!;
      if (visited.has(file)) continue;
      visited.add(file);
      const output = await runProcess('/usr/bin/otool', ['-L', file], { timeoutMs: 2000, outputLimit: 16 * 1024 });
      for (const match of output.matchAll(/^\s+(\/opt\/homebrew\/[^\s]+)\s+\(/gm)) {
        const library = await realpath(match[1]);
        tools.roots.push(installationRoot(library));
        pending.push(library);
      }
    }
  }
  tools.roots = [...new Set(tools.roots)];
  return tools;
}

export function nativeTools(zephyr: boolean): Promise<NativeTools> {
  const key = zephyr ? 'zephyr' : 'baremetal';
  return toolCache[key] ??= loadTools(zephyr).catch(error => { delete toolCache[key]; throw error; });
}

export async function sandboxFile(directory: string, tools: NativeTools, zephyr: boolean): Promise<string> {
  const quote = JSON.stringify;
  const readRoots = [...tools.roots, directory, ...(zephyr ? [workspace, venv] : [])];
  const content = `(version 1)
(deny default)
(import "dyld-support.sb")
(allow process-fork)
(allow process-exec ${[...tools.roots, ...(zephyr ? [path.join(workspace, 'zephyr/scripts')] : [])].map(root => `(subpath ${quote(root)})`).join(' ')}
  ${[tools.python, '/bin/sh', '/bin/bash', '/usr/bin/uname', '/usr/bin/env', '/usr/bin/git', '/bin/pwd', '/bin/cat', '/usr/bin/true'].filter(Boolean).map(file => `(literal ${quote(file)})`).join(' ')})
(allow signal (target self))
(allow sysctl-read)
(allow file-read-metadata)
(allow file-read-data (literal "/") (literal "/usr") (literal "/usr/bin") (literal "/bin"))
(allow file-read* (subpath "/System/Library") (subpath "/usr/lib") (subpath "/private/var/db/dyld")
  ${readRoots.map(root => `(subpath ${quote(root)})`).join(' ')}
  ${['/bin/sh', '/bin/bash', '/usr/bin/uname', '/usr/bin/env', '/usr/bin/git', '/bin/pwd', '/bin/cat', '/usr/bin/true', '/dev/null', '/dev/urandom', '/dev/random'].map(file => `(literal ${quote(file)})`).join(' ')})
(allow file-write* (subpath ${quote(directory)}) (literal "/dev/null"))
`;
  const file = path.join(directory, 'compiler.sb');
  await writeFile(file, content, { mode: 0o600 });
  return file;
}

export function buildEnvironment(directory: string, tools: NativeTools): NodeJS.ProcessEnv {
  return {
    PATH: [...new Set([path.dirname(tools.compiler), ...[tools.cmake, tools.ninja, tools.dtc, tools.gperf].filter(Boolean).map(file => path.dirname(file)), '/usr/bin', '/bin'])].join(':'),
    HOME: directory, TMPDIR: directory, TMP: directory, TEMP: directory, LANG: 'C', LC_ALL: 'C',
    PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1', SOURCE_DATE_EPOCH: '1735689600',
    ZEPHYR_BASE: path.join(workspace, 'zephyr'), ZEPHYR_TOOLCHAIN_VARIANT: 'cross-compile',
    CROSS_COMPILE: path.join(path.dirname(tools.compiler), 'arm-none-eabi-'),
  };
}

export async function sandboxCommand(directory: string, tools: NativeTools, profile: string, command: string, args: string[], timeoutMs: number, outputLimit = MAX_DIAGNOSTICS): Promise<string> {
  // CPU and per-file limits are enforced by the kernel. macOS does not reliably enforce
  // RLIMIT_AS; this localhost-only service does not claim a hard aggregate RAM limit.
  return runBoundedCompiler(['-f', profile, '/bin/sh', '-c', 'set -e; ulimit -f 32768; ulimit -t 60; ulimit -n 256; exec "$@"', 'stm32-compiler', command, ...args], {
    cwd: directory, env: buildEnvironment(directory, tools), timeoutMs, outputLimit,
  });
}

export async function probeSandbox(zephyr: boolean): Promise<void> {
  const tools = await nativeTools(zephyr);
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'stm32-health-')));
  const outside = await realpath(await mkdtemp(path.join(os.tmpdir(), 'stm32-secret-')));
  try {
    await writeFile(path.join(outside, 'secret'), 'sandbox sentinel');
    const profile = await sandboxFile(directory, tools, zephyr);
    const result = await sandboxCommand(directory, tools, profile, '/bin/sh', ['-c', 'if /bin/cat "$1" >/dev/null 2>&1; then exit 7; fi; printf sandbox-denied', 'probe', path.join(outside, 'secret')], 3000);
    if (result !== 'sandbox-denied') throw new Error('Native sandbox filesystem isolation probe failed.');
    await writeFile(path.join(directory, 'probe.c'), 'int probe(void) { return 42; }\n');
    await sandboxCommand(directory, tools, profile, tools.compiler, ['-mcpu=cortex-m4', '-mthumb', '-ffreestanding', '-c', 'probe.c', '-o', 'probe.o'], 8000);
    if (!(await stat(path.join(directory, 'probe.o'))).size) throw new Error('Native sandbox compiler health probe produced no object.');
    if (zephyr) await sandboxCommand(directory, tools, profile, tools.python, ['-c', 'import yaml, elftools; print("zephyr-python-ready")'], 8000);
  } finally {
    await Promise.all([rm(directory, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]);
  }
}

export async function compileNative(directory: string, zephyr: boolean): Promise<{ elfPath: string; diagnostics: string }> {
  const tools = await nativeTools(zephyr);
  const profile = await sandboxFile(directory, tools, zephyr);
  const elfPath = path.join(directory, zephyr ? 'build/zephyr/zephyr.elf' : 'firmware.elf');
  let diagnostics = '';
  if (zephyr) {
    const modules = ['cmsis', 'cmsis_6', 'stm32'].map(name => path.join(workspace, 'modules/hal', name));
    diagnostics += await sandboxCommand(directory, tools, profile, tools.cmake, ['-S', directory, '-B', path.join(directory, 'build'), '-G', 'Ninja',
      '-DBOARD=stm32f4_disco/stm32f407xx', `-DPython3_EXECUTABLE=${tools.python}`, `-DPYTHON_EXECUTABLE=${tools.python}`,
      '-DZEPHYR_TOOLCHAIN_VARIANT=cross-compile', `-DCROSS_COMPILE=${path.join(path.dirname(tools.compiler), 'arm-none-eabi-')}`,
      `-DUSER_CACHE_DIR=${path.join(directory, 'cache')}`, `-DZEPHYR_MODULES=${modules.join(';')}`, `-DCMAKE_MAKE_PROGRAM=${tools.ninja}`], 45_000);
    diagnostics += await sandboxCommand(directory, tools, profile, tools.cmake, ['--build', path.join(directory, 'build'), '--parallel', '2'], 60_000, Math.max(1, MAX_DIAGNOSTICS - Buffer.byteLength(diagnostics)));
  } else {
    diagnostics = await sandboxCommand(directory, tools, profile, tools.compiler, ['-mcpu=cortex-m4', '-mthumb', '-mfloat-abi=soft', '-Og', '-g3', '-ffreestanding', '-fno-builtin', '-nostdlib', '-Wall', '-Wextra', '-Werror', '-fdiagnostics-color=never', '-fmax-errors=12', '-T', path.join(directory, 'linker.ld'), '-Wl,--build-id=none', `-Wl,-Map=${path.join(directory, 'firmware.map')}`, path.join(directory, 'main.c'), '-o', elfPath], 15_000);
  }
  const info = await stat(elfPath);
  if (!info.isFile() || info.size < 52 || info.size > MAX_ELF) throw new Error('Firmware ELF exceeds the 4 MiB artifact limit or is invalid.');
  const header = await readFile(elfPath);
  if (header.subarray(0, 4).toString('hex') !== '7f454c46' || header[4] !== 1 || header.readUInt16LE(18) !== 40) throw new Error('Compiler did not produce a 32-bit ARM ELF.');
  return { elfPath, diagnostics };
}
