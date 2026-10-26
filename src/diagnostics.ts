import type { Diagnostic } from '@codemirror/lint';
import { lintGutter, linter, setDiagnostics } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';


// GCC severity → CodeMirror severity
const SEVERITY: Record<string, Diagnostic['severity']> = {
  'error':       'error',
  'fatal error': 'error',
  'warning':     'warning',
  'note':        'hint',
};

/**
 * Parse multi-line GCC/avr-gcc diagnostic output into CodeMirror Diagnostic[].
 *
 * GCC diagnostic format:
 *   /absolute/path/filename:LINE:COL: error|warning|note: MESSAGE
 *   relative/filename:LINE:COL: error: MESSAGE
 *
 * @param buildOutput  Raw compiler stdout/stderr
 * @param filename     Basename to match against (e.g. "sketch.ino", "main.c")
 * @param source       Optional editor source text for precise character-offset resolution.
 *                     When omitted every diagnostic lands at offset 0.
 */
export function parseDiagnostics(
  buildOutput: string,
  filename: string,
  source?: string,
): Diagnostic[] {
  if (!buildOutput || !filename) return [];

  // Precompute line-start offsets from source so we can resolve line:col → char offset.
  const lineStarts: number[] = [];
  let sourceLen = 0;
  if (source != null) {
    lineStarts.push(0);
    for (let i = 0; i < source.length; i++) {
      if (source[i] === '\n') lineStarts.push(i + 1);
    }
    sourceLen = source.length;
  }

  // Escape filename for use inside a regex.
  const esc = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Matches:  [optional-path/]filename:LINE:COL: severity: message
  // "fatal error" must precede "error" in the alternation to avoid partial match.
  const re = new RegExp(
    `^(?:.*\\/)?${esc}:(\\d+):(\\d+):\\s*(fatal error|error|warning|note):\\s*(.+)$`,
    'gm',
  );

  const seen = new Set<string>();
  const results: Diagnostic[] = [];

  for (const m of buildOutput.matchAll(re)) {
    const lineNum  = parseInt(m[1], 10); // 1-indexed
    const colNum   = parseInt(m[2], 10); // 1-indexed
    const severity = (SEVERITY[m[3]] ?? 'info') as Diagnostic['severity'];
    const message  = m[4].trim();

    // Deduplicate: same file location + message
    const key = `${lineNum}:${colNum}:${message}`;
    if (seen.has(key)) continue;
    seen.add(key);

    let from = 0;
    let to   = 0;

    if (lineStarts.length > 0) {
      const li = lineNum - 1; // convert to 0-indexed
      if (li >= 0 && li < lineStarts.length) {
        const lineFrom = lineStarts[li];
        const lineTo   = li + 1 < lineStarts.length
          ? lineStarts[li + 1] - 1   // char before the '\n'
          : sourceLen;
        from = Math.min(lineFrom + Math.max(0, colNum - 1), lineTo);
        to   = lineTo > from ? lineTo : from + 1;
        to   = Math.min(to, sourceLen);
      }
    }

    results.push({ from, to, severity, message, source: 'gcc' });
  }

  return results;
}

/**
 * Dispatch parsed diagnostics into the editor immediately.
 *
 * CodeMirror's `forceLinting(view)` only re-runs a linter source when a run
 * is already pending from a document change (`lintPlugin`'s internal `set`
 * flag); calling it right after an external event such as a finished build,
 * with no intervening keystroke, is a no-op. Dispatching `setDiagnostics`
 * directly updates the gutter/markers without waiting for that scheduling.
 *
 * @param view      The CodeMirror view to update.
 * @param output    Raw GCC output for the just-finished build (empty string clears markers).
 * @param filename  Basename to match against (e.g. "sketch.ino", "main.c").
 */
export function applyDiagnostics(view: EditorView, output: string, filename: string): void {
  const diagnostics = parseDiagnostics(output, filename, view.state.doc.toString());
  view.dispatch(setDiagnostics(view.state, diagnostics));
}

/**
 * Build CodeMirror lint extensions (gutter + synchronous linter).
 *
 * The linter does NOT re-invoke the compiler; it re-parses the last build
 * output on every idle tick, resolving character positions against the
 * current document text.
 *
 * Usage in App.tsx:
 *
 *   const buildOutputRef = useRef('');
 *   const lintExts = useMemo(
 *     () => buildLintExtensions(() => buildOutputRef.current, () => activeFile),
 *     [],
 *   );
 *
 *   // After build success/error:
 *   buildOutputRef.current = result.diagnostics;
 *   if (editorView.current) forceLinting(editorView.current);
 *
 *   // When starting a new build (clear stale markers):
 *   buildOutputRef.current = '';
 *   if (editorView.current) forceLinting(editorView.current);
 *
 * @param getOutput    Getter for the raw GCC output string
 * @param getFilename  Getter for the filename to match (e.g. "sketch.ino")
 */
export function buildLintExtensions(
  getOutput: () => string,
  getFilename: () => string,
): Extension[] {
  return [
    lintGutter(),
    linter(
      view => parseDiagnostics(getOutput(), getFilename(), view.state.doc.toString()),
      { delay: 0 },
    ),
  ];
}
