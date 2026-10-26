import { useEffect, useId, useState } from 'react';
import { ArrowCounterClockwise, ArrowRight, CaretLeft, CaretRight, CheckCircle, Info, Lightbulb, Pause, Play, SkipForward, WarningCircle } from '@phosphor-icons/react';
import type { Lesson, LessonStep } from './types';
import { CircuitExplorer } from './CircuitExplorer';
import { AnalogInputExplainer, BlockingDelayExplainer, DebounceExplainer, DutyCycleExplainer, EdgeEventExplainer, HysteresisExplainer, I2cTransactionExplainer, InterruptHandlerExplainer, MillisTimingExplainer, PullUpInputExplainer, SerialTraceExplainer, StateMachineExplainer, UartProtocolExplainer } from './explainers';
import './lesson-content.css';

function BoardOutput({ high, configured = true }: { high: boolean; configured?: boolean }) {
  return (
    <div className="lc-board-output">
      <div className="lc-signal-state">
        <span>Pin 13 output</span>
        <strong>{configured ? (high ? 'HIGH' : 'LOW') : 'Not configured'}</strong>
        <span>{configured ? (high ? 'About 5 V' : 'About 0 V') : 'Waiting for setup'}</span>
      </div>
      <ArrowRight className="lc-flow-arrow" size={24} aria-hidden="true" />
      <div className="lc-led-output">
        <span className={`lc-led${high ? ' lc-led-on' : ''}`} aria-hidden="true" />
        <div><strong>LED {high ? 'on' : 'off'}</strong><span>Uno onboard LED · L</span></div>
      </div>
    </div>
  );
}

const executionLines = [
  { scope: 'setup', code: 'pinMode(13, OUTPUT);' },
  { scope: 'loop', code: 'digitalWrite(13, HIGH);' },
  { scope: 'loop', code: 'delay(500);' },
  { scope: 'loop', code: 'digitalWrite(13, LOW);' },
  { scope: 'loop', code: 'delay(500);' },
];

function ExecutionExplainer() {
  const [tick, setTick] = useState(-1);
  const line = tick <= 0 ? 0 : ((tick - 1) % 4) + 1;
  const loopCount = tick < 1 ? 0 : Math.floor((tick - 1) / 4) + 1;
  const high = tick > 0 && (line === 1 || line === 2);
  const description = tick < 0
    ? 'Ready to begin. The arrow marks the first statement to run.'
    : line === 0
      ? 'Setup configured pin 13 as an output. Setup will not run again until reset.'
      : line === 1
        ? 'The HIGH write turns the LED on. The next statement does not run yet.'
        : line === 2
          ? 'The program waits 500 ms. The pin stays HIGH, so the LED stays on.'
          : line === 3
            ? 'The LOW write turns the LED off.'
            : 'The program waits 500 ms with the LED off. Next, loop starts again—not setup.';

  return (
    <div className="lc-explainer">
      <div className="lc-execution-stats"><span>Setup runs: <strong>{tick < 0 ? 0 : 1}</strong></span><span>Loop pass: <strong>{loopCount}</strong></span></div>
      <div className="lc-diagram-stage">
        <div className="lc-execution-diagram">
          <ol className="lc-code-steps" aria-label="Simplified program execution">
            {executionLines.map((entry, index) => (
              <li key={index} className={line === index ? 'lc-current-line' : ''} aria-current={line === index ? 'step' : undefined}>
                <span className="lc-line-marker" aria-hidden="true">{line === index ? '→' : index + 1}</span>
                <span className="lc-code-scope">{entry.scope}</span><code>{entry.code}</code>
                {line === index && <span className="sr-only">{tick < 0 ? 'Next statement' : 'Just executed'}</span>}
              </li>
            ))}
          </ol>
          <BoardOutput high={high} configured={tick >= 0} />
        </div>
      </div>
      <div className="lc-transport-row">
        <p className="lc-narration" role="status">{description}</p>
        <div className="lc-transport-controls">
          <button className="secondary-button" onClick={() => setTick(-1)} disabled={tick < 0}><ArrowCounterClockwise size={16} aria-hidden="true" />Reset</button>
          <button className="icon-button" onClick={() => setTick(value => Math.max(-1, value - 1))} disabled={tick < 0} aria-label="Previous statement" title="Previous statement"><CaretLeft size={16} aria-hidden="true" /></button>
          <button className="primary-button" onClick={() => setTick(value => value + 1)}><SkipForward size={16} aria-hidden="true" />{tick < 0 ? 'Run first statement' : 'Next statement'}</button>
        </div>
      </div>
      <p className="lc-footnote">Each click executes one statement. A delay is shown as a single teaching step; you do not need to wait 500 ms here.</p>
    </div>
  );
}

function DigitalOutputExplainer() {
  const [high, setHigh] = useState(false);
  const [idleSteps, setIdleSteps] = useState(0);
  const [message, setMessage] = useState('Pin 13 is configured as an output and starts LOW. Try writing HIGH.');

  function writeOutput(nextHigh: boolean) {
    setHigh(nextHigh);
    setIdleSteps(0);
    setMessage(`digitalWrite(13, ${nextHigh ? 'HIGH' : 'LOW'}) sets the pin ${nextHigh ? 'HIGH' : 'LOW'}. It keeps this value until another write changes it.`);
  }

  return (
    <div className="lc-explainer">
      <div className="lc-output-switch-row">
        <div><strong>Choose the output level</strong><p>The switch writes a new value to pin 13.</p></div>
        <button className="lc-output-switch" role="switch" aria-checked={high} aria-label="Pin 13 HIGH output" onClick={() => writeOutput(!high)}>
          <span className="lc-switch-track" aria-hidden="true"><span /></span><span>{high ? 'HIGH' : 'LOW'}</span>
        </button>
      </div>
      <div className="lc-diagram-stage"><BoardOutput high={high} /></div>
      <div className="lc-transport-row">
        <p className="lc-narration" role="status">{message}</p>
        <div className="lc-transport-controls">
          <button className="secondary-button" onClick={() => writeOutput(true)}>Write HIGH</button>
          <button className="secondary-button" onClick={() => writeOutput(false)}>Write LOW</button>
          <button className="icon-button" aria-label="Step without a write" title="Step without a write" onClick={() => {
            setIdleSteps(value => value + 1);
            setMessage(`Advanced without writing to pin 13. It is still ${high ? 'HIGH' : 'LOW'}; the LED stays ${high ? 'on' : 'off'}.`);
          }}><CaretRight size={16} aria-hidden="true" /></button>
        </div>
      </div>
      <p className="lc-footnote">Steps since last write: <strong>{idleSteps}</strong>. The output holds its state—even when the processor does something else. This models the Uno onboard LED, not every possible LED circuit.</p>
    </div>
  );
}

function TimingExplainer() {
  const [onMs, setOnMs] = useState(500);
  const [offMs, setOffMs] = useState(500);
  const [high, setHigh] = useState(true);
  const [playing, setPlaying] = useState(false);
  const onId = useId();
  const offId = useId();
  const period = onMs + offMs;
  const duty = onMs / period * 100;

  useEffect(() => {
    if (!playing) return;
    const timeout = window.setTimeout(() => setHigh(value => !value), high ? onMs : offMs);
    return () => window.clearTimeout(timeout);
  }, [playing, high, onMs, offMs]);

  return (
    <div className="lc-explainer">
      <div className="lc-timing-controls">
        <div className="lc-range-control">
          <label htmlFor={onId}>Time HIGH <output htmlFor={onId}>{onMs} ms</output></label>
          <input id={onId} type="range" min="100" max="2000" step="50" value={onMs} onChange={event => setOnMs(Number(event.target.value))} aria-valuetext={`${onMs} milliseconds on`} />
          <div className="lc-range-limits"><span>100 ms</span><span>2,000 ms</span></div>
        </div>
        <div className="lc-range-control">
          <label htmlFor={offId}>Time LOW <output htmlFor={offId}>{offMs} ms</output></label>
          <input id={offId} type="range" min="100" max="2000" step="50" value={offMs} onChange={event => setOffMs(Number(event.target.value))} aria-valuetext={`${offMs} milliseconds off`} />
          <div className="lc-range-limits"><span>100 ms</span><span>2,000 ms</span></div>
        </div>
      </div>
      <div className="lc-diagram-stage">
        <figure className="lc-waveform">
          <figcaption>Pin 13 over two repeating cycles</figcaption>
          <div className="lc-wave-diagram" role="img" aria-label={`Two cycles, each HIGH for ${onMs} milliseconds then LOW for ${offMs} milliseconds. Period ${period} milliseconds; duty cycle ${duty.toFixed(1)} percent.`}>
            <div className="lc-wave-levels" aria-hidden="true"><span>HIGH</span><span>LOW</span></div>
            <div className="lc-wave-cycles" aria-hidden="true">
              {[0, 1].map(cycle => <div className="lc-wave-cycle" key={cycle}>
                <span className="lc-wave-high" style={{ flexGrow: onMs }} />
                <span className="lc-wave-low" style={{ flexGrow: offMs }} />
              </div>)}
            </div>
          </div>
          <div className="lc-wave-axis" aria-hidden="true"><span>0 ms</span><span>{period.toLocaleString()} ms</span><span>{(period * 2).toLocaleString()} ms</span></div>
        </figure>
        <BoardOutput high={high} />
      </div>
      <dl className="lc-timing-readings">
        <div><dt>Period · one full cycle</dt><dd>{period.toLocaleString()} <span>ms</span><p>{onMs} ms on + {offMs} ms off</p></dd></div>
        <div><dt>Duty cycle · share of time HIGH</dt><dd>{duty.toFixed(1)}<span>%</span><p>{onMs} ÷ {period} × 100</p></dd></div>
      </dl>
      <div className="lc-transport-row">
        <p className="lc-narration" role="status">Preview {playing ? 'playing' : 'paused'} · currently {high ? `HIGH for ${onMs} ms` : `LOW for ${offMs} ms`}. Next transition switches to {high ? 'LOW' : 'HIGH'}.</p>
        <div className="lc-transport-controls">
          <button className="secondary-button" onClick={() => { setPlaying(false); setHigh(true); setOnMs(500); setOffMs(500); }}><ArrowCounterClockwise size={16} aria-hidden="true" />Reset</button>
          <button className="icon-button" onClick={() => { setPlaying(false); setHigh(value => !value); }} aria-label="Next transition" title="Next transition"><CaretRight size={16} aria-hidden="true" /></button>
          <button className="primary-button" onClick={() => setPlaying(value => !value)}>
            {playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}{playing ? 'Pause preview' : 'Play preview'}
          </button>
        </div>
      </div>
      <p className="lc-footnote">Timing uses the browser, not a measurement of running firmware. The model ignores instruction overhead.</p>
    </div>
  );
}

export function LessonContent({ lesson, step, answer, onAnswer }: { lesson: Lesson; step: LessonStep; answer?: string; onAnswer: (answer: string) => void }) {
  const titleId = useId();
  const feedbackId = useId();
  if (step.kind === 'exercise' || step.kind === 'circuit') return null;
  const selection = step.kind === 'predict' ? step.options.find(option => option.id === answer) : undefined;
  const correct = step.kind === 'predict' && selection?.id === step.answerId;

  return (
    <article className={`lc-content lc-content-${step.kind}`} aria-labelledby={titleId}>
      <h2 id={titleId}>{step.title}</h2>
      {step.kind === 'read' && <>
        <div className="lc-prose">{step.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
        <aside className="lc-takeaway"><Lightbulb size={23} aria-hidden="true" /><div><h3>The key idea</h3><p>{step.takeaway}</p></div></aside>
      </>}
      {step.kind === 'explore' && <>
        <div className="lc-prose">{step.paragraphs.slice(0, 1).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
        <div className="lc-model-note"><Info size={19} aria-hidden="true" /><span><strong>Conceptual model</strong> · an interactive explanation, not running firmware.</span></div>
        <p className="lc-instruction">{step.instruction}</p>
        {step.concept === 'execution' && <ExecutionExplainer key={`${lesson.id}/${step.id}`} />}
        {step.concept === 'digital-output' && <DigitalOutputExplainer key={`${lesson.id}/${step.id}`} />}
        {step.concept === 'timing' && <TimingExplainer key={`${lesson.id}/${step.id}`} />}
        {step.concept === 'pull-up-input' && <PullUpInputExplainer key={`${lesson.id}/${step.id}`} />}
        {step.concept === 'edge-event' && <EdgeEventExplainer key={`${lesson.id}/${step.id}`} />}
        {step.concept === 'debounce' && <DebounceExplainer key={`${lesson.id}/${step.id}`} />}
        {step.concept === 'serial-trace' && <SerialTraceExplainer key={`${lesson.id}/${step.id}`} />}
        {step.concept === 'blocking-delay' && <BlockingDelayExplainer key={`${lesson.id}/${step.id}`} />}
        {step.concept === 'millis-timing' && <MillisTimingExplainer key={`${lesson.id}/${step.id}`} />}
        {step.concept === 'state-machine' && <StateMachineExplainer key={`${lesson.id}/${step.id}`} />}
        {step.concept === 'duty-cycle' && <DutyCycleExplainer key={`${lesson.id}/${step.id}`} />}
        {step.concept === 'analog-input' && <AnalogInputExplainer key={`${lesson.id}/${step.id}`} />}
        {step.concept === 'hysteresis' && <HysteresisExplainer key={`${lesson.id}/${step.id}`} />}
        {step.concept === 'interrupt-handler' && <InterruptHandlerExplainer key={`${lesson.id}/${step.id}`} />}
        {step.concept === 'uart-protocol' && <UartProtocolExplainer key={`${lesson.id}/${step.id}`} />}
        {step.concept === 'i2c-transaction' && <I2cTransactionExplainer key={`${lesson.id}/${step.id}`} />}
        {!['execution', 'digital-output', 'timing', 'pull-up-input', 'edge-event', 'debounce', 'serial-trace', 'blocking-delay', 'millis-timing', 'state-machine', 'duty-cycle', 'analog-input', 'hysteresis', 'interrupt-handler', 'uart-protocol', 'i2c-transaction'].includes(step.concept) && <CircuitExplorer key={`${lesson.id}/${step.id}`} concept={step.concept} />}
        {step.paragraphs.length > 1 && <details className="lc-model-details"><summary>About this model</summary><div className="lc-prose">{step.paragraphs.slice(1).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div></details>}
      </>}
      {step.kind === 'predict' && <>
        <fieldset className="lc-prediction" aria-describedby={selection ? feedbackId : undefined}>
          <legend>{step.prompt}</legend>
          <div className="lc-options">{step.options.map((option, index) => {
            const isSelected = answer === option.id;
            const isCorrectOption = option.id === step.answerId;
            const keyClass = !selection ? '' : isCorrectOption ? ' lc-option-key-correct' : isSelected ? ' lc-option-key-wrong' : '';
            return <label key={option.id} className={`lc-option${isSelected ? ' lc-option-selected' : ''}`}>
              <input type="radio" className="sr-only" name={`${lesson.id}/${step.id}`} value={option.id} checked={isSelected} onChange={() => onAnswer(option.id)} />
              <span className={`lc-option-key${keyClass}`} aria-hidden="true">{String.fromCharCode(65 + index)}</span>
              <span>{option.label}</span>
            </label>;
          })}</div>
        </fieldset>
        {selection && <div id={feedbackId} className={`lc-feedback${correct ? ' lc-feedback-correct' : ''}`} role="status">
          {correct ? <CheckCircle size={24} aria-hidden="true" /> : <WarningCircle size={24} aria-hidden="true" />}
          <div><h3>{correct ? 'Correct — you’ve got it.' : 'Not quite — that prediction is incorrect.'}</h3><p>{step.explanation}</p>{!correct && <p className="lc-feedback-retry">You can choose another answer.</p>}</div>
        </div>}
        {!selection && <p className="lc-footnote">Choose an answer to reveal the explanation. It’s okay to make a prediction before you’re sure.</p>}
      </>}
    </article>
  );
}
