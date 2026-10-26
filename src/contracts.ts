export type CompileResult = {
  elf: string;
  uf2: string;
  diagnostics: string;
};

export type CompilerHealth = {
  ready: boolean;
  backend: string;
  message: string;
};

export type TraceEvent =
  | { type: 'pin'; timeUs: number; pin: number; level: 0 | 1 }
  | { type: 'uart_tx'; timeUs: number; port: number; text: string };

export type SimulatorCommand =
  | { type: 'load'; uf2: ArrayBuffer }
  | { type: 'run' }
  | { type: 'pause' }
  | { type: 'reset' }
  | { type: 'button'; pressed: boolean }
  | { type: 'analog'; pin: number; voltage: number }
  | { type: 'serial'; byte: number };

export type SimulatorMessage =
  | { type: 'state'; state: 'ready' | 'running' | 'paused'; timeUs: number }
  | { type: 'frame'; timeUs: number; pins: number[]; events: TraceEvent[] }
  | { type: 'error'; message: string };
