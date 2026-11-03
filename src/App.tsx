import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { cpp } from '@codemirror/lang-cpp';
import { oneDark } from '@codemirror/theme-one-dark';
import type { EditorView } from '@codemirror/view';
import { ArrowCounterClockwise, ArrowSquareOut, CaretDown, CaretUp, CheckCircle, Circuitry, Code, Cpu, DownloadSimple, FileCode, Pause, Play, TerminalWindow, WarningCircle } from '@phosphor-icons/react';
import type { CompileResult, CompilerHealth, SimulatorCommand, SimulatorMessage, TraceEvent } from './contracts';
import type { ProjectBuildResult, ProjectId, ProjectProfile, RegisterSnapshot, RenodeCommand, RenodeFrame, RenodeSessionInfo } from './workbench-contracts';
import { ARDUINO_EXAMPLES, DEFAULT_SOURCE, examples } from './examples';
import { pinLabelFor } from './board-pinouts';
import { appendSerial, decodeBase64, retainPinTrace } from './trace';
import { apiRequest, BrowserRenodeSession } from './renode-client';
import { applyDiagnostics, buildLintExtensions } from './diagnostics';
import { HardwarePanel } from './components/HardwarePanel';
import { PicoBoard } from './components/PicoBoard';
import { LogicAnalyzer } from './components/LogicAnalyzer';
import { RegisterInspector } from './components/RegisterInspector';
import { SavedProjectsPanel } from './components/SavedProjectsPanel';
import { Breadboard } from './components/Breadboard';
import type { LearningWorkspace } from './learning/types';
import { ExerciseHardware } from './learning/ExerciseHardware';
import './workbench.css';
import './learning/output-drawer.css';

const codeExtensions = [cpp()];
const EMPTY_PINS = Array<number>(80).fill(0);
const PICO: ProjectProfile = {
  id: 'pico', name: 'Pico SDK', board: 'Raspberry Pi Pico', framework: 'Pico SDK · C',
  description: 'RP2040 firmware runs in a browser worker.', available: false, message: 'Connecting to compiler…',
  files: [{ path: 'main.c', content: DEFAULT_SOURCE, editable: true }],
};
const REGISTER_PROFILES = new Set<ProjectId>(['stm32-baremetal', 'stm32-zephyr']);

type ProjectFiles = Partial<Record<ProjectId, Record<string, string>>>;
function savedProjects(): ProjectFiles {
  try {
    const parsed = JSON.parse(localStorage.getItem('firmware-academy:projects') || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const pico = localStorage.getItem('firmware-academy:main.c');
    if (!parsed.pico && pico) parsed.pico = { 'main.c': pico };
    return parsed;
  } catch { return {}; }
}

export default function App({ learning, darkMode, paneDivider }: { learning?: LearningWorkspace; darkMode?: boolean; paneDivider?: ReactNode } = {}) {
  const [profiles, setProfiles] = useState<ProjectProfile[]>(() => learning ? [PICO, {
    id: 'arduino-uno', name: 'Arduino · Uno', board: 'Arduino Uno · ATmega328P', framework: 'Arduino',
    description: 'Arduino lesson environment.', available: false, message: 'Connecting to the Arduino compiler…',
    files: [{ path: 'sketch.ino', content: learning.source, editable: true }],
  }] : [PICO]);
  const [profileId, setProfileId] = useState<ProjectId>(learning ? 'arduino-uno' : 'stm32-baremetal');
  const [projects, setProjects] = useState<ProjectFiles>(() => learning ? { 'arduino-uno': { 'sketch.ino': learning.source } } : savedProjects());
  const [activeFile, setActiveFile] = useState(learning ? 'sketch.ino' : 'main.c');
  const [profileError, setProfileError] = useState('');
  const [health, setHealth] = useState<CompilerHealth | null>(null);
  const [building, setBuilding] = useState(false);
  const [artifact, setArtifact] = useState<Uint8Array | null>(null);
  const [hexArtifact, setHexArtifact] = useState<Uint8Array | null>(null);
  const [buildId, setBuildId] = useState<string | null>(null);
  const [builtKey, setBuiltKey] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState('Build diagnostics appear here. Select a project, edit its source, then build and run.');
  const [buildState, setBuildState] = useState<'idle' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');
  const [simLoaded, setSimLoaded] = useState(false);
  const [simLoading, setSimLoading] = useState(false);
  const [simState, setSimState] = useState('empty');
  const [timeUs, setTimeUs] = useState(0);
  const [pins, setPins] = useState(EMPTY_PINS);
  const [trace, setTrace] = useState<TraceEvent[]>([]);
  const [serial, setSerial] = useState('');
  const [eeprom, setEeprom] = useState<number | undefined>(undefined);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [mode, setMode] = useState<'simulation' | 'registers' | 'hardware'>('simulation');
  const [consoleTab, setConsoleTab] = useState<'serial' | 'build' | 'runtime'>('serial');
  const [outputOpen, setOutputOpen] = useState(false);
  const [outputHeight, setOutputHeight] = useState(160);
  const [outputMaxHeight, setOutputMaxHeight] = useState(240);
  const [snapshot, setSnapshot] = useState<RegisterSnapshot | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [inspectionError, setInspectionError] = useState('');
  const [controlBusy, setControlBusy] = useState(false);
  const [dark, setDark] = useState(() => darkMode ?? matchMedia('(prefers-color-scheme: dark)').matches);
  const worker = useRef<Worker | null>(null);
  const session = useRef<BrowserRenodeSession | null>(null);
  const runAfterLoad = useRef(false);
  const generation = useRef(0);
  const serialElement = useRef<HTMLPreElement>(null);
  const lastFrameTime = useRef(0);
  const learningStartupTrace = useRef<TraceEvent[]>([]);
  const inspectionEpoch = useRef(0);
  const inspectionPending = useRef(false);
  const compileAbort = useRef<AbortController | null>(null);
  const buildOutputRef = useRef('');
  const editorViewRef = useRef<EditorView | null>(null);
  const editorPane = useRef<HTMLElement>(null);
  const outputDrag = useRef<{ pointerId: number; y: number; height: number } | null>(null);
  const controlsEpoch = useRef(0);
  const profile = profiles.find(item => item.id === profileId);
  const isPico = profileId === 'pico';
  const isArduino = profileId === 'arduino-uno';
  const isClientWorker = isPico || isArduino;
  const hasRegisters = REGISTER_PROFILES.has(profileId);
  const uartPort = profileId === 'stm32-baremetal' || profileId === 'stm32-zephyr' ? 2 : 0;
  const exampleSet = isPico ? examples : isArduino ? ARDUINO_EXAMPLES : null;
  const file = profile?.files.find(item => item.path === activeFile) ?? profile?.files[0];
  const currentFiles = Object.fromEntries((profile?.files ?? []).filter(item => item.editable).map(item => [item.path, typeof projects[profileId]?.[item.path] === 'string' ? projects[profileId]![item.path] : item.content]));
  const projectKey = JSON.stringify({ profile: profileId, files: currentFiles });
  const stale = builtKey !== null && projectKey !== builtKey;
  const editorContent = file ? currentFiles[file.path] ?? file.content : '';
  const available = isPico ? !!health?.ready : !!profile?.available;
  const controlsEnabled = simLoaded && !simLoading && !building && !controlBusy && !inspecting;
  const lintExtensions = useMemo(() => buildLintExtensions(() => buildOutputRef.current, () => file?.path ?? ''), [file?.path]);
  const onControls = learning?.onControls;
  const running = simState === 'running';
  const embedded = !!learning;
  const outputMinHeight = Math.min(80, outputMaxHeight);
  const visibleOutputHeight = Math.max(outputMinHeight, Math.min(outputHeight, outputMaxHeight));

  useEffect(() => () => {
    ++controlsEpoch.current;
    onControls?.(null);
  }, [onControls]);

  useEffect(() => {
    if (!onControls) return;
    const epoch = ++controlsEpoch.current;
    onControls({
      available, building, loading: simLoading, running, canControl: controlsEnabled, buildFailed: buildState === 'error',
      run: () => { if (epoch === controlsEpoch.current && available && !building && !simLoading) void buildAndRun(); },
      reset: () => { if (epoch === controlsEpoch.current && controlsEnabled) void control({ type: 'reset' }); },
      togglePause: () => { if (epoch === controlsEpoch.current && controlsEnabled) void control({ type: running ? 'pause' : 'run' }); },
    });
  }, [available, building, simLoading, running, controlsEnabled, buildState, projectKey, file?.path, onControls]);

  useEffect(() => {
    const pane = editorPane.current;
    if (!embedded || !pane) return;
    const toolbar = pane.querySelector<HTMLElement>('.editor-toolbar');
    const status = pane.querySelector<HTMLElement>('.editor-status');
    const measure = () => {
      const paneHeight = pane.getBoundingClientRect().height;
      const chromeHeight = (toolbar?.getBoundingClientRect().height ?? 0) + (status?.getBoundingClientRect().height ?? 0);
      const codeReserve = Math.min(180, Math.max(96, paneHeight * 0.38));
      setOutputMaxHeight(Math.max(0, Math.min(420, Math.floor(paneHeight - chromeHeight - codeReserve - 40))));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(pane);
    if (toolbar) observer.observe(toolbar);
    if (status) observer.observe(status);
    measure();
    return () => observer.disconnect();
  }, [embedded]);

  function selectOutput(tab: 'serial' | 'build' | 'runtime') {
    setConsoleTab(tab);
    setOutputOpen(open => tab === consoleTab ? !open : true);
  }

  function navigateOutputTabs(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const current = tabs.findIndex(tab => tab === document.activeElement);
    if (current < 0) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    const tab = tabs[next];
    tab.focus();
    setConsoleTab(tab.id === 'serial-tab' ? 'serial' : tab.id === 'build-tab' ? 'build' : 'runtime');
    setOutputOpen(true);
  }

  function resizeOutput(event: PointerEvent<HTMLDivElement>) {
    const drag = outputDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setOutputHeight(Math.max(outputMinHeight, Math.min(outputMaxHeight, drag.height + drag.y - event.clientY)));
  }

  function resizeOutputWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 48 : 16;
    setOutputHeight(event.key === 'Home' ? outputMinHeight : event.key === 'End' ? outputMaxHeight : Math.max(outputMinHeight, Math.min(outputMaxHeight, visibleOutputHeight + (event.key === 'ArrowUp' ? step : -step))));
  }

  useEffect(() => {
    const controller = new AbortController();
    async function refresh() {
      const results = await Promise.allSettled([
        apiRequest<ProjectProfile[]>('/api/projects', { signal: controller.signal }),
        apiRequest<CompilerHealth>('/api/health', { signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      if (results[0].status === 'fulfilled') {
        setProfiles([PICO, ...results[0].value.filter(item => item.id !== 'pico')]);
        setProfileError('');
      } else setProfileError(results[0].reason instanceof Error ? results[0].reason.message : 'Project service unavailable.');
      if (results[1].status === 'fulfilled') setHealth(results[1].value);
      else setHealth(null);
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 15_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (learning) return;
    const save = () => { try { localStorage.setItem('firmware-academy:projects', JSON.stringify(projects)); } catch { /* Editing remains possible if browser storage is full. */ } };
    const timer = setTimeout(save, 300);
    return () => { clearTimeout(timer); save(); };
  }, [projects, learning]);
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; }, [dark]);
  useEffect(() => { if (darkMode !== undefined) setDark(darkMode); }, [darkMode]);
  useEffect(() => {
    learning?.onObservation({ built: buildState === 'success' && !stale && !building, state: simState, timeUs, pins, trace, startupTrace: learningStartupTrace.current, circuit: learning.circuit, analogVoltage: learning.analogVoltage, serial, lastSerialCommand: learning.lastSerialCommand, eeprom });
  }, [learning?.onObservation, learning?.circuit, learning?.analogVoltage, learning?.lastSerialCommand, buildState, stale, building, simState, timeUs, pins, trace, serial, eeprom]);
  useEffect(() => { serialElement.current?.scrollTo({ top: serialElement.current.scrollHeight }); }, [serial]);

  useEffect(() => {
    const current = ++generation.current;
    if (profileId === 'pico' || profileId === 'arduino-uno') {
      // Vite statically bundles each `new URL('./literal.ts', import.meta.url)` worker entry;
      // the two constructors must stay as separate literal expressions, not a computed path.
      const instance = profileId === 'pico'
        ? new Worker(new URL('./simulator.worker.ts', import.meta.url), { type: 'module' })
        : new Worker(new URL('./simulator/avr-worker.ts', import.meta.url), { type: 'module' });
      worker.current = instance;
      instance.onmessage = ({ data }: MessageEvent<SimulatorMessage>) => {
        if (current !== generation.current) return;
        if (data.type === 'error') {
          setError(data.message); setSimState('error'); setSimLoading(false); runAfterLoad.current = false;
        } else if (data.type === 'state') {
          setSimState(data.state); setTimeUs(data.timeUs);
          if (data.state === 'ready') {
            setSimLoaded(true); setSimLoading(false);
            if (runAfterLoad.current) { runAfterLoad.current = false; instance.postMessage({ type: 'run' } satisfies SimulatorCommand); }
          }
        } else acceptEvents(data.timeUs, data.pins, data.events, 0, data.eeprom);
      };
      instance.onerror = event => { if (current === generation.current) { setError(`Simulator worker failed: ${event.message}`); setSimState('error'); setSimLoaded(false); setSimLoading(false); } };
    }
    const onLeave = () => {
      if (!session.current) return;
      session.current.dispose(true); session.current = null;
      ++inspectionEpoch.current; inspectionPending.current = false; setInspecting(false);
      setSimLoaded(false); setSimLoading(false); setSimState('closed'); setSnapshot(null);
    };
    const onReturn = (event: PageTransitionEvent) => {
      if (!event.persisted || isClientWorker) return;
      setSimLoaded(false); setSimLoading(false); setSimState('closed'); setControlBusy(false);
      setError('This page was restored after its hardware session closed. Build again to start a new Renode session.');
    };
    window.addEventListener('pagehide', onLeave);
    window.addEventListener('pageshow', onReturn);
    return () => {
      ++generation.current;
      compileAbort.current?.abort();
      worker.current?.terminate(); worker.current = null;
      session.current?.dispose(); session.current = null;
      window.removeEventListener('pagehide', onLeave);
      window.removeEventListener('pageshow', onReturn);
    };
  }, [profileId]);

  function acceptEvents(at: number, levels: number[], events: TraceEvent[], expectedPort: number, eepromValue?: number) {
    if (at < lastFrameTime.current) { setTrace([]); setSerial(''); setSnapshot(null); learningStartupTrace.current = []; }
    lastFrameTime.current = at;
    setTimeUs(at); setPins(levels);
    // EEPROM intentionally survives the reset-clearing above — it is backed by a store the worker
    // reuses across resets, exactly like real EEPROM surviving a chip reset.
    if (eepromValue !== undefined) setEeprom(eepromValue);
    if (events.length) {
      if (learning) {
        for (const event of events) {
          if (learningStartupTrace.current.length >= 16) break;
          if (event.type === 'pin' && event.pin === (learning.hardware?.outputPin ?? 13)) learningStartupTrace.current.push(event);
        }
      }
      setTrace(previous => retainPinTrace(previous, events, at));
      const output = events.filter((event): event is Extract<TraceEvent, { type: 'uart_tx' }> => event.type === 'uart_tx' && event.port === expectedPort).map(event => event.text).join('');
      if (output) setSerial(previous => appendSerial(previous, output));
    }
  }

  function acceptRenodeFrame(frame: RenodeFrame) {
    setSimState(frame.state);
    setSimLoading(false);
    setSimLoaded(frame.state !== 'error' && frame.state !== 'closed');
    acceptEvents(frame.timeUs, frame.pins, frame.events, uartPort);
    setWarnings(frame.warnings);
    if (frame.error) setError(frame.error);
  }

  function clearExecution() {
    lastFrameTime.current = 0;
    learningStartupTrace.current = [];
    ++inspectionEpoch.current; inspectionPending.current = false; setInspecting(false);
    setTimeUs(0); setPins(EMPTY_PINS); setTrace([]); setSerial('');
    setSnapshot(null); setInspectionError(''); setWarnings([]);
  }

  function applyLint(output: string) {
    buildOutputRef.current = output;
    if (editorViewRef.current && file) applyDiagnostics(editorViewRef.current, output, file.path);
  }

  function changeProfile(id: ProjectId) {
    if (id === profileId) return;
    compileAbort.current?.abort();
    session.current?.dispose(); session.current = null;
    worker.current?.terminate(); worker.current = null;
    ++generation.current;
    setProfileId(id);
    setActiveFile(id === 'stm32-zephyr' ? 'src/main.c' : id === 'arduino-uno' ? 'sketch.ino' : 'main.c');
    setArtifact(null); setHexArtifact(null); setBuildId(null); setBuiltKey(null); setBuildState('idle');
    setSimLoaded(false); setSimLoading(false); setSimState('empty'); setBuilding(false);
    setError(''); setControlBusy(false); setInspecting(false); setMode('simulation'); clearExecution(); applyLint('');
  }

  function updateFile(value: string) {
    if (!file?.editable) return;
    setProjects(previous => ({ ...previous, [profileId]: { ...previous[profileId], [file.path]: value } }));
    learning?.onSourceChange(value);
  }

  function loadSavedFiles(files: Record<string, string>) {
    setProjects(previous => ({ ...previous, [profileId]: files }));
  }

  async function buildAndRun() {
    if (building || !profile) return;
    const current = generation.current;
    const selected = profileId;
    const key = projectKey;
    const files = currentFiles;
    const controller = new AbortController();
    compileAbort.current = controller;
    const timeout = setTimeout(() => controller.abort(), 180_000);
    let startingRuntime: BrowserRenodeSession | null = null;
    setBuilding(true); setError(''); setBuildState('idle'); if (!learning) setConsoleTab('build'); applyLint('');
    setDiagnostics(`Building ${profile.name} from your project files…`);
    try {
      if (selected === 'pico') {
        const result = await apiRequest<CompileResult>('/api/compile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: files['main.c'] }), signal: controller.signal });
        if (current !== generation.current) return;
        applyLint(result.diagnostics);
        const uf2 = decodeBase64(result.uf2);
        clearExecution(); setArtifact(uf2); setBuiltKey(key); setBuildState('success');
        setDiagnostics(`${result.diagnostics || 'Build succeeded.'}\n\nELF and UF2 generated. UF2: ${uf2.byteLength.toLocaleString()} bytes.\nSimulation and hardware download use the exact same UF2.`);
        setSimLoaded(false); setSimLoading(true); runAfterLoad.current = true;
        const buffer = uf2.slice().buffer;
        worker.current?.postMessage({ type: 'load', uf2: buffer } satisfies SimulatorCommand, [buffer]);
      } else if (selected === 'arduino-uno') {
        const result = await apiRequest<ProjectBuildResult>('/api/projects/build', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: selected, files }), signal: controller.signal });
        if (current !== generation.current) return;
        applyLint(result.diagnostics);
        if (!result.hex) throw new Error('The Arduino build did not return an Intel HEX image.');
        const hex = decodeBase64(result.hex);
        clearExecution(); setHexArtifact(hex); setBuildId(result.buildId); setBuiltKey(key); setBuildState('success');
        setDiagnostics(`${result.diagnostics || 'Build succeeded.'}\n\nELF and Intel HEX generated from your sketch.\nSimulation and hardware flashing use the exact same HEX image.`);
        setSimLoaded(false); setSimLoading(true); runAfterLoad.current = true;
        const buffer = hex.slice().buffer;
        worker.current?.postMessage({ type: 'load', uf2: buffer } satisfies SimulatorCommand, [buffer]);
      } else {
        const result = await apiRequest<ProjectBuildResult>('/api/projects/build', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: selected, files }), signal: controller.signal });
        if (current !== generation.current) return;
        applyLint(result.diagnostics);
        session.current?.dispose(); session.current = null;
        clearExecution(); setSimLoaded(false); setSimLoading(true); setSimState('loading');
        setBuildId(result.buildId); setBuiltKey(key); setBuildState('success');
        setDiagnostics(`${result.diagnostics || 'Build succeeded.'}\n\nReal ARM ELF generated from your edited files. Starting a dedicated Renode session…`);
        const info = await apiRequest<RenodeSessionInfo>('/api/renode/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ buildId: result.buildId }), signal: controller.signal });
        if (current !== generation.current || controller.signal.aborted) { new BrowserRenodeSession(info).dispose(); return; }
        const runtime = new BrowserRenodeSession(info);
        startingRuntime = runtime;
        session.current = runtime;
        runtime.subscribe(frame => { if (current === generation.current && session.current === runtime) acceptRenodeFrame(frame); }, message => { if (current === generation.current && session.current === runtime) { runtime.dispose(); session.current = null; setError(message); setSimState('error'); setSimLoaded(false); setSimLoading(false); } });
        await runtime.command({ type: 'run' });
      }
      if (current === generation.current) { setMode('simulation'); if (!learning) setConsoleTab('serial'); }
    } catch (cause) {
      if (current !== generation.current) return;
      if (startingRuntime) { startingRuntime.dispose(); if (session.current === startingRuntime) session.current = null; setSimLoaded(false); setSimState('error'); }
      const message = cause instanceof Error ? cause.message : 'Build failed.';
      applyLint(controller.signal.aborted ? '' : message);
      setBuildState('error'); setSimLoading(false);
      setDiagnostics(controller.signal.aborted ? 'Build stopped or exceeded its time limit. Your project files are unchanged.' : message);
      setConsoleTab('build');
      if (learning) setOutputOpen(true);
    } finally {
      clearTimeout(timeout);
      if (current === generation.current) { compileAbort.current = null; setBuilding(false); }
    }
  }

  async function inspect() {
    const runtime = session.current;
    if (!runtime || inspectionPending.current) return;
    const epoch = ++inspectionEpoch.current;
    inspectionPending.current = true;
    setInspecting(true); setInspectionError('');
    try {
      const result = await runtime.registers();
      if (session.current === runtime && epoch === inspectionEpoch.current) setSnapshot(result);
    } catch (cause) {
      if (session.current === runtime && epoch === inspectionEpoch.current) setInspectionError(cause instanceof Error ? cause.message : 'Register read failed.');
    } finally {
      if (epoch === inspectionEpoch.current) { inspectionPending.current = false; setInspecting(false); }
    }
  }

  async function control(command: RenodeCommand) {
    if (isClientWorker) {
      if (command.type === 'reset') { runAfterLoad.current = simState === 'running'; clearExecution(); }
      if (command.type === 'button') worker.current?.postMessage({ type: 'button', pressed: command.pressed } satisfies SimulatorCommand);
      else if (command.type !== 'step') worker.current?.postMessage({ type: command.type } satisfies SimulatorCommand);
      return;
    }
    const runtime = session.current;
    if (!runtime) return;
    if (command.type !== 'button') setControlBusy(true);
    try {
      if (command.type === 'run') { ++inspectionEpoch.current; inspectionPending.current = false; setInspecting(false); }
      if (command.type === 'reset') clearExecution();
      const result = await runtime.command(command);
      if (session.current !== runtime) return;
      if ('state' in result) acceptRenodeFrame(result);
      if (command.type === 'pause' || command.type === 'step') {
        setSimState('paused');
        await inspect();
      }
    } catch (cause) { if (session.current === runtime) setError(cause instanceof Error ? cause.message : 'Execution control failed.'); }
    finally { if (session.current === runtime && command.type !== 'button') setControlBusy(false); }
  }

  function chooseExample(value: string) {
    if (!exampleSet) return;
    const example = exampleSet.find(item => item.id === value);
    if (!example) return;
    if (!exampleSet.some(item => item.source === editorContent) && !window.confirm(`Replace ${file?.path ?? 'the file'} with this example? Your current edits will be replaced.`)) return;
    updateFile(example.source);
  }

  function restoreTemplate() {
    if (!profile || !window.confirm(`Restore all ${profile.name} project files? Your saved edits for this profile will be replaced.`)) return;
    setProjects(previous => ({ ...previous, [profileId]: {} }));
  }

  function downloadSource() {
    if (!file) return;
    const url = URL.createObjectURL(new Blob([editorContent], { type: 'text/plain' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = file.path.split('/').at(-1)!; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadHex() {
    if (!hexArtifact) return;
    const url = URL.createObjectURL(new Blob([new Uint8Array(hexArtifact)], { type: 'text/plain' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'firmware.hex'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const unavailable = profileError || (!profile ? 'Loading project profiles…' : !available ? (isPico ? health?.message || 'Pico compiler unavailable.' : profile.message) : '');
  return (
    <div className={`workbench-shell${learning ? ' lesson-workbench' : ''}`}>
      <header className="app-header">
        <a className="wordmark" href="/" aria-label="Firmware Academy workbench"><Circuitry size={25} weight="duotone" /><strong>Firmware<span>Academy</span></strong></a>
        <div className="header-divider" /><span className="workspace-title">Firmware workbench</span>
        <div className="header-right"><span className={`compiler-status ${available ? 'ready' : ''}`}><span />{available ? 'Toolchain ready' : 'Setup required'}</span><button className="text-button theme-button" onClick={() => setDark(value => !value)} aria-label={`Switch to ${dark ? 'light' : 'dark'} theme`}>{dark ? 'Light theme' : 'Dark theme'}</button></div>
      </header>
      {!learning && <div className="workbench-toolbar">
        <div className="profile-control"><Cpu size={20} /><div><label htmlFor="project-profile">Project environment</label><select id="project-profile" value={profileId} onChange={event => changeProfile(event.target.value as ProjectId)}>{!profiles.some(item => item.id === profileId) && <option value={profileId}>Loading project profiles…</option>}{profiles.map(item => <option key={item.id} value={item.id}>{item.name} · {item.board}</option>)}</select></div></div>
        <div className="run-controls"><button className="icon-button" aria-label="Reset simulation" title="Reset simulation" disabled={!controlsEnabled} onClick={() => void control({ type: 'reset' })}><ArrowCounterClockwise size={19} /></button><button className="secondary-button pause-button" disabled={!controlsEnabled} onClick={() => void control({ type: simState === 'running' ? 'pause' : 'run' })}>{simState === 'running' ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" />}{simState === 'running' ? 'Pause' : 'Resume'}</button><button className="primary-button" disabled={building || simLoading || !available} onClick={() => void buildAndRun()}><Play size={16} weight="fill" />{building ? 'Building…' : simLoading ? 'Starting…' : 'Build & run'}</button></div>
      </div>}
      {(unavailable || error || stale) && <div className={`notice-bar ${error ? 'error-notice' : ''}`} role={error ? 'alert' : 'status'}><WarningCircle size={18} /><span>{error || (stale ? 'Project changed. Running firmware and downloads remain from the last successful build; build again to update them.' : unavailable)}</span>{error && <button className="text-button" onClick={() => setError('')}>Dismiss</button>}</div>}
      <main className="workbench-grid">
        <section ref={editorPane} className="editor-pane" aria-label="Firmware project editor">
          <div className="editor-toolbar"><div className="file-tab"><Code size={17} /><strong>{file?.path || 'Project'}</strong>{stale && <span className="file-dirty" title="Unbuilt changes">●</span>}</div><div className="editor-actions">{exampleSet ? <><label className="sr-only" htmlFor="examples">Load example</label><select id="examples" value="" onChange={event => chooseExample(event.target.value)}><option value="" disabled>Load example</option>{exampleSet.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></> : <button className="text-button" onClick={restoreTemplate} disabled={!profile || building}>Restore template</button>}<SavedProjectsPanel profileId={profileId} currentFiles={currentFiles} onLoad={loadSavedFiles} /><button className="icon-button" onClick={downloadSource} aria-label="Download active file" title="Download active file" disabled={!file}><DownloadSimple size={18} /></button></div></div>
          <div className="project-editor-layout"><nav className="project-files" aria-label="Project files"><span>Files</span>{profile?.files.map(item => <button key={item.path} className={file?.path === item.path ? 'selected' : ''} aria-current={file?.path === item.path ? 'page' : undefined} onClick={() => setActiveFile(item.path)}><FileCode size={15} /><span>{item.path}</span>{!item.editable && <small>read-only</small>}</button>)}</nav><div className="code-editor"><CodeMirror key={`${profileId}/${file?.path}`} value={editorContent} height="100%" extensions={[...codeExtensions, ...lintExtensions]} theme={dark ? oneDark : 'light'} onChange={updateFile} editable={!!file?.editable} onCreateEditor={view => { editorViewRef.current = view; view.contentDOM.setAttribute('aria-label', `${file?.path || 'Project'} source code`); }} basicSetup={{ foldGutter: true, lineNumbers: true, highlightActiveLine: true }} /></div></div>
          <div className="editor-status"><span>{file?.editable ? 'Editable' : 'Read-only'}</span><span>UTF-8</span><span>Edits saved per project</span><span className="source-lines">{editorContent.split('\n').length} lines</span></div>
          {learning ? <section className={`console-panel output-drawer${outputOpen ? ' is-open' : ''}`} aria-label="Output console">
            {outputOpen && <div
              className="output-drawer-resizer"
              role="separator"
              aria-label="Resize output console"
              aria-orientation="horizontal"
              aria-controls="learning-output-panels"
              aria-valuemin={outputMinHeight}
              aria-valuemax={outputMaxHeight}
              aria-valuenow={visibleOutputHeight}
              aria-valuetext={`${visibleOutputHeight} pixels high`}
              tabIndex={0}
              onKeyDown={resizeOutputWithKeyboard}
              onPointerDown={event => {
                if (event.button !== 0) return;
                event.preventDefault();
                event.currentTarget.focus();
                event.currentTarget.setPointerCapture(event.pointerId);
                outputDrag.current = { pointerId: event.pointerId, y: event.clientY, height: visibleOutputHeight };
              }}
              onPointerMove={resizeOutput}
              onPointerUp={event => {
                if (outputDrag.current?.pointerId !== event.pointerId) return;
                outputDrag.current = null;
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={() => { outputDrag.current = null; }}
              onLostPointerCapture={() => { outputDrag.current = null; }}
            />}
            <div className="console-toolbar">
              <div className="console-tabs" role="tablist" aria-label="Output view" onKeyDown={navigateOutputTabs}>
                <button id="serial-tab" role="tab" aria-selected={consoleTab === 'serial'} aria-controls="serial-output" tabIndex={consoleTab === 'serial' ? 0 : -1} onClick={() => selectOutput('serial')}><TerminalWindow size={15} />Serial<span className="port-tag">UART{uartPort === 2 ? '2' : '0'}</span></button>
                <button id="build-tab" role="tab" aria-selected={consoleTab === 'build'} aria-controls="build-output" tabIndex={consoleTab === 'build' ? 0 : -1} onClick={() => selectOutput('build')}>Build output{buildState === 'success' && <CheckCircle size={14} aria-label="Build succeeded" />}{buildState === 'error' && <WarningCircle size={14} aria-label="Build failed" />}</button>
                {!isClientWorker && <button id="runtime-tab" role="tab" aria-selected={consoleTab === 'runtime'} aria-controls="runtime-output" tabIndex={consoleTab === 'runtime' ? 0 : -1} onClick={() => selectOutput('runtime')}>Runtime{warnings.length > 0 && <span className="warning-count">{warnings.length}</span>}</button>}
              </div>
              <div className="output-drawer-actions">
                {outputOpen && <button className="text-button" onClick={() => consoleTab === 'serial' ? setSerial('') : consoleTab === 'build' ? setDiagnostics('') : undefined} disabled={consoleTab === 'runtime'} aria-label={`Clear ${consoleTab === 'serial' ? 'serial' : 'build'} output`}>Clear</button>}
                <button className="output-drawer-toggle" aria-label={outputOpen ? 'Collapse output console' : 'Open output console'} title={outputOpen ? 'Collapse output console' : 'Open output console'} aria-expanded={outputOpen} aria-controls="learning-output-panels" onClick={() => setOutputOpen(open => !open)}>{outputOpen ? <CaretDown size={16} /> : <CaretUp size={16} />}</button>
              </div>
            </div>
            <div id="learning-output-panels" className="output-drawer-panels" hidden={!outputOpen} style={{ height: outputOpen ? visibleOutputHeight : 0 }}>
              <pre ref={serialElement} className={`console-output ${serial ? '' : 'empty-output'}`} id="serial-output" role="tabpanel" aria-labelledby="serial-tab" hidden={!outputOpen || consoleTab !== 'serial'} tabIndex={0}>{serial || `Actual UART${uartPort === 2 ? '2' : '0'} output from your firmware appears here.\nBuild & run to start the board.`}</pre>
              <pre className={`console-output ${buildState === 'error' ? 'build-error' : ''}`} id="build-output" role="tabpanel" aria-labelledby="build-tab" hidden={!outputOpen || consoleTab !== 'build'} tabIndex={0}>{diagnostics}</pre>
              {!isClientWorker && <pre className="console-output runtime-output" id="runtime-output" role="tabpanel" aria-labelledby="runtime-tab" hidden={!outputOpen || consoleTab !== 'runtime'} tabIndex={0}>{warnings.length ? warnings.join('\n') : 'Model warnings will appear here. Unsupported hardware behavior is never silently hidden.'}</pre>}
            </div>
          </section> :
          <section className="console-panel" aria-label="Output console"><div className="console-toolbar"><div className="console-tabs" role="tablist" aria-label="Output view"><button id="serial-tab" role="tab" aria-selected={consoleTab === 'serial'} aria-controls="serial-output" onClick={() => setConsoleTab('serial')}><TerminalWindow size={16} />Serial monitor<span className="port-tag">UART{uartPort === 2 ? '2' : '0'}</span></button><button id="build-tab" role="tab" aria-selected={consoleTab === 'build'} aria-controls="build-output" onClick={() => setConsoleTab('build')}>Build output{buildState === 'success' && <CheckCircle size={14} />}{buildState === 'error' && <WarningCircle size={14} />}</button>{!isClientWorker && <button id="runtime-tab" role="tab" aria-selected={consoleTab === 'runtime'} aria-controls="runtime-output" onClick={() => setConsoleTab('runtime')}>Runtime {warnings.length > 0 && <span className="warning-count">{warnings.length}</span>}</button>}</div><button className="text-button" onClick={() => consoleTab === 'serial' ? setSerial('') : consoleTab === 'build' ? setDiagnostics('') : undefined} disabled={consoleTab === 'runtime'}>Clear</button></div>{consoleTab === 'serial' ? <pre ref={serialElement} className={`console-output ${serial ? '' : 'empty-output'}`} id="serial-output" role="tabpanel" aria-labelledby="serial-tab">{serial || `Actual UART${uartPort === 2 ? '2' : '0'} output from your firmware appears here.\nBuild & run to start the board.`}</pre> : consoleTab === 'build' ? <pre className={`console-output ${buildState === 'error' ? 'build-error' : ''}`} id="build-output" role="tabpanel" aria-labelledby="build-tab">{diagnostics}</pre> : <pre className="console-output runtime-output" id="runtime-output" role="tabpanel" aria-labelledby="runtime-tab">{warnings.length ? warnings.join('\n') : 'Model warnings will appear here. Unsupported hardware behavior is never silently hidden.'}</pre>}</section>
          }
        </section>
        {learning && paneDivider}
        <section className="execution-pane" aria-label="Firmware execution target"><div className="target-tabs" role="tablist" aria-label="Execution target"><button id="simulation-tab" role="tab" aria-selected={mode === 'simulation'} aria-controls="simulation-panel" onClick={() => setMode('simulation')}><Circuitry size={17} />Simulation</button>{hasRegisters && <button id="registers-tab" role="tab" aria-selected={mode === 'registers'} aria-controls="registers-panel" onClick={() => { setMode('registers'); if (simState === 'paused' || simState === 'ready') void inspect(); }}><Code size={17} />Registers</button>}<button id="hardware-tab" role="tab" aria-selected={mode === 'hardware'} aria-controls="hardware-panel" onClick={() => setMode('hardware')}><Cpu size={17} />Real hardware</button></div>
          <div hidden={mode !== 'simulation'} id="simulation-panel" role="tabpanel" aria-labelledby="simulation-tab"><div className="simulation-heading"><div><h1>{isPico ? 'Virtual Pico' : isArduino ? 'Virtual Arduino Uno' : 'STM32F4 Discovery'}</h1><p>{isClientWorker ? 'Real firmware. Emulated hardware.' : `${profile?.framework || 'ARM Cortex-M4'} · dedicated Renode session`}</p></div><span className={`simulation-state ${simState === 'running' ? 'is-running' : ''}`}><span />{simLoading ? 'Loading…' : simState === 'empty' ? 'Not started' : simState[0].toUpperCase() + simState.slice(1)}</span></div>
            {learning && isArduino ? <ExerciseHardware learning={learning} pins={pins} enabled={controlsEnabled} serialReady={controlsEnabled && running} onButton={pressed => void control({ type: 'button', pressed })} onAnalog={(pin, voltage) => worker.current?.postMessage({ type: 'analog', pin, voltage } satisfies SimulatorCommand)} onSerialByte={byte => worker.current?.postMessage({ type: 'serial', byte } satisfies SimulatorCommand)} timeUs={timeUs} trace={trace} /> : <>
            {isPico ? <><PicoBoard pins={pins} loaded={controlsEnabled} onButton={pressed => void control({ type: 'button', pressed })} /><div className="simulation-caption"><span><Cpu size={15} />rp2040js · browser worker</span><output aria-label="Simulation time">{(timeUs / 1_000_000).toFixed(3)} s</output></div><LogicAnalyzer events={trace} timeUs={timeUs} /><div className="connection-note"><strong>Wiring</strong><p>Onboard LED GP25. External button GP14 to GND. UART0 uses GP0 TX and GP1 RX.</p></div></> : <>
              <Breadboard boardKey={isArduino ? 'arduino-uno' : 'stm32f4-discovery'} pins={pins} enabled={controlsEnabled} onButton={pressed => void control({ type: 'button', pressed })} />
              <div className="simulation-caption"><span><Cpu size={15} />{isArduino ? 'avr8js · browser worker' : 'Renode · ARM execution'}</span><output aria-label="Simulation time">{(timeUs / 1_000_000).toFixed(3)} s</output></div>
              <LogicAnalyzer events={trace} timeUs={timeUs} pinLabel={pin => pinLabelFor(isArduino ? 'arduino-uno' : 'stm32f4-discovery', pin)} />
              {isArduino ? <div className="connection-note"><strong>Wiring</strong><p>Onboard LED on D13 (PB5). External button between D2 and GND, read with <code>INPUT_PULLUP</code>. UART0 is <code>Serial</code> at the baud rate your sketch sets with <code>Serial.begin()</code>. Any pin the firmware drives shows up live and in the analyzer.</p></div> : <div className="connection-note"><strong>Actual machine state, not source-code animation</strong><p>Both profiles run compiled ARM firmware. HSI / SysTick: 16 MHz. Button input is polled. Model warnings remain visible in Runtime; this is not cycle-exact silicon simulation. GPIOA/B/D are available in the logical port explorer and analyzer; their displayed positions are not a physical header map.</p><button className="text-button inspect-shortcut" disabled={!controlsEnabled} onClick={() => { setMode('registers'); if (simState === 'running') void control({ type: 'pause' }); else void inspect(); }}>Pause and inspect registers →</button></div>}
            </>}
            </>}
          </div>
          {hasRegisters && <div hidden={mode !== 'registers'} id="registers-panel" role="tabpanel" aria-labelledby="registers-tab"><RegisterInspector snapshot={snapshot} busy={inspecting || controlBusy} enabled={controlsEnabled && (simState === 'paused' || simState === 'ready')} onRefresh={() => void inspect()} onStep={() => void control({ type: 'step' })} error={inspectionError} />{simState === 'running' && <div className="inspector-pause"><button className="primary-button" onClick={() => void control({ type: 'pause' })} disabled={controlBusy}><Pause size={15} />Pause to inspect</button></div>}</div>}
          <div hidden={mode !== 'hardware'} id="hardware-panel" role="tabpanel" aria-labelledby="hardware-tab" className="hardware-container">{isPico ? <HardwarePanel uf2={artifact} artifactStale={stale} /> : isArduino ? <section className="arduino-hardware"><h2>Take the firmware to hardware</h2><p>Download the compiled Intel HEX image for an Arduino Uno. Flash it with the Arduino IDE, <code>arduino-cli upload</code>, or <code>avrdude</code>. Automatic browser flashing is not connected yet.</p>{hexArtifact && !stale ? <button className="secondary-button" onClick={downloadHex}><DownloadSimple size={16} />Download HEX</button> : <button className="secondary-button" disabled>Build current project to download HEX</button>}<dl><dt>Serial console</dt><dd>A real Uno's USB port carries UART0 directly through its USB-to-serial chip, so Web Serial below talks to the same <code>Serial</code> your sketch uses — unlike the Pico's separate GPIO UART.</dd></dl><HardwarePanel uf2={null} artifactStale={false} serialOnly /></section> : <section className="stm32-hardware"><h2>Take the firmware to hardware</h2><p>Download the compiled ELF for an STM32F407 Discovery board. Flash it using a compatible ST-Link/SWD tool. Browser flashing and the Rust companion are not connected yet.</p>{buildId && !stale ? <a className="secondary-button" download={`${profileId}.elf`} href={`/api/projects/builds/${buildId}/elf`}><DownloadSimple size={16} />Download ELF</a> : <button className="secondary-button" disabled>Build current project to download ELF</button>}<dl><dt>Serial console</dt><dd>USART2: PA2 TX, PA3 RX, 115200 baud. Use a 3.3 V UART adapter and common ground.</dd><dt>Debugging</dt><dd>CPU register access requires a supported debug probe; a serial connection alone is not sufficient.</dd></dl><HardwarePanel uf2={null} artifactStale={false} serialOnly /></section>}</div>
        </section>
      </main>
      <footer className="app-footer"><span><span className="footer-mark" />Local workbench</span><span>{profile?.board || 'Loading target'}<span className="footer-separator">/</span>{isClientWorker ? 'Browser execution' : 'Renode server execution'}</span><a href={isPico ? 'https://www.raspberrypi.com/documentation/microcontrollers/raspberry-pi-pico.html' : isArduino ? 'https://docs.arduino.cc/hardware/uno-rev3/' : 'https://renode.readthedocs.io/en/latest/'} target="_blank" rel="noreferrer">{isPico ? 'Pico documentation' : isArduino ? 'Arduino documentation' : 'Renode documentation'} <ArrowSquareOut size={13} /></a></footer>
    </div>
  );
}
