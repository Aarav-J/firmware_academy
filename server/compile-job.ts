import { readFile } from 'node:fs/promises';
import { buildFirmware, type BuildManifest } from './build.js';
import { ProcessFailure } from './process.js';

try {
  const manifest = JSON.parse(await readFile('/opt/workbench/.pico/manifest.json', 'utf8')) as BuildManifest;
  const diagnostics = await buildFirmware(manifest, '/job', false);
  if (diagnostics) process.stdout.write(diagnostics);
} catch (error) {
  if (error instanceof ProcessFailure && error.diagnostics) process.stderr.write(error.diagnostics);
  process.stderr.write(`${error instanceof Error ? error.message : 'Compilation failed'}\n`);
  process.exitCode = 1;
}
