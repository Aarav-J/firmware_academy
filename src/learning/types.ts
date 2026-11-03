import type { TraceEvent } from '../contracts';
import type { CircuitDraft, CircuitGoal, CircuitScenario } from './circuit-types';

export type ConceptId = 'execution' | 'digital-output' | 'timing' | 'closed-circuit' | 'led-polarity' | 'resistor-current' | 'external-output'
  | 'pull-up-input' | 'edge-event' | 'debounce' | 'serial-trace' | 'blocking-delay' | 'millis-timing' | 'state-machine'
  | 'duty-cycle' | 'analog-input' | 'hysteresis' | 'interrupt-handler' | 'uart-protocol' | 'i2c-transaction'
  | 'spi-transfer' | 'eeprom-persistence';
export type GoalRule = 'build' | 'steady-high' | 'delayed-low' | 'timed-blink' | 'circuit-wiring'
  | 'mirrors-input' | 'toggles-per-press' | 'debounced-count' | 'reports-events'
  | 'responsive-under-load' | 'state-sequence'
  | 'duty-cycle-match' | 'duty-tracks-input'
  | 'reports-analog-value' | 'scales-measurement' | 'hysteresis-indicator'
  | 'interrupt-count' | 'uart-command-handled'
  | 'i2c-identifies-device' | 'i2c-handles-failure'
  | 'spi-identifies-device' | 'spi-handles-failure'
  | 'eeprom-round-trip' | 'eeprom-persists-value';
export type ExerciseGoal = { id: string; label: string; rule: GoalRule; pin?: number; highMs?: number; lowMs?: number };
export type SignalTarget = { pin: number; highMs: number; lowMs: number };
export type ReadStep = {
  id: string;
  kind: 'read';
  title: string;
  paragraphs: string[];
  takeaway: string;
};
export type ExploreStep = {
  id: string;
  kind: 'explore';
  title: string;
  paragraphs: string[];
  concept: ConceptId;
  instruction: string;
};
export type PredictStep = {
  id: string;
  kind: 'predict';
  title: string;
  prompt: string;
  options: { id: string; label: string }[];
  answerId: string;
  explanation: string;
};
export type ExerciseStep = {
  id: string;
  kind: 'exercise';
  title: string;
  paragraphs: string[];
  starterCode: string;
  goals: ExerciseGoal[];
  hints: string[];
  hardware?: CircuitScenario;
  signal?: SignalTarget;
  analogInput?: { pin: number; label: string; min: number; max: number };
  serialCommands?: { label: string; char: string }[];
};
export type CircuitStep = {
  id: string;
  kind: 'circuit';
  title: string;
  paragraphs: string[];
  scenario: CircuitScenario;
  goals: CircuitGoal[];
  hints: string[];
};
export type LessonStep = ReadStep | ExploreStep | PredictStep | ExerciseStep | CircuitStep;
export type Lesson = {
  id: string;
  title: string;
  description: string;
  durationMinutes: number;
  steps: LessonStep[];
};
export type CourseUnit = {
  id: string;
  title: string;
  description: string;
  lessons: Lesson[];
  plannedTopics?: string[];
};
export type Course = {
  id: string;
  title: string;
  description: string;
  audience: string;
  board: string;
  units: CourseUnit[];
};
export type LearningProgress = {
  version: 1;
  lessonId: string;
  stepId: string;
  completedSteps: string[];
  drafts: Record<string, string>;
  predictions: Record<string, string>;
  circuits?: Record<string, CircuitDraft>;
};
export type WorkbenchObservation = {
  built: boolean;
  state: string;
  timeUs: number;
  pins: number[];
  trace: TraceEvent[];
  startupTrace?: TraceEvent[];
  circuit?: CircuitDraft;
  analogVoltage?: number;
  serial?: string;
  lastSerialCommand?: string;
  eeprom?: number;
};
export type WorkbenchControls = {
  available: boolean;
  building: boolean;
  loading: boolean;
  buildFailed: boolean;
  running: boolean;
  canControl: boolean;
  run: () => void;
  reset: () => void;
  togglePause: () => void;
};
export type LearningWorkspace = {
  id: string;
  source: string;
  onSourceChange: (source: string) => void;
  onObservation: (observation: WorkbenchObservation) => void;
  onControls?: (controls: WorkbenchControls | null) => void;
  hardware?: CircuitScenario;
  circuit?: CircuitDraft;
  onCircuitChange?: (draft: CircuitDraft) => void;
  analogInput?: { pin: number; label: string; min: number; max: number };
  analogVoltage?: number;
  onAnalogVoltageChange?: (voltage: number) => void;
  serialCommands?: { label: string; char: string }[];
  lastSerialCommand?: string;
  onSerialCommandChange?: (char: string) => void;
};
export type GoalResult = { id: string; passed: boolean; detail: string };

export function stepKey(lessonId: string, stepId: string): string {
  return `${lessonId}/${stepId}`;
}
