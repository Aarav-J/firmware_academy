import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ExternalProjectId, ProjectBuildInput, ProjectBuildResult, ProjectProfile, Stm32ProjectId } from '../src/workbench-contracts.js';
import { CompileError, ROOT } from './compiler.js';
import { ProcessFailure } from './process.js';
import { compileNative, probeSandbox } from './stm32-build/native.js';
import { ARDUINO_DEFAULT_SKETCH, compileArduino, probeArduino } from './stm32-build/arduino.js';
import { projectTempDirectory } from './stm32-build/storage.js';

const FILE_LIMIT = 64 * 1024;
const SOURCE_LIMIT = 128 * 1024;
const BUILD_TTL = 15 * 60 * 1000;
const MAX_BUILDS = 12;
const editable: Record<Stm32ProjectId, string[]> = {
  'stm32-baremetal': ['main.c', 'linker.ld'],
  'stm32-zephyr': ['src/main.c', 'prj.conf', 'app.overlay'],
};
const configTypes: Record<string, 'bool' | 'integer'> = {
  GPIO: 'bool', SERIAL: 'bool', CONSOLE: 'bool', UART_CONSOLE: 'bool', PRINTK: 'bool', LOG: 'bool',
  BOOT_BANNER: 'bool', FPU: 'bool', MAIN_STACK_SIZE: 'integer', HEAP_MEM_POOL_SIZE: 'integer',
  SYS_CLOCK_TICKS_PER_SEC: 'integer', TICKLESS_KERNEL: 'bool', THREAD_NAME: 'bool',
  ASSERT: 'bool', DEBUG: 'bool', DEBUG_INFO: 'bool', SIZE_OPTIMIZATIONS: 'bool', SPEED_OPTIMIZATIONS: 'bool',
  NO_OPTIMIZATIONS: 'bool', LOG_DEFAULT_LEVEL: 'integer', NUM_PREEMPT_PRIORITIES: 'integer',
  SYSTEM_WORKQUEUE_STACK_SIZE: 'integer', UART_INTERRUPT_DRIVEN: 'bool', REBOOT: 'bool',
};
type BuiltProject = { profile: ExternalProjectId; elfPath: string; hexPath?: string; directory: string; diagnostics: string; expires: number };
const builds = new Map<string, BuiltProject>();
let inFlight = false;
let arduinoInFlight = false;
const health: Partial<Record<ExternalProjectId, { expires: number; available: boolean; message: string }>> = {};
let healthPending: Promise<void> | undefined;

async function removeExpired(): Promise<void> {
  const removals: Promise<void>[] = [];
  for (const [id, build] of builds) {
    if (build.expires <= Date.now()) {
      builds.delete(id);
      removals.push(rm(build.directory, { recursive: true, force: true }));
    }
  }
  await Promise.all(removals);
}
const cleanupTimer = setInterval(() => { void removeExpired().catch(error => console.error('STM32 build cleanup failed:', error)); }, 60_000);
cleanupTimer.unref();

async function refreshHealth(): Promise<void> {
  for (const profile of ['stm32-baremetal', 'stm32-zephyr'] as const) {
    if (health[profile] && health[profile]!.expires > Date.now()) continue;
    try {
      await probeSandbox(profile === 'stm32-zephyr');
      health[profile] = { expires: Date.now() + 30_000, available: true, message: 'Native localhost compiler verified inside a deny-by-default filesystem/network sandbox. One build at a time; CPU, file, output and wall-time limits apply. A 250 ms watchdog stops process groups above 1 GiB observed RSS; this is not a hard kernel RAM quota.' };
    } catch (error) {
      health[profile] = { expires: Date.now() + 5000, available: false, message: error instanceof ProcessFailure ? `${error.message}: ${error.diagnostics}` : error instanceof Error ? error.message : 'Native compiler is unavailable.' };
    }
  }
  if (!health['arduino-uno'] || health['arduino-uno'].expires <= Date.now()) {
    try {
      await probeArduino();
      health['arduino-uno'] = { expires: Date.now() + 30_000, available: true, message: 'arduino-cli 1.5.1 with arduino:avr:uno core. Builds run in an isolated per-request temp directory with a 60 s wall-time limit. No network access during compile.' };
    } catch (error) {
      health['arduino-uno'] = { expires: Date.now() + 5_000, available: false, message: error instanceof Error ? error.message : 'arduino-cli or the arduino:avr:uno core is unavailable.' };
    }
  }
}

export async function getProfiles(): Promise<ProjectProfile[]> {
  if (!healthPending) healthPending = refreshHealth().finally(() => { healthPending = undefined; });
  await healthPending;
  const stm32Profiles = await Promise.all((['stm32-baremetal', 'stm32-zephyr'] as const).map(async id => {
    const zephyr = id === 'stm32-zephyr';
    const sourceDirectory = path.join(ROOT, 'proofs/stm32', zephyr ? 'zephyr' : 'baremetal');
    const files = await Promise.all([...editable[id], ...(zephyr ? ['CMakeLists.txt'] : [])].map(async file => ({
      path: file, content: await readFile(path.join(sourceDirectory, file), 'utf8'), editable: file !== 'CMakeLists.txt',
    })));
    return {
      id, name: zephyr ? 'STM32 · Zephyr' : 'STM32 · Bare metal', board: 'STM32F4 Discovery · STM32F407',
      framework: zephyr ? 'Zephyr 4.2.1' : 'Arm GNU C',
      description: zephyr ? 'Build editable C, Kconfig and devicetree files against the pinned Zephyr source tree. CMake is server-owned. Kconfig accepts the safe boolean/numeric application settings shown in the template plus standard debug, logging and optimization settings.' : 'Build editable startup/application C and a linker script directly for the Cortex-M4. PD12 blinks, PA0 controls PD13, and USART2 prints firmware output.',
      files, available: health[id]!.available, message: health[id]!.message,
    };
  }));
  const arduinoProfile: ProjectProfile = {
    id: 'arduino-uno',
    name: 'Arduino · Uno',
    board: 'Arduino Uno · ATmega328P',
    framework: 'arduino-cli 1.5.1 · arduino:avr 1.8.8',
    description: 'Compile editable sketch.ino for the ATmega328P. Pin 13 (PB5) is the onboard LED. Serial.begin()/println() targets UART0. avr8js simulates the board in-browser; no hardware required.',
    files: [{ path: 'sketch.ino', content: ARDUINO_DEFAULT_SKETCH, editable: true }],
    available: health['arduino-uno']!.available,
    message: health['arduino-uno']!.message,
  };
  return [...stm32Profiles, arduinoProfile];
}

function validateInput(input: unknown): ProjectBuildInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CompileError('Expected a project build object.', 400);
  const { profile, files } = input as Partial<ProjectBuildInput>;
  if (profile !== 'stm32-baremetal' && profile !== 'stm32-zephyr' && profile !== 'arduino-uno') throw new CompileError('Unknown project profile.', 400);
  if (!files || typeof files !== 'object' || Array.isArray(files)) throw new CompileError('files must be an object containing the exact editable project filenames.', 400);
  if (profile === 'arduino-uno') {
    const keys = Object.keys(files);
    if (keys.length !== 1 || !Object.prototype.hasOwnProperty.call(files, 'sketch.ino')) {
      throw new CompileError('Expected exactly one file: sketch.ino. Additional files are not accepted.', 400);
    }
    const content: unknown = files['sketch.ino'];
    if (typeof content !== 'string' || content.includes('\0')) throw new CompileError('sketch.ino must be a string without NUL bytes.', 400);
    if (Buffer.byteLength(content) > FILE_LIMIT) throw new CompileError('sketch.ino exceeds the 64 KiB file limit.', 413);
    return { profile, files: { 'sketch.ino': content } };
  }
  // STM32 profiles — validate file list, sizes, and Zephyr Kconfig
  const keys = Object.keys(files);
  if (keys.length !== editable[profile].length || keys.some(file => !editable[profile].includes(file))) {
    throw new CompileError(`Expected exactly these editable files: ${editable[profile].join(', ')}. Build scripts and additional paths are not accepted.`, 400);
  }
  let total = 0;
  for (const name of editable[profile]) {
    const content: unknown = files[name];
    if (typeof content !== 'string' || content.includes('\0')) throw new CompileError(`${name} must be a string without NUL bytes.`, 400);
    const bytes = Buffer.byteLength(content);
    if (bytes > FILE_LIMIT) throw new CompileError(`${name} exceeds the 64 KiB file limit.`, 413);
    total += bytes;
  }
  if (total > SOURCE_LIMIT) throw new CompileError('Project source exceeds the 128 KiB limit.', 413);
  if (profile === 'stm32-zephyr') {
    // Values that become command flags, build scripts, paths or Kconfig expansion are
    // intentionally unavailable. Source and overlay preprocessing still run sandboxed.
    for (const [index, line] of files['prj.conf'].split(/\r?\n/).entries()) {
      if (!line.trim() || /^\s*#/.test(line)) continue;
      const match = line.match(/^\s*CONFIG_([A-Z0-9_]+)=(y|n|[0-9]+)\s*(?:#.*)?$/);
      const kind = match && configTypes[match[1]];
      if (!match || !kind || (kind === 'bool' ? !/^[yn]$/.test(match[2]) : !/^\d+$/.test(match[2]) || Number(match[2]) > 262144)) {
        throw new CompileError(`prj.conf:${index + 1}: unsupported setting. Only approved boolean/numeric application Kconfig options are accepted; paths, expressions and build flags are prohibited.`, 400);
      }
    }
  }
  // Copy only the exact approved keys; never preserve a caller-controlled prototype.
  return { profile, files: Object.fromEntries(editable[profile].map(file => [file, files[file]])) };
}

export async function buildProject(input: unknown): Promise<ProjectBuildResult> {
  const request = validateInput(input);

  // ── Arduino Uno path ─────────────────────────────────────────────────────
  if (request.profile === 'arduino-uno') {
    if (arduinoInFlight) throw new CompileError('The Arduino compiler slot is busy. Try again shortly.', 429);
    arduinoInFlight = true;
    let arduinoDir: string | undefined;
    try {
      await removeExpired();
      if (builds.size >= MAX_BUILDS) throw new CompileError('The temporary build store is full. Builds expire after 15 minutes.', 429);
      // Reuse the shared health-refresh path so arduino-uno is always probed before building.
      const allProfiles = await getProfiles();
      const arduinoProfile = allProfiles.find(item => item.id === 'arduino-uno')!;
      if (!arduinoProfile.available) throw new CompileError(arduinoProfile.message, 503);
      arduinoDir = await projectTempDirectory('request');
      const { elfPath, hexPath, diagnostics } = await compileArduino(arduinoDir, request.files['sketch.ino']);
      const artifactDirectory = await projectTempDirectory('artifact');
      const artifactElf = path.join(artifactDirectory, 'firmware.elf');
      const artifactHex = path.join(artifactDirectory, 'firmware.hex');
      try {
        await Promise.all([copyFile(elfPath, artifactElf), copyFile(hexPath, artifactHex)]);
        await rm(arduinoDir, { recursive: true, force: true });
        arduinoDir = artifactDirectory;
      } catch (error) {
        await rm(artifactDirectory, { recursive: true, force: true });
        throw error;
      }
      const hex = (await readFile(artifactHex)).toString('base64');
      const buildId = randomBytes(24).toString('hex');
      builds.set(buildId, { profile: 'arduino-uno', elfPath: artifactElf, hexPath: artifactHex, directory: artifactDirectory, diagnostics, expires: Date.now() + BUILD_TTL });
      arduinoDir = undefined;
      return { buildId, profile: 'arduino-uno', diagnostics, hex };
    } catch (error) {
      if (error instanceof CompileError) throw error;
      if (error instanceof ProcessFailure) throw new CompileError(error.message, 422, error.diagnostics);
      throw new CompileError(error instanceof Error ? error.message : 'Arduino build failed.', 503);
    } finally {
      arduinoInFlight = false;
      if (arduinoDir) await rm(arduinoDir, { recursive: true, force: true });
    }
  }

  // ── STM32 path ───────────────────────────────────────────────────────────
  if (inFlight) throw new CompileError('The STM32 compiler slot is busy. Try again shortly.', 429);
  inFlight = true;
  let directory: string | undefined;
  try {
    await removeExpired();
    if (builds.size >= MAX_BUILDS) throw new CompileError('The temporary build store is full. Builds expire after 15 minutes.', 429);
    const profiles = await getProfiles();
    const profile = profiles.find(item => item.id === request.profile)!;
    if (!profile.available) throw new CompileError(profile.message, 503);
    directory = await projectTempDirectory('request');
    await Promise.all(Object.entries(request.files).map(async ([file, content]) => {
      await mkdir(path.dirname(path.join(directory!, file)), { recursive: true });
      await writeFile(path.join(directory!, file), content, { mode: 0o600 });
    }));
    if (request.profile === 'stm32-zephyr') {
      await writeFile(path.join(directory, 'CMakeLists.txt'), await readFile(path.join(ROOT, 'proofs/stm32/zephyr/CMakeLists.txt')), { mode: 0o400 });
    }
    const { elfPath, diagnostics } = await compileNative(directory, request.profile === 'stm32-zephyr');
    // Retain only the capped ELF, never an entire Zephyr build/cache tree.
    const artifactDirectory = await projectTempDirectory('artifact');
    const artifactPath = path.join(artifactDirectory, 'firmware.elf');
    try {
      await copyFile(elfPath, artifactPath);
      await rm(directory, { recursive: true, force: true });
      directory = artifactDirectory;
    } catch (error) {
      await rm(artifactDirectory, { recursive: true, force: true });
      throw error;
    }
    const buildId = randomBytes(24).toString('hex');
    builds.set(buildId, { profile: request.profile, elfPath: artifactPath, directory, diagnostics, expires: Date.now() + BUILD_TTL });
    directory = undefined;
    return { buildId, profile: request.profile, diagnostics };
  } catch (error) {
    if (error instanceof CompileError) throw error;
    if (error instanceof ProcessFailure) throw new CompileError(error.message, 422, error.diagnostics);
    throw new CompileError(error instanceof Error ? error.message : 'STM32 build failed.', 503);
  } finally {
    inFlight = false;
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

export async function getBuiltProject(buildId: string): Promise<Omit<BuiltProject, 'expires'>> {
  if (typeof buildId !== 'string' || !/^[a-f0-9]{48}$/.test(buildId)) throw new CompileError('Unknown or expired build.', 404);
  await removeExpired();
  const build = builds.get(buildId);
  if (!build) throw new CompileError('Unknown or expired build.', 404);
  // Runtime sessions must copy this ELF into their own session directory before use.
  return { profile: build.profile, elfPath: build.elfPath, hexPath: build.hexPath, directory: build.directory, diagnostics: build.diagnostics };
}
