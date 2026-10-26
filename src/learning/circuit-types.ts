import type { BoardKey, BreadboardLayout, PinRef } from '../breadboard-contracts';

export type CircuitScenario = {
  id: string;
  boardKey: BoardKey;
  outputPin: number;
  supplyVolts: number;
  ledForwardVolts: number;
  minCurrentMa: number;
  maxCurrentMa: number;
  resistanceOptions: number[];
  allowedParts: string[];
  initialLayout: BreadboardLayout;
};

export type CircuitDraft = {
  layout: BreadboardLayout;
  currentAnswer: string;
};

export type CircuitGoalRule = 'complete-path' | 'led-forward' | 'series-resistor' | 'safe-current' | 'current-calculation';
export type CircuitGoal = { id: string; label: string; rule: CircuitGoalRule };
export type CircuitInspection = {
  connected: boolean;
  forward: boolean;
  seriesResistor: boolean;
  shorted: boolean;
  safeCurrent: boolean;
  currentMa: number | null;
  resistanceOhms: number | null;
  path: PinRef[];
  issues: string[];
  passed: boolean;
};
