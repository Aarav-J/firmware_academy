import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, realpath, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(root, '.pico');
const sdk = path.join(cache, 'sdk');
const build = path.join(cache, 'build');
const sdkCommit = 'bddd20f928ce76142793bef434d4f75f4af6e433'; // Pico SDK 2.1.1
function run(command: string, args: string[], cwd = root, capture = false): string {
  const result = spawnSync(command, args, {
    cwd, env: { ...process.env, PICO_SDK_PATH: sdk },
    encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message ?? result.stderr ?? result.status}`);
  return result.stdout ?? '';
}
async function exists(location: string) { try { await access(location); return true; } catch { return false; } }
function splitCommand(command: string): string[] {
  const result: string[] = [];
  const tokens = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  for (const token of tokens) result.push(token.replace(/"([^"]*)"|'([^']*)'/g, (_match, double, single) => double ?? single));
  return result;
}
await mkdir(cache, { recursive: true });
if (!await exists(path.join(sdk, '.git'))) {
  run('git', ['init', sdk]);
  run('git', ['-C', sdk, 'remote', 'add', 'origin', 'https://github.com/raspberrypi/pico-sdk.git']);
}
run('git', ['-C', sdk, 'fetch', '--depth', '1', 'origin', sdkCommit]);
run('git', ['-C', sdk, 'checkout', '--detach', sdkCommit]);
run('git', ['-C', sdk, 'submodule', 'update', '--init', '--depth', '1', 'lib/tinyusb']);
run('cmake', ['-S', path.join(root, 'firmware'), '-B', build, '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_EXPORT_COMPILE_COMMANDS=ON']);
run('cmake', ['--build', build, '--parallel', '4']);
const entries = JSON.parse(await readFile(path.join(build, 'compile_commands.json'), 'utf8')) as { file: string; command: string; directory: string }[];
const entry = entries.find(item => item.file === path.join(root, 'firmware/main.c'));
if (!entry) throw new Error('Fixed firmware compilation command was not generated');
const compile = splitCommand(entry.command);
const commands = run('ninja', ['-C', build, '-t', 'commands', 'workbench.elf'], root, true).split('\n');
const linkerCommand = commands.find(line => line.includes(' -o workbench.elf '));
if (!linkerCommand) throw new Error('Fixed firmware link command was not generated');
const linkerTokens = splitCommand(linkerCommand);
const linkerStart = linkerTokens.findIndex(token => /arm-none-eabi-g\+\+$/.test(token));
const linkerEnd = linkerTokens.indexOf('&&', linkerStart);
const link = linkerTokens.slice(linkerStart, linkerEnd < 0 ? undefined : linkerEnd);
if (linkerStart < 0) throw new Error('Expected a GCC C++ linker command');
const compiler = await realpath(compile[0]);
const linker = await realpath(link[0]);
const objcopy = run('arm-none-eabi-gcc', ['-print-prog-name=objcopy'], root, true).trim();
const compilerDirectory = path.dirname(compiler);
const resolvedObjcopy = await realpath(path.isAbsolute(objcopy) ? objcopy : path.join(compilerDirectory, objcopy));
const manifest = {
  version: 1, sdkCommit, root, build, sdk,
  compiler, linker, objcopy: resolvedObjcopy,
  toolchainRoot: path.resolve(compilerDirectory, '..'),
  compile: compile.slice(1), link: link.slice(1),
  source: entry.file, object: 'CMakeFiles/workbench.dir/main.c.o',
};
await writeFile(path.join(cache, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`Pico SDK framework ready at ${build}. Learner builds compile only main.c and relink the prebuilt SDK.`);
console.log('Native macOS development: FIRMWARE_COMPILER_MODE=native npm run dev');
console.log('Isolated Docker backend: docker build -t firmware-academy-compiler .');
