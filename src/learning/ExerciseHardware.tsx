import { useEffect, useId, useMemo } from 'react';
import { Cpu } from '@phosphor-icons/react';
import { Breadboard } from '../components/Breadboard';
import { UnoBoard } from '../components/UnoBoard';
import { LogicAnalyzer } from '../components/LogicAnalyzer';
import { pinLabelFor } from '../board-pinouts';
import { inspectCircuit } from './circuit-model';
import type { TraceEvent } from '../contracts';
import type { ExerciseStep, LearningWorkspace } from './types';

/** Real ADC input: moving this sends an actual voltage to the simulated chip's channel. */
function AnalogInputControl({ input, enabled, voltage, onVoltageChange, onAnalog }: { input: NonNullable<ExerciseStep['analogInput']>; enabled: boolean; voltage: number; onVoltageChange: (voltage: number) => void; onAnalog: (pin: number, voltage: number) => void }) {
  const id = useId();
  // Re-sync the real channel after a (re)build, which rebuilds the chip from scratch at 0 V.
  useEffect(() => { if (enabled) onAnalog(input.pin, voltage); }, [enabled, input.pin]);
  return (
    <div className="analog-input-control">
      <label htmlFor={id}>{input.label} <output htmlFor={id}>{voltage.toFixed(2)} V</output></label>
      <input
        id={id}
        type="range"
        min={input.min}
        max={input.max}
        step="0.01"
        value={voltage}
        disabled={!enabled}
        aria-valuetext={`${voltage.toFixed(2)} volts`}
        onChange={event => { const next = Number(event.target.value); onVoltageChange(next); onAnalog(input.pin, next); }}
      />
      <p>A real voltage applied to a real ADC channel. {input.min} V and {input.max} V are this control's limits, not the pin's physical range.</p>
    </div>
  );
}

/** Real UART RX injection: each button writes one actual byte into the simulated USART. Gated on the simulation
 * actually running — before that, Serial.begin() has not executed yet and an injected byte would be silently lost. */
function SerialCommandControl({ commands, enabled, ready, onSelect, onSerialByte }: { commands: NonNullable<ExerciseStep['serialCommands']>; enabled: boolean; ready: boolean; onSelect: (char: string) => void; onSerialByte: (byte: number) => void }) {
  return (
    <div className="serial-command-control">
      <strong>Send a command</strong>
      <div className="serial-command-buttons">
        {commands.map(command => <button key={command.char} type="button" className="secondary-button" disabled={!enabled || !ready} onClick={() => { onSelect(command.char); onSerialByte(command.char.charCodeAt(0)); }}>{command.label}</button>)}
      </div>
      <p>Each button sends one real byte into the simulated chip's USART receiver, exactly as a connected device would.{enabled && !ready ? ' Run the sketch first, so Serial.begin() has executed.' : ''}</p>
    </div>
  );
}

export function ExerciseHardware({ learning, pins, enabled, serialReady, timeUs, trace, onButton, onAnalog, onSerialByte }: {
  learning: LearningWorkspace;
  pins: number[];
  enabled: boolean;
  serialReady?: boolean;
  timeUs: number;
  trace: TraceEvent[];
  onButton: (pressed: boolean) => void;
  onAnalog?: (pin: number, voltage: number) => void;
  onSerialByte?: (byte: number) => void;
}) {
  const scenario = learning.hardware;
  const draft = learning.circuit;
  const analogInput = learning.analogInput;
  const analogVoltage = learning.analogVoltage ?? analogInput?.min ?? 0;
  const inspection = useMemo(() => scenario && draft ? inspectCircuit(draft.layout, scenario) : null, [scenario, draft?.layout]);
  const caption = <div className="simulation-caption"><span><Cpu size={15} />Live firmware output</span><output aria-label="Simulation time">{(timeUs / 1_000_000).toFixed(3)} s</output></div>;
  const analogControl = analogInput && onAnalog && <AnalogInputControl key={analogInput.pin} input={analogInput} enabled={enabled} voltage={analogVoltage} onVoltageChange={voltage => learning.onAnalogVoltageChange?.(voltage)} onAnalog={onAnalog} />;
  const serialControl = learning.serialCommands && onSerialByte && <SerialCommandControl commands={learning.serialCommands} enabled={enabled} ready={!!serialReady} onSelect={char => learning.onSerialCommandChange?.(char)} onSerialByte={onSerialByte} />;

  if (scenario && draft) return <>
    <div className="exercise-circuit-summary">
      <strong>D{scenario.outputPin}: {pins[scenario.outputPin] ? 'HIGH' : 'LOW'} <span>· emulated firmware pin</span></strong>
      <p>{inspection?.passed ? `Series circuit connected. Estimated HIGH-state current: ${inspection.currentMa?.toFixed(2)} mA.` : inspection?.issues.join(' ')}</p>
      <small>Wires and component orientation are checked as a circuit graph. Current uses a fixed {scenario.supplyVolts} V supply / {scenario.ledForwardVolts} V LED model, not an electrical measurement or damage simulation.</small>
    </div>
    <Breadboard boardKey={scenario.boardKey} pins={pins} layout={draft.layout} scenario={scenario} onLayoutChange={layout => learning.onCircuitChange?.({ ...draft, layout })} enabled={enabled} onButton={onButton} />
    {caption}
    <LogicAnalyzer events={trace} timeUs={timeUs} pinLabel={pin => pinLabelFor('arduino-uno', pin)} />
    {analogControl}
    {serialControl}
  </>;

  return <>
    <UnoBoard pins={pins} loaded={enabled} onButton={onButton} />
    {caption}
    <LogicAnalyzer events={trace} timeUs={timeUs} pinLabel={pin => pinLabelFor('arduino-uno', pin)} />
    <div className="connection-note"><strong>This exercise uses the onboard LED</strong><p>D13 controls the onboard LED. No breadboard or external wiring is needed.</p></div>
    {analogControl}
    {serialControl}
  </>;
}
