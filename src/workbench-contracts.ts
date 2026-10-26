import type { TraceEvent } from './contracts';

export type ProjectId = 'pico' | 'stm32-baremetal' | 'stm32-zephyr' | 'arduino-uno';
export type ExternalProjectId = Exclude<ProjectId, 'pico'>;
export type Stm32ProjectId = Extract<ProjectId, 'stm32-baremetal' | 'stm32-zephyr'>;
export type ProjectFile = { path: string; content: string; editable: boolean };
export type ProjectProfile = {
  id: ProjectId;
  name: string;
  board: string;
  framework: string;
  description: string;
  files: ProjectFile[];
  available: boolean;
  message: string;
};
export type ProjectBuildInput = { profile: ExternalProjectId; files: Record<string, string> };
export type ProjectBuildResult = { buildId: string; profile: ExternalProjectId; diagnostics: string; hex?: string };
export type RenodeState = 'ready' | 'running' | 'paused' | 'error' | 'closed';
export type PeripheralRegister = { name: string; address: string; value: string };
export type RegisterSnapshot = {
  timeUs: number;
  cpu: Record<string, string>;
  peripherals: PeripheralRegister[];
  disassembly: string;
};
export type RenodeFrame = {
  state: RenodeState;
  timeUs: number;
  pins: number[];
  events: TraceEvent[];
  warnings: string[];
  error?: string;
};
export type RenodeCommand =
  | { type: 'run' | 'pause' | 'reset' | 'step' }
  | { type: 'button'; pressed: boolean };
export type RenodeSessionInfo = { sessionId: string; token: string; state: RenodeState };
