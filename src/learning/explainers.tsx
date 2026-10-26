import { useEffect, useId, useState } from 'react';
import { ArrowCounterClockwise, CaretRight } from '@phosphor-icons/react';

function Led({ on, label }: { on: boolean; label: string }) {
  return <div className="lc-led-output"><span className={`lc-led${on ? ' lc-led-on' : ''}`} aria-hidden="true" /><span>{label}: <strong>{on ? 'ON' : 'OFF'}</strong></span></div>;
}

// --- Read inputs: pull-up-input --------------------------------------------
export function PullUpInputExplainer() {
  const [pressed, setPressed] = useState(false);
  const [pulledUp, setPulledUp] = useState(true);
  const level = pulledUp ? (pressed ? 'LOW' : 'HIGH') : 'undefined';
  return (
    <div className="lc-explainer">
      <div className="lc-diagram-stage">
        <div className="lc-pin-level"><span>D2 reads</span><strong className={level === 'undefined' ? 'lc-pin-undefined' : ''}>{level}</strong></div>
        <p className="lc-narration" role="status">
          {!pulledUp ? 'With no pull-up and nothing driving the pin, a real input floats: it can read HIGH or LOW unpredictably, even from tiny amounts of electrical noise.'
            : pressed ? 'Pressed: the button connects the pin directly to GND, overpowering the weak internal pull-up. The pin reads LOW.'
              : 'Released: the internal pull-up resistor weakly pulls the pin toward 5V. The pin reads HIGH.'}
        </p>
      </div>
      <div className="lc-transport-row">
        <div className="lc-transport-controls">
          <button className="secondary-button" aria-pressed={pulledUp} onClick={() => setPulledUp(true)}>Use INPUT_PULLUP</button>
          <button className="secondary-button" aria-pressed={!pulledUp} onClick={() => setPulledUp(false)}>Use plain INPUT (floating)</button>
        </div>
        <div className="lc-transport-controls">
          <button className="primary-button" disabled={!pulledUp} onClick={() => setPressed(value => !value)}>{pressed ? 'Release button' : 'Press button'}</button>
        </div>
      </div>
      <p className="lc-footnote">A real floating input is not simulated here as truly random; this model simply marks the result as undefined to make the risk visible.</p>
    </div>
  );
}

// --- Read inputs: edge-event -------------------------------------------------
const EDGE_SEQUENCE = [1, 1, 0, 0, 0, 1, 1, 0, 1, 1] as const;
export function EdgeEventExplainer() {
  const [index, setIndex] = useState(0);
  const current = EDGE_SEQUENCE[index];
  const previous = index > 0 ? EDGE_SEQUENCE[index - 1] : 1;
  const isNewPress = previous === 1 && current === 0;
  return (
    <div className="lc-explainer">
      <div className="lc-diagram-stage">
        <div className="lc-edge-pair">
          <div><span>previous reading</span><strong>{previous ? 'HIGH' : 'LOW'}</strong></div>
          <div><span>current reading</span><strong>{current ? 'HIGH' : 'LOW'}</strong></div>
        </div>
        <p className="lc-narration" role="status">{isNewPress ? 'This step is a new press: the reading just changed from HIGH to LOW.' : current === 0 ? 'Still pressed: the reading is LOW, same as the previous step — not a new event.' : 'Released or idle: the reading is HIGH.'}</p>
      </div>
      <div className="lc-transport-row">
        <p className="lc-narration">Step {index + 1} of {EDGE_SEQUENCE.length}</p>
        <div className="lc-transport-controls">
          <button className="secondary-button" onClick={() => setIndex(0)}><ArrowCounterClockwise size={16} aria-hidden="true" />Reset</button>
          <button className="icon-button" aria-label="Next reading" disabled={index >= EDGE_SEQUENCE.length - 1} onClick={() => setIndex(value => Math.min(value + 1, EDGE_SEQUENCE.length - 1))}><CaretRight size={16} aria-hidden="true" /></button>
        </div>
      </div>
      <p className="lc-footnote">Counting every LOW reading would count one press as many events. Only the HIGH-to-LOW transition is the event.</p>
    </div>
  );
}

// --- Read inputs: debounce --------------------------------------------------
const BOUNCE_TRACE = [0, 400, 480, 520, 610, 690, 4200, 4260, 4340, 4420] as const; // ms offsets of raw LOW edges within one physical press
export function DebounceExplainer() {
  const [windowMs, setWindowMs] = useState(50);
  const id = useId();
  const accepted: number[] = [];
  let last = -Infinity;
  for (const edgeMs of BOUNCE_TRACE) { if (edgeMs - last >= windowMs) accepted.push(edgeMs); last = edgeMs; }
  return (
    <div className="lc-explainer">
      <div className="lc-diagram-stage">
        <svg viewBox="0 0 480 70" className="lc-bounce-trace" role="img" aria-label={`Raw switch edges at ${BOUNCE_TRACE.join(', ')} ms; ${accepted.length} accepted as real presses with a ${windowMs} ms window`}>
          <line x1="0" y1="55" x2="480" y2="55" className="lc-bounce-axis" />
          {BOUNCE_TRACE.map(ms => <line key={ms} x1={ms / 10} y1="10" x2={ms / 10} y2="55" className={accepted.includes(ms) ? 'lc-bounce-edge lc-bounce-accepted' : 'lc-bounce-edge'} />)}
        </svg>
        <p className="lc-narration" role="status">Two physical presses produced {BOUNCE_TRACE.length} raw edges. A {windowMs} ms ignore-window after each accepted edge keeps <strong>{accepted.length}</strong> of them.</p>
      </div>
      <div className="lc-range-control">
        <label htmlFor={id}>Debounce window <output htmlFor={id}>{windowMs} ms</output></label>
        <input id={id} type="range" min="5" max="200" step="5" value={windowMs} onChange={event => setWindowMs(Number(event.target.value))} aria-valuetext={`${windowMs} milliseconds`} />
      </div>
      <p className="lc-footnote">Too short a window still counts bounce as separate presses. Too long a window can merge two real, fast presses into one.</p>
    </div>
  );
}

// --- Observe and debug: serial-trace -----------------------------------------
const LOG_EVENTS = ['Press 1 (debounced)', 'Press 2 (debounced)', 'Press 3 (debounced)'] as const;
export function SerialTraceExplainer() {
  const [logged, setLogged] = useState(0);
  return (
    <div className="lc-explainer">
      <div className="lc-diagram-stage lc-serial-compare">
        <div><h4>Without a log</h4><p className="lc-narration">Three presses happened. Did your code see all of them? There is no way to tell from the board alone.</p></div>
        <div><h4>With Serial.println()</h4><pre className="lc-serial-log" aria-label="Simulated serial monitor output">{LOG_EVENTS.slice(0, logged).join('\n') || '(nothing printed yet)'}</pre></div>
      </div>
      <div className="lc-transport-row">
        <p className="lc-narration" role="status">{logged === 0 ? 'Press the button to generate an event.' : logged < LOG_EVENTS.length ? `${logged} of ${LOG_EVENTS.length} presses logged.` : 'All presses are now visible as evidence, not guesses.'}</p>
        <div className="lc-transport-controls">
          <button className="secondary-button" onClick={() => setLogged(0)}><ArrowCounterClockwise size={16} aria-hidden="true" />Reset</button>
          <button className="primary-button" disabled={logged >= LOG_EVENTS.length} onClick={() => setLogged(value => value + 1)}>Press button</button>
        </div>
      </div>
      <p className="lc-footnote">A real exercise checks the actual Serial output your compiled sketch produced, not this preview.</p>
    </div>
  );
}

// --- Make it responsive: blocking-delay --------------------------------------
export function BlockingDelayExplainer() {
  const [pressAtMs, setPressAtMs] = useState(400);
  const id = useId();
  const blockedUntilMs = 1000; // a single delay(1000) call
  const missed = pressAtMs < blockedUntilMs;
  return (
    <div className="lc-explainer">
      <div className="lc-diagram-stage">
        <div className="lc-blocking-timeline" role="img" aria-label={`A press at ${pressAtMs} ms, while delay() blocks from 0 to ${blockedUntilMs} ms`}>
          <div className="lc-blocking-window" style={{ width: `${blockedUntilMs / 10}%` }}><span>delay(1000) — not checking the button</span></div>
          <div className="lc-press-marker" style={{ left: `${pressAtMs / 10}%` }} aria-hidden="true" />
        </div>
        <p className="lc-narration" role="status">{missed ? 'This press happened while the program was inside delay(). It is not noticed until delay() finally returns.' : 'This press happened after delay() returned, so the next loop() check catches it almost immediately.'}</p>
      </div>
      <div className="lc-range-control">
        <label htmlFor={id}>Press time <output htmlFor={id}>{pressAtMs} ms</output></label>
        <input id={id} type="range" min="0" max="1200" step="10" value={pressAtMs} onChange={event => setPressAtMs(Number(event.target.value))} aria-valuetext={`${pressAtMs} milliseconds`} />
      </div>
      <p className="lc-footnote">The button itself still changes state instantly — delay() blocks the program from checking it, not the hardware from reacting.</p>
    </div>
  );
}

// --- Make it responsive: millis-timing ----------------------------------------
export function MillisTimingExplainer() {
  const [nowMs, setNowMs] = useState(0);
  const [previousMs, setPreviousMs] = useState(0);
  const interval = 1000;
  const elapsed = nowMs - previousMs;
  const due = elapsed >= interval;
  return (
    <div className="lc-explainer">
      <div className="lc-diagram-stage">
        <dl className="lc-timing-readings">
          <div><dt>currentMillis</dt><dd>{nowMs}<span>ms</span></dd></div>
          <div><dt>previousMillis</dt><dd>{previousMs}<span>ms</span></dd></div>
          <div><dt>elapsed</dt><dd>{elapsed}<span>ms</span><p>currentMillis − previousMillis</p></dd></div>
        </dl>
        <p className="lc-narration" role="status">{due ? 'elapsed ≥ 1000 ms: this check fires, and previousMillis resets to the current time for the next interval.' : 'elapsed < 1000 ms: this check does nothing yet. The rest of loop() — including button reads — still runs immediately.'}</p>
      </div>
      <div className="lc-transport-row">
        <div className="lc-transport-controls">
          <button className="secondary-button" onClick={() => { setNowMs(0); setPreviousMs(0); }}><ArrowCounterClockwise size={16} aria-hidden="true" />Reset</button>
          <button className="icon-button" aria-label="Advance 100 ms" onClick={() => setNowMs(value => value + 100)}><CaretRight size={16} aria-hidden="true" /></button>
          <button className="primary-button" disabled={!due} onClick={() => setPreviousMs(nowMs)}>Run the timed action</button>
        </div>
      </div>
      <p className="lc-footnote">Every loop() iteration checks elapsed time and keeps going — nothing blocks the next button read while waiting.</p>
    </div>
  );
}

// --- Make it responsive: state-machine -----------------------------------------
type ControllerState = 'idle' | 'active' | 'cooldown';
export function StateMachineExplainer() {
  const [state, setState] = useState<ControllerState>('idle');
  function press() { if (state === 'idle') { setState('active'); setTimeout(() => setState('cooldown'), 0); } }
  return (
    <div className="lc-explainer">
      <div className="lc-diagram-stage">
        <div className="lc-state-diagram" role="img" aria-label={`Current state: ${state}`}>
          {(['idle', 'active', 'cooldown'] as const).map(name => <div key={name} className={`lc-state-node${state === name ? ' lc-state-current' : ''}`}>{name}</div>)}
        </div>
        <p className="lc-narration" role="status">
          {state === 'idle' && 'Idle: waiting for a press. A press moves to Active.'}
          {state === 'active' && 'Active: the output is on for its fixed duration. A press here is ignored — the device is already responding.'}
          {state === 'cooldown' && 'Cooldown: finishing up, then returns to Idle automatically.'}
        </p>
      </div>
      <div className="lc-transport-row">
        <div className="lc-transport-controls">
          <button className="secondary-button" onClick={() => setState('idle')}><ArrowCounterClockwise size={16} aria-hidden="true" />Reset</button>
          <button className="primary-button" onClick={press}>Press (try it anytime)</button>
          <button className="secondary-button" disabled={state !== 'cooldown'} onClick={() => setState('idle')}>Finish cooldown</button>
        </div>
      </div>
      <p className="lc-footnote">Naming states explicitly makes "ignore this press, we're busy" a deliberate rule instead of an accident.</p>
    </div>
  );
}

// --- Control outputs with PWM: duty-cycle ---------------------------------------
export function DutyCycleExplainer() {
  const [duty, setDuty] = useState(50);
  const id = useId();
  return (
    <div className="lc-explainer">
      <div className="lc-diagram-stage">
        <svg viewBox="0 0 300 50" className="lc-pwm-wave" role="img" aria-label={`A fast square wave at ${duty}% duty cycle`}>
          {[0, 1, 2, 3].map(cycle => <rect key={cycle} x={cycle * 75} y="8" width={75 * duty / 100} height="12" className="lc-pwm-high" />)}
          <line x1="0" y1="34" x2="300" y2="34" className="lc-pwm-axis" />
        </svg>
        <div className="lc-pwm-brightness"><span>Apparent brightness</span><div className="lc-pwm-brightness-track"><div style={{ width: `${duty}%` }} /></div></div>
      </div>
      <div className="lc-range-control">
        <label htmlFor={id}>Duty cycle <output htmlFor={id}>{duty}%</output></label>
        <input id={id} type="range" min="0" max="100" step="1" value={duty} onChange={event => setDuty(Number(event.target.value))} aria-valuetext={`${duty} percent`} />
      </div>
      <p className="lc-footnote">The pin is only ever fully HIGH or fully LOW. Switching fast enough makes the share of time HIGH read as brightness, not a true analog voltage.</p>
    </div>
  );
}

// --- Read analog signals: analog-input -------------------------------------------
export function AnalogInputExplainer() {
  const [voltage, setVoltage] = useState(2.5);
  const id = useId();
  const raw = Math.round(voltage / 5 * 1023);
  return (
    <div className="lc-explainer">
      <div className="lc-diagram-stage">
        <dl className="lc-timing-readings">
          <div><dt>Input voltage</dt><dd>{voltage.toFixed(2)}<span>V</span></dd></div>
          <div><dt>Raw ADC count</dt><dd>{raw}<span>/ 1023</span><p>round(voltage ÷ 5 × 1023)</p></dd></div>
        </dl>
      </div>
      <div className="lc-range-control">
        <label htmlFor={id}>Input voltage <output htmlFor={id}>{voltage.toFixed(2)} V</output></label>
        <input id={id} type="range" min="0" max="5" step="0.01" value={voltage} onChange={event => setVoltage(Number(event.target.value))} aria-valuetext={`${voltage.toFixed(2)} volts`} />
      </div>
      <p className="lc-footnote">The Uno's ADC has 1024 possible counts over its 0–5 V range — about 4.9 mV per count. Two nearby voltages can round to the same count.</p>
    </div>
  );
}

// --- Read analog signals: hysteresis ----------------------------------------------
export function HysteresisExplainer() {
  const [voltage, setVoltage] = useState(2.5);
  const [withHysteresis, setWithHysteresis] = useState(true);
  const [indicatorOn, setIndicatorOn] = useState(false);
  const id = useId();
  const highThreshold = 2.7, lowThreshold = 2.3, single = 2.5;
  useEffect(() => {
    if (withHysteresis) setIndicatorOn(current => voltage >= highThreshold ? true : voltage <= lowThreshold ? false : current);
    else setIndicatorOn(voltage >= single);
  }, [voltage, withHysteresis]);
  return (
    <div className="lc-explainer">
      <div className="lc-diagram-stage">
        <Led on={indicatorOn} label="Indicator" />
        <p className="lc-narration" role="status">{withHysteresis ? `Turns ON at ${highThreshold} V, turns OFF at ${lowThreshold} V — a noisy reading near the middle does not flip it back and forth.` : `Turns ON above ${single} V, OFF below it. A noisy reading hovering right at ${single} V would chatter on and off rapidly.`}</p>
      </div>
      <div className="lc-range-control">
        <label htmlFor={id}>Input voltage <output htmlFor={id}>{voltage.toFixed(2)} V</output></label>
        <input id={id} type="range" min="0" max="5" step="0.01" value={voltage} onChange={event => setVoltage(Number(event.target.value))} aria-valuetext={`${voltage.toFixed(2)} volts`} />
      </div>
      <div className="lc-transport-controls">
        <button className="secondary-button" aria-pressed={withHysteresis} onClick={() => setWithHysteresis(true)}>With hysteresis</button>
        <button className="secondary-button" aria-pressed={!withHysteresis} onClick={() => setWithHysteresis(false)}>Single threshold</button>
      </div>
      <p className="lc-footnote">Try holding the slider near the middle in each mode to feel the difference.</p>
    </div>
  );
}

// --- Handle asynchronous events: interrupt-handler --------------------------------
export function InterruptHandlerExplainer() {
  const [stage, setStage] = useState<'running' | 'paused' | 'handling' | 'resumed'>('running');
  return (
    <div className="lc-explainer">
      <div className="lc-diagram-stage">
        <div className="lc-state-diagram" role="img" aria-label={`Stage: ${stage}`}>
          <div className={`lc-state-node${stage === 'running' || stage === 'resumed' ? ' lc-state-current' : ''}`}>loop()</div>
          <div className={`lc-state-node${stage === 'paused' || stage === 'handling' ? ' lc-state-current' : ''}`}>ISR</div>
        </div>
        <p className="lc-narration" role="status">
          {stage === 'running' && 'loop() is executing normally. An edge can arrive on any instruction.'}
          {stage === 'paused' && 'An edge just arrived. The current instruction finishes, then execution pauses here.'}
          {stage === 'handling' && 'The interrupt handler runs — ideally just recording that the event happened.'}
          {stage === 'resumed' && 'The handler returned. loop() resumes exactly where it was paused, as if nothing happened.'}
        </p>
      </div>
      <div className="lc-transport-row">
        <div className="lc-transport-controls">
          <button className="secondary-button" onClick={() => setStage('running')}><ArrowCounterClockwise size={16} aria-hidden="true" />Reset</button>
          <button className="icon-button" aria-label="Step" onClick={() => setStage(current => current === 'running' ? 'paused' : current === 'paused' ? 'handling' : current === 'handling' ? 'resumed' : 'running')}><CaretRight size={16} aria-hidden="true" /></button>
        </div>
      </div>
      <p className="lc-footnote">A long handler delays everything loop() would otherwise be doing — including other interrupts.</p>
    </div>
  );
}

// --- Talk to another device: uart-protocol -----------------------------------------
export function UartProtocolExplainer() {
  const bits = [0, 1, 0, 0, 0, 0, 0, 1]; // 'A' = 0x41, LSB first after the start bit
  const [index, setIndex] = useState(-1);
  const frame = ['start', ...bits.map((_, bitIndex) => `bit${bitIndex}`), 'stop'];
  const current = index >= 0 ? frame[index] : null;
  return (
    <div className="lc-explainer">
      <div className="lc-diagram-stage">
        <div className="lc-uart-frame" role="img" aria-label={`UART frame for the byte 0x41, currently at ${current ?? 'idle'}`}>
          <div className={`lc-uart-bit lc-uart-start${current === 'start' ? ' lc-uart-current' : ''}`}>start</div>
          {bits.map((bit, bitIndex) => <div key={bitIndex} className={`lc-uart-bit${bit ? ' lc-uart-high' : ''}${current === `bit${bitIndex}` ? ' lc-uart-current' : ''}`}>{bit}</div>)}
          <div className={`lc-uart-bit lc-uart-stop${current === 'stop' ? ' lc-uart-current' : ''}`}>stop</div>
        </div>
        <p className="lc-narration" role="status">{index < 0 ? 'The line idles HIGH until a byte is sent.' : current === 'start' ? 'Start bit: the line drops LOW, telling the receiver a byte is coming.' : current === 'stop' ? 'Stop bit: the line returns HIGH, framing the byte as complete.' : `Data bit ${index - 1}, sent least-significant-bit first.`}</p>
      </div>
      <div className="lc-transport-row">
        <div className="lc-transport-controls">
          <button className="secondary-button" onClick={() => setIndex(-1)}><ArrowCounterClockwise size={16} aria-hidden="true" />Reset</button>
          <button className="icon-button" aria-label="Next bit" disabled={index >= frame.length - 1} onClick={() => setIndex(value => Math.min(value + 1, frame.length - 1))}><CaretRight size={16} aria-hidden="true" /></button>
        </div>
      </div>
      <p className="lc-footnote">Both sides must agree on the baud rate in advance — there is no separate clock line to synchronize bit timing.</p>
    </div>
  );
}

// --- Talk to another device: i2c-transaction -----------------------------------------
const I2C_STEPS = ['start', 'address', 'ack', 'register', 'ack', 'repeated-start', 'data', 'nack', 'stop'] as const;
export function I2cTransactionExplainer() {
  const [index, setIndex] = useState(0);
  const step = I2C_STEPS[index];
  const descriptions: Record<typeof I2C_STEPS[number], string> = {
    start: 'START condition: SDA drops while SCL is HIGH, claiming the bus.',
    address: 'The 7-bit device address plus a read/write bit go out on SDA.',
    ack: 'The addressed device pulls SDA LOW for one clock — acknowledging it is present.',
    register: 'The controller sends one byte selecting which register to read.',
    'repeated-start': 'A repeated START switches direction without releasing the bus.',
    data: 'The device sends the requested register byte back.',
    nack: 'The controller does not acknowledge — signaling "that was the last byte."',
    stop: 'STOP condition: SDA rises while SCL is HIGH, releasing the bus.',
  };
  return (
    <div className="lc-explainer">
      <div className="lc-diagram-stage">
        <div className="lc-i2c-steps" role="img" aria-label={`Step ${index + 1} of ${I2C_STEPS.length}: ${step}`}>
          {I2C_STEPS.map((name, stepIndex) => <span key={stepIndex} className={`lc-i2c-step${stepIndex === index ? ' lc-i2c-current' : ''}${stepIndex < index ? ' lc-i2c-done' : ''}`}>{name}</span>)}
        </div>
        <p className="lc-narration" role="status">{descriptions[step]}</p>
      </div>
      <div className="lc-transport-row">
        <p className="lc-narration">Step {index + 1} of {I2C_STEPS.length}</p>
        <div className="lc-transport-controls">
          <button className="secondary-button" onClick={() => setIndex(0)}><ArrowCounterClockwise size={16} aria-hidden="true" />Reset</button>
          <button className="icon-button" aria-label="Next step" disabled={index >= I2C_STEPS.length - 1} onClick={() => setIndex(value => Math.min(value + 1, I2C_STEPS.length - 1))}><CaretRight size={16} aria-hidden="true" /></button>
        </div>
      </div>
      <p className="lc-footnote">A wrong address gets a NACK at the address-ack step instead — the device never responds further.</p>
    </div>
  );
}
