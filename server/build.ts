import { readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { runProcess } from './process.js';

export const MAX_ARTIFACT_BYTES = 4 * 1024 * 1024;
export type BuildManifest = {
  version: number; sdkCommit: string; root: string; build: string; sdk: string;
  compiler: string; linker: string; objcopy: string; toolchainRoot: string;
  compile: string[]; link: string[]; source: string; object: string;
};

export function sandboxProfile(manifest: BuildManifest, directory: string): string {
  const quote = (value: string) => JSON.stringify(value);
  return `(version 1)
(deny default)
(import "dyld-support.sb")
(allow process-fork)
(allow process-exec (subpath ${quote(manifest.toolchainRoot)}) (literal "/usr/bin/true") (literal "/bin/sh") (literal "/bin/bash"))
(allow signal (target self))
(allow sysctl-read)
(allow file-read-metadata)
(allow file-read* (subpath "/System/Library") (subpath "/usr/lib") (subpath "/private/var/db/dyld")
  (subpath ${quote(manifest.toolchainRoot)}) (subpath ${quote(manifest.sdk)})
  (subpath ${quote(manifest.build)}) (subpath ${quote(directory)})
  (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random"))
(allow file-read* (literal "/bin/sh") (literal "/bin/bash"))
(allow file-write* (subpath ${quote(directory)}) (literal "/dev/null"))
`;
}

export function binaryToUf2(binary: Buffer): Buffer {
  if (binary.length === 0 || binary.length > 2 * 1024 * 1024) throw new Error('Firmware must fit in the Pico 2 MB flash');
  const blocks = Math.ceil(binary.length / 256);
  const uf2 = Buffer.alloc(blocks * 512);
  for (let block = 0; block < blocks; block++) {
    const offset = block * 512;
    uf2.writeUInt32LE(0x0a324655, offset);
    uf2.writeUInt32LE(0x9e5d5157, offset + 4);
    uf2.writeUInt32LE(0x2000, offset + 8);
    uf2.writeUInt32LE(0x10000000 + block * 256, offset + 12);
    uf2.writeUInt32LE(256, offset + 16);
    uf2.writeUInt32LE(block, offset + 20);
    uf2.writeUInt32LE(blocks, offset + 24);
    uf2.writeUInt32LE(0xe48bff56, offset + 28);
    binary.copy(uf2, offset + 32, block * 256, Math.min(binary.length, (block + 1) * 256));
    uf2.writeUInt32LE(0x0ab16f30, offset + 508);
  }
  return uf2;
}

export async function buildFirmware(manifest: BuildManifest, directory: string, sandbox: boolean): Promise<string> {
  const source = path.join(directory, 'main.c');
  const object = path.join(directory, 'main.o');
  const elf = path.join(directory, 'firmware.elf');
  const binary = path.join(directory, 'firmware.bin');
  const profile = path.join(directory, 'compile.sb');
  if (sandbox) await writeFile(profile, sandboxProfile(manifest, directory), { mode: 0o600 });
  const env: NodeJS.ProcessEnv = {
    PATH: `${path.dirname(manifest.compiler)}:/usr/bin:/bin`,
    TMPDIR: directory, TMP: directory, TEMP: directory, HOME: directory, LANG: 'C', LC_ALL: 'C',
    SOURCE_DATE_EPOCH: '1735689600',
  };
  let diagnostics = '';
  const commands: [string, string[]][] = [
    [manifest.compiler, ['-fdiagnostics-color=never', '-fmax-errors=12', ...manifest.compile.map(argument => {
      if (argument === manifest.source) return source;
      if (argument === manifest.object) return object;
      return argument;
    })]],
    [manifest.linker, manifest.link.map(argument => {
      if (argument === manifest.object) return object;
      if (argument === 'workbench.elf') return elf;
      if (argument === '-Wl,-Map=workbench.elf.map') return `-Wl,-Map=${path.join(directory, 'firmware.map')}`;
      if (!argument.startsWith('-') && !path.isAbsolute(argument) && /\.(o|a)$/.test(argument)) return path.join(manifest.build, argument);
      return argument;
    })],
    [manifest.objcopy, ['-O', 'binary', elf, binary]],
  ];
  for (const [command, args] of commands) {
    diagnostics += await runProcess(sandbox ? '/usr/bin/sandbox-exec' : command,
      sandbox ? ['-f', profile, '/bin/sh', '-c', 'set -e; ulimit -f 8192; ulimit -t 8; exec "$@"', 'firmware-compiler', command, ...args] : args,
      { cwd: directory, env, timeoutMs: 8_000, outputLimit: 48 * 1024 });
  }
  const [elfInfo, binInfo] = await Promise.all([stat(elf), stat(binary)]);
  if (elfInfo.size > MAX_ARTIFACT_BYTES || binInfo.size > 2 * 1024 * 1024) throw new Error('Compiled firmware exceeds the artifact limit');
  const image = await readFile(binary);
  await writeFile(path.join(directory, 'firmware.uf2'), binaryToUf2(image));
  return diagnostics;
}
