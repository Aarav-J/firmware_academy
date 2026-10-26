import { useMemo, useState } from 'react';
import { Breadboard } from '../components/Breadboard';
import { assessCircuit, inspectCircuit } from './circuit-model';
import type { CircuitDraft } from './circuit-types';
import type { CircuitStep } from './types';
import './circuit-activity.css';

type CircuitActivityProps = {
  step: CircuitStep;
  draft: CircuitDraft;
  onChange: (draft: CircuitDraft) => void;
  onComplete: () => void;
};


function CircuitActivityContent({ step, draft, onChange, onComplete }: CircuitActivityProps) {
  const [checkedStamp, setCheckedStamp] = useState<string | null>(null);
  const [hintCount, setHintCount] = useState(0);
  const teachingPins = useMemo(() => Array.from({ length: 20 }, (_, pin) => pin === step.scenario.outputPin ? 1 : 0), [step.scenario.outputPin]);
  const inspection = useMemo(() => inspectCircuit(draft.layout, step.scenario), [draft.layout, step.scenario]);
  const results = useMemo(() => assessCircuit(step, draft), [step, draft]);
  const stamp = JSON.stringify([step.id, draft]);
  const hasChecked = checkedStamp !== null;
  const freshCheck = checkedStamp === stamp;
  const allPassed = results.length === step.goals.length && results.length > 0 && results.every(result => result.passed) && inspection.passed;
  const calculationGoal = step.goals.find(goal => goal.rule === 'current-calculation');
  const visibleHints = step.hints.slice(0, hintCount);

  function complete() {
    // Re-evaluate the current controlled draft at the moment of completion.
    const currentResults = assessCircuit(step, draft);
    const currentInspection = inspectCircuit(draft.layout, step.scenario);
    if (checkedStamp === JSON.stringify([step.id, draft]) && currentInspection.passed && currentResults.length === step.goals.length && currentResults.length > 0 && currentResults.every(result => result.passed)) {
      onComplete();
    }
  }

  return (
    <section className="ca-activity" aria-label="Circuit practice">
      <div className="ca-introduction">
        <h2>{step.title}</h2>
        <div className="ca-prose">{step.paragraphs[0] && <p>{step.paragraphs[0]}</p>}</div>
        <details className="ca-guidance">
          <summary>Activity guidance</summary>
          <div className="ca-prose">
            {step.paragraphs.slice(1).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
            <p>The source is fixed for this wiring activity. The external LED is a circuit-model result, not a measured current or an emulated firmware output. The board’s pushbutton is disabled; its pin connections remain interactive.</p>
            <p>Select a hole to see its connected group. Click a board pin or a free hole, then its destination, to add a jumper. Select a component to inspect or change its inserted lead locations. Select a wire to remove it; Undo restores your last edit. Escape cancels a pending connection.</p>
          </div>
        </details>
      </div>
      <div className="ca-teaching-source">
        <strong>Teaching source: D{step.scenario.outputPin} HIGH; no firmware is running</strong>
        <p>Model LED indication, not measured current. Wiring controls stay enabled.</p>
      </div>
      <div className="ca-practice-grid">
      <div className="ca-practice-primary">
      <section className="ca-wiring-section" aria-label="Wire the circuit">
        <div className="ca-wiring-instructions">
          <h3>Make electrical connections</h3>
          <p>Connect free holes with jumper wires. Select a part to inspect its leads; use Find a pin or zoom for a closer look.</p>
        </div>
        <Breadboard
          boardKey={step.scenario.boardKey}
          pins={teachingPins}
          layout={draft.layout}
          onLayoutChange={layout => onChange({ ...draft, layout })}
          scenario={step.scenario}
        />
      </section>
      {calculationGoal && (
        <div className="ca-current-question">
          <label htmlFor={`ca-current-${step.id}`}>Your estimated current (mA)</label>
          <p id={`ca-current-help-${step.id}`}>Use the selected resistor: I = ({step.scenario.supplyVolts} − {step.scenario.ledForwardVolts}) / R amperes. Convert to milliamperes by multiplying by 1,000. Enter a number, for example 8.5; the answer is checked with your wiring.</p>
          <div className="ca-current-input">
            <input
              id={`ca-current-${step.id}`}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={draft.currentAnswer}
              aria-describedby={`ca-current-help-${step.id}`}
              onChange={event => onChange({ ...draft, currentAnswer: event.target.value })}
            />
            <span>mA</span>
          </div>
        </div>
      )}
      </div>
      <aside className="ca-practice-feedback" aria-label="Check your circuit">
      <section className="ca-goals" aria-label="Circuit goals">
        <h3>What your circuit needs</h3>
        <ul>
          {step.goals.map(goal => {
            const result = results.find(item => item.id === goal.id);
            return (
              <li key={goal.id} className={hasChecked ? result?.passed ? 'ca-goal-pass' : 'ca-goal-fail' : ''}>
                <span className="ca-goal-symbol" aria-hidden="true">{hasChecked ? result?.passed ? '✓' : '○' : '·'}</span>
                <div><strong>{goal.label}</strong>{hasChecked && <p><span className="ca-goal-result">{result?.passed ? 'Passed. ' : 'Needs attention. '}</span>{result?.detail ?? 'Check this goal again.'}</p>}</div>
              </li>
            );
          })}
        </ul>
      </section>
      <div className="ca-check-section">
        <div className="ca-feedback" role="status" aria-live="polite" aria-atomic="true">
          {!hasChecked ? <p>Check your circuit when you’re ready. Connections, polarity, the series resistor, and current safety are checked together.</p>
            : !freshCheck ? <p><strong>Your circuit or answer has changed.</strong> The goal details reflect your current work. Check circuit again before continuing.</p>
              : allPassed ? <p><strong>All circuit goals passed.</strong> Your connected path and current estimate are ready. Continue when you’re ready.</p>
                : <p><strong>Not ready yet.</strong> Use the goal feedback above to make a change, then check again.</p>}
          {hasChecked && calculationGoal && inspection.currentMa !== null && <p>Model estimate for this layout: <strong>{inspection.currentMa.toFixed(2)} mA</strong>, using {inspection.resistanceOhms} Ω. The teaching range is {step.scenario.minCurrentMa}–{step.scenario.maxCurrentMa} mA; this is calculated, not measured.</p>}
          {hasChecked && inspection.shorted && <p className="ca-safety-warning">Short circuit: remove the direct or bypass path before continuing. A LOW or unlit LED does not make unsafe wiring acceptable.</p>}
          {hasChecked && !inspection.passed && results.every(result => result.passed) && <p>{inspection.issues.join(' ') || 'The circuit still needs a complete, safe LED path. Check the connected parts and resistor.'}</p>}
        </div>
        <div className="ca-actions">
          <button type="button" className="ca-button ca-button-check" onClick={() => setCheckedStamp(stamp)}>Check circuit</button>
          <button type="button" className="ca-button ca-button-continue" disabled={!freshCheck || !allPassed} onClick={complete}>Continue</button>
        </div>
      </div>
      {step.hints.length > 0 && (
        <section className="ca-hints" aria-label="Circuit hints">
          <button type="button" className="ca-button" disabled={hintCount >= step.hints.length} onClick={() => setHintCount(count => Math.min(count + 1, step.hints.length))}>
            {hintCount === 0 ? 'Show a hint' : hintCount < step.hints.length ? 'Show next hint' : 'All hints shown'}
          </button>
          {visibleHints.length > 0 && <ol>{visibleHints.map((hint, index) => <li key={index}>{hint}</li>)}</ol>}
        </section>
      )}
      </aside>
      </div>
    </section>
  );
}

export function CircuitActivity(props: CircuitActivityProps) {
  return <CircuitActivityContent key={props.step.id} {...props} />;
}
