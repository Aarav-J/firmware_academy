import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CompileError } from '../compiler.js';
import { ProcessFailure, runProcess } from '../process.js';

const ARDUINO_CLI = '/opt/homebrew/bin/arduino-cli';
const FQBN = 'arduino:avr:uno';
const ARDUINO_DATA_DIR = path.join(os.homedir(), 'Library/Arduino15');
export const MAX_ARDUINO_OUTPUT = 192 * 1024;
const WALL_TIME_MS = 60_000;

export const ARDUINO_DEFAULT_SKETCH = `// Arduino Uno — blink the onboard LED (pin 13) and echo to Serial
void setup() {
  pinMode(13, OUTPUT);
  Serial.begin(9600);
  Serial.println("Arduino ready!");
}

void loop() {
  digitalWrite(13, HIGH);
  Serial.println("LED on");
  delay(1000);
  digitalWrite(13, LOW);
  Serial.println("LED off");
  delay(1000);
}
`;

/** Verify arduino-cli exists and the arduino:avr core is installed. */
export async function probeArduino(): Promise<void> {
  await access(ARDUINO_CLI, constants.X_OK);
  // Core presence confirmed by the hardware directory; no extra network call needed.
  await access(path.join(ARDUINO_DATA_DIR, 'packages/arduino/hardware/avr'), constants.R_OK);
}

/**
 * Reject any #include "..." directive that escapes the sketch directory via path
 * traversal or an absolute path — e.g. #include "../../etc/passwd".
 * System headers (<stdio.h>) are angle-bracket includes and are always allowed.
 */
function rejectPathTraversal(source: string): void {
  const lines = source.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    // Strip line comments; leave block comments (rare in directives, safe to skip)
    const stripped = lines[i].replace(/\/\/.*$/, '');
    const m = stripped.match(/^\s*#\s*include\s+"([^"]+)"/);
    if (!m) continue;
    const p = m[1];
    if (p.startsWith('/') || p.includes('..') || p.includes('\0')) {
      const diag =
        `sketch.ino:${i + 1}:1: error: #include "${p}" — ` +
        `relative includes must not use ".." or absolute paths; only same-directory ` +
        `user headers and system headers (<...>) are permitted.`;
      throw new CompileError(
        'Sketch #include references a path outside the sketch directory.',
        422,
        diag,
      );
    }
  }
}

/**
 * Convert the arduino-cli --json output (success or failure) into a plain
 * GCC-style diagnostic string with sketch-relative file paths.
 *
 * Falls back to raw compiler_err with the absolute sketchDir prefix stripped
 * when structured diagnostics are absent (e.g. output truncated by limit).
 */
function formatDiagnostics(raw: string, sketchDir: string): string {
  const pathPrefix = new RegExp(
    sketchDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + /\/?/.source,
    'g',
  );

  let parsed: {
    compiler_err?: string;
    compiler_out?: string;
    builder_result?: {
      diagnostics?: Array<{
        severity: string;
        message: string;
        file?: string;
        line?: number;
        column?: number;
        context?: Array<{ message: string; file?: string }>;
      }>;
    };
  };

  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    return raw.replace(pathPrefix, '');
  }

  const structured = parsed.builder_result?.diagnostics;
  if (structured && structured.length > 0) {
    return structured
      .map(d => {
        const relFile = d.file
          ? (d.file.startsWith(sketchDir)
              ? d.file.slice(sketchDir.length + (sketchDir.endsWith('/') ? 0 : 1))
              : path.basename(d.file))
          : 'sketch.ino';
        const loc =
          d.line != null
            ? d.column != null
              ? `${relFile}:${d.line}:${d.column}`
              : `${relFile}:${d.line}`
            : relFile;
        const severity = d.severity.toLowerCase();
        // Take only the first line of the message (the caret context is decorative here)
        const firstLine = d.message.replace(/^\n/, '').split('\n')[0].trim();
        return `${loc}: ${severity}: ${firstLine}`;
      })
      .join('\n');
  }

  // Fallback: compiler_err with absolute paths stripped
  const fallback = (parsed.compiler_err ?? parsed.compiler_out ?? '').replace(pathPrefix, '');
  return fallback;
}

/**
 * Compile a single sketch.ino source string for arduino:avr:uno.
 *
 * `requestDir` is a pre-created private temp directory owned by the caller;
 * this function creates `requestDir/sketch/` and `requestDir/build/` inside it.
 * On success the caller owns both; on failure it should remove requestDir.
 *
 * Returns elfPath, hexPath (Intel HEX), and any compiler diagnostics.
 */
export async function compileArduino(
  requestDir: string,
  source: string,
): Promise<{ elfPath: string; hexPath: string; diagnostics: string }> {
  rejectPathTraversal(source);

  const sketchDir = path.join(requestDir, 'sketch');
  const buildDir = path.join(requestDir, 'build');

  await mkdir(sketchDir, { mode: 0o700 });
  await mkdir(buildDir, { mode: 0o700 });
  // arduino-cli requires sketch dir name == sketch file name (minus extension).
  await writeFile(path.join(sketchDir, 'sketch.ino'), source, { mode: 0o600 });

  let rawOutput: string;
  try {
    rawOutput = await runProcess(
      ARDUINO_CLI,
      [
        'compile',
        '--fqbn', FQBN,
        '--build-path', buildDir,
        '--json',
        '--no-color',
        '--warnings', 'default',
        sketchDir,
      ],
      {
        timeoutMs: WALL_TIME_MS,
        outputLimit: MAX_ARDUINO_OUTPUT,
        env: {
          ...process.env,
          HOME: os.homedir(),
          // Confine arduino-cli's own temp usage to the request dir
          TMPDIR: requestDir,
          TMP: requestDir,
          TEMP: requestDir,
        },
      },
    );
  } catch (error) {
    if (error instanceof ProcessFailure) {
      const diag = formatDiagnostics(error.diagnostics, sketchDir);
      throw new CompileError(
        'Arduino sketch compilation failed.',
        422,
        diag || error.diagnostics,
      );
    }
    throw error;
  }

  const diagnostics = formatDiagnostics(rawOutput, sketchDir);
  const elfPath = path.join(buildDir, 'sketch.ino.elf');
  const hexPath = path.join(buildDir, 'sketch.ino.hex');

  // Sanity-check the ELF: magic 7f454c46, 32-bit, machine 0x53 (AVR)
  const elfData = await readFile(elfPath);
  if (elfData.subarray(0, 4).toString('hex') !== '7f454c46') {
    throw new CompileError('Arduino compiler did not produce a valid ELF.', 503);
  }
  await access(hexPath, constants.R_OK);

  return { elfPath, hexPath, diagnostics };
}
