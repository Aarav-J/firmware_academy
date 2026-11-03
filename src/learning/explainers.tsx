import { useEffect, useId, useState } from 'react';
import { ArrowClockwise, ArrowCounterClockwise, CaretRight, Pause, Play } from '@phosphor-icons/react';

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
type I2cPhase = typeof I2C_STEPS[number];
const ADDRESS_BYTE = 0xa0; // device 0x50, write bit: (0x50 << 1) | 0
const REGISTER_BYTE = 0x00;
const DATA_BYTE = 0x5a; // the real identification value this device returns

type I2cCell = { phase: I2cPhase; phaseIndex: number; scl: 0 | 1; sda: 0 | 1 };

function byteCells(byte: number, phase: I2cPhase, phaseIndex: number): I2cCell[] {
  const cells: I2cCell[] = [];
  for (let bit = 7; bit >= 0; bit--) {
    const value = (byte >> bit) & 1 ? 1 : 0;
    cells.push({ phase, phaseIndex, scl: 0, sda: value }, { phase, phaseIndex, scl: 1, sda: value });
  }
  return cells;
}

function buildI2cTimeline(): I2cCell[] {
  const cells: I2cCell[] = [];
  const push = (phase: I2cPhase, scl: 0 | 1, sda: 0 | 1) => cells.push({ phase, phaseIndex: I2C_STEPS.indexOf(phase), scl, sda });
  push('start', 1, 1);
  push('start', 1, 0); // SDA falls while SCL is still HIGH — the START condition
  cells.push(...byteCells(ADDRESS_BYTE, 'address', 1));
  push('ack', 0, 0);
  push('ack', 1, 0); // the device pulls SDA LOW for this clock
  cells.push(...byteCells(REGISTER_BYTE, 'register', 3));
  push('ack', 0, 0);
  push('ack', 1, 0);
  push('repeated-start', 1, 1);
  push('repeated-start', 1, 0); // same shape as START, bus never released
  cells.push(...byteCells(DATA_BYTE, 'data', 6));
  push('nack', 0, 1);
  push('nack', 1, 1); // the controller leaves SDA released — "no more bytes"
  push('stop', 1, 0);
  push('stop', 1, 1); // SDA rises while SCL is HIGH — the STOP condition
  return cells;
}
const I2C_TIMELINE = buildI2cTimeline();
const I2C_BYTE_LABEL: Partial<Record<I2cPhase, string>> = { address: `0x${ADDRESS_BYTE.toString(16).toUpperCase()}`, register: `0x${REGISTER_BYTE.toString(16).toUpperCase()}`, data: `0x${DATA_BYTE.toString(16).toUpperCase()}` };

type WaveCell = { level: 0 | 1; step: number };
function WaveRow({ cells, label, activeStep }: { cells: WaveCell[]; label: string; activeStep: number }) {
  let previous: 0 | 1 | undefined;
  return (
    <div className="lc-bus-row">
      <span className="lc-bus-row-label">{label}</span>
      <div className="lc-bus-wave">
        {cells.map((cell, index) => {
          const edge = previous !== undefined && previous !== cell.level;
          previous = cell.level;
          const state = cell.step < activeStep ? 'done' : cell.step === activeStep ? 'current' : 'pending';
          return <span key={index} className={`lc-bus-cell lc-bus-${cell.level ? 'high' : 'low'} lc-bus-${state}${edge ? ' lc-bus-edge' : ''}`} />;
        })}
      </div>
    </div>
  );
}
function i2cRow(cells: I2cCell[], signal: 'scl' | 'sda'): WaveCell[] {
  return cells.map(cell => ({ level: signal === 'scl' ? cell.scl : cell.sda, step: cell.phaseIndex }));
}

export function I2cTransactionExplainer() {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const step = I2C_STEPS[index];
  const descriptions: Record<I2cPhase, string> = {
    start: 'START condition: SDA drops while SCL is HIGH, claiming the bus.',
    address: `The 7-bit device address (0x50) plus a write bit go out on SDA, MSB first: ${I2C_BYTE_LABEL.address}.`,
    ack: 'The addressed device pulls SDA LOW for one clock — acknowledging it is present.',
    register: `The controller sends one byte selecting which register to read: ${I2C_BYTE_LABEL.register}.`,
    'repeated-start': 'A repeated START switches direction without releasing the bus. The address goes out again, this time with the read bit set.',
    data: `The device shifts its register byte back out on SDA: ${I2C_BYTE_LABEL.data}.`,
    nack: 'The controller does not acknowledge — SDA stays released, signaling "that was the last byte."',
    stop: 'STOP condition: SDA rises while SCL is HIGH, releasing the bus.',
  };
  useEffect(() => {
    if (!playing) return;
    if (index >= I2C_STEPS.length - 1) { setPlaying(false); return; }
    const timeout = window.setTimeout(() => setIndex(value => Math.min(value + 1, I2C_STEPS.length - 1)), 1400);
    return () => window.clearTimeout(timeout);
  }, [playing, index]);
  return (
    <div className="lc-explainer">
      <div className="lc-diagram-stage">
        <div className="lc-bus-phases" role="img" aria-label={`Step ${index + 1} of ${I2C_STEPS.length}: ${step}`}>
          {I2C_STEPS.map((name, stepIndex) => <span key={stepIndex} className={`lc-bus-phase${stepIndex === index ? ' lc-bus-phase-current' : ''}${stepIndex < index ? ' lc-bus-phase-done' : ''}`}>{name}</span>)}
        </div>
        <div className="lc-bus-waveform">
          <WaveRow cells={i2cRow(I2C_TIMELINE, 'scl')} label="SCL" activeStep={index} />
          <WaveRow cells={i2cRow(I2C_TIMELINE, 'sda')} label="SDA" activeStep={index} />
        </div>
        <p className="lc-narration" role="status">{descriptions[step]}</p>
      </div>
      <div className="lc-transport-row">
        <p className="lc-narration">Step {index + 1} of {I2C_STEPS.length}</p>
        <div className="lc-transport-controls">
          <button className="secondary-button" onClick={() => { setPlaying(false); setIndex(0); }}><ArrowCounterClockwise size={16} aria-hidden="true" />Reset</button>
          <button className="icon-button" aria-label="Next step" disabled={index >= I2C_STEPS.length - 1} onClick={() => { setPlaying(false); setIndex(value => Math.min(value + 1, I2C_STEPS.length - 1)); }}><CaretRight size={16} aria-hidden="true" /></button>
          <button className="primary-button" onClick={() => setPlaying(value => !value)}>{playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}{playing ? 'Pause' : index >= I2C_STEPS.length - 1 ? 'Replay' : 'Play'}</button>
        </div>
      </div>
      <p className="lc-footnote">A wrong address gets a NACK at the address-ack step instead — the device never responds further. I2C sends the most-significant bit first, the opposite of UART.</p>
    </div>
  );
}

// --- Talk to another device: spi-transfer -----------------------------------------
const SPI_STEPS = ['select', 'command', 'reply', 'deselect'] as const;
type SpiPhase = typeof SPI_STEPS[number];
/** Matches avr-engine.ts's SimulatedSpiSensor exactly: read flag + register 0x00, then a dummy byte clocks the real reply out. */
const SPI_COMMAND_BYTE = 0x80;
const SPI_REPLY_BYTE = 0x71;

type SpiCell = { phase: SpiPhase; phaseIndex: number; cs: 0 | 1; sck: 0 | 1; mosi: 0 | 1; miso: 0 | 1 };

function buildSpiTimeline(): SpiCell[] {
  const cells: SpiCell[] = [];
  const push = (phase: SpiPhase, cs: 0 | 1, sck: 0 | 1, mosi: 0 | 1, miso: 0 | 1) => cells.push({ phase, phaseIndex: SPI_STEPS.indexOf(phase), cs, sck, mosi, miso });
  push('select', 1, 0, 0, 1);
  push('select', 0, 0, 0, 1); // CS falls — the device is now selected
  for (let bit = 7; bit >= 0; bit--) {
    const mosiBit = (SPI_COMMAND_BYTE >> bit) & 1 ? 1 : 0;
    push('command', 0, 0, mosiBit, 1); // MISO still floats HIGH — the device has not decoded the command yet
    push('command', 0, 1, mosiBit, 1);
  }
  for (let bit = 7; bit >= 0; bit--) {
    const misoBit = (SPI_REPLY_BYTE >> bit) & 1 ? 1 : 0;
    push('reply', 0, 0, 0, misoBit); // MOSI carries a dummy 0x00 — only the clock matters now
    push('reply', 0, 1, 0, misoBit);
  }
  push('deselect', 0, 0, 0, 1);
  push('deselect', 1, 0, 0, 1); // CS rises — released
  return cells;
}
const SPI_TIMELINE = buildSpiTimeline();
function spiRow(cells: SpiCell[], signal: 'cs' | 'sck' | 'mosi' | 'miso'): WaveCell[] {
  return cells.map(cell => ({ level: cell[signal], step: cell.phaseIndex }));
}

export function SpiTransferExplainer() {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const step = SPI_STEPS[index];
  const descriptions: Record<SpiPhase, string> = {
    select: 'The controller pulls CS LOW, selecting this device. Every other chip sharing the bus ignores the clock.',
    command: `The controller shifts out a command byte, MSB first: the read flag plus register 0x00 — 0x${SPI_COMMAND_BYTE.toString(16).toUpperCase()}. MISO stays released HIGH; the device has not decoded the command yet.`,
    reply: `The controller clocks out a dummy byte just to drive SCK. The device shifts its real answer back on MISO at the same time: 0x${SPI_REPLY_BYTE.toString(16).toUpperCase()}.`,
    deselect: 'CS returns HIGH, releasing the device. A different chip on the bus could be selected next.',
  };
  useEffect(() => {
    if (!playing) return;
    if (index >= SPI_STEPS.length - 1) { setPlaying(false); return; }
    const timeout = window.setTimeout(() => setIndex(value => Math.min(value + 1, SPI_STEPS.length - 1)), 1400);
    return () => window.clearTimeout(timeout);
  }, [playing, index]);
  return (
    <div className="lc-explainer">
      <div className="lc-diagram-stage">
        <div className="lc-bus-phases" role="img" aria-label={`Step ${index + 1} of ${SPI_STEPS.length}: ${step}`}>
          {SPI_STEPS.map((name, stepIndex) => <span key={stepIndex} className={`lc-bus-phase${stepIndex === index ? ' lc-bus-phase-current' : ''}${stepIndex < index ? ' lc-bus-phase-done' : ''}`}>{name}</span>)}
        </div>
        <div className="lc-bus-waveform">
          <WaveRow cells={spiRow(SPI_TIMELINE, 'cs')} label="CS" activeStep={index} />
          <WaveRow cells={spiRow(SPI_TIMELINE, 'sck')} label="SCK" activeStep={index} />
          <WaveRow cells={spiRow(SPI_TIMELINE, 'mosi')} label="MOSI" activeStep={index} />
          <WaveRow cells={spiRow(SPI_TIMELINE, 'miso')} label="MISO" activeStep={index} />
        </div>
        <p className="lc-narration" role="status">{descriptions[step]}</p>
      </div>
      <div className="lc-transport-row">
        <p className="lc-narration">Step {index + 1} of {SPI_STEPS.length}</p>
        <div className="lc-transport-controls">
          <button className="secondary-button" onClick={() => { setPlaying(false); setIndex(0); }}><ArrowCounterClockwise size={16} aria-hidden="true" />Reset</button>
          <button className="icon-button" aria-label="Next step" disabled={index >= SPI_STEPS.length - 1} onClick={() => { setPlaying(false); setIndex(value => Math.min(value + 1, SPI_STEPS.length - 1)); }}><CaretRight size={16} aria-hidden="true" /></button>
          <button className="primary-button" onClick={() => setPlaying(value => !value)}>{playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}{playing ? 'Pause' : index >= SPI_STEPS.length - 1 ? 'Replay' : 'Play'}</button>
        </div>
      </div>
      <p className="lc-footnote">MOSI and MISO move at the same time, in both directions, on every clock edge — the defining trait that separates SPI from I2C and UART. CS is a plain GPIO pin; the hardware has no idea which chip you mean until you drive it yourself.</p>
    </div>
  );
}

// --- Store data across resets: eeprom-persistence -----------------------------------------
export function EepromPersistenceExplainer() {
  const [written, setWritten] = useState<number | null>(null); // EEPROM content; null = erased (0xFF)
  const [sram, setSram] = useState<number | null>(null); // SRAM content; null = zeroed by reset
  const [resets, setResets] = useState(0);
  function writeValue() {
    const next = 10 + Math.floor(Math.random() * 90);
    setWritten(next);
    setSram(next);
  }
  function simulateReset() {
    setSram(null);
    setResets(value => value + 1);
  }
  const message = written === null
    ? 'Nothing written yet. Write a value, then simulate a reset.'
    : sram === null
      ? `Reset #${resets}: SRAM came back zeroed, but EEPROM still holds ${written} — exactly how a real chip reset behaves.`
      : `SRAM and EEPROM both hold ${written} right now. Simulate a reset to see them diverge.`;
  return (
    <div className="lc-explainer">
      <div className="lc-diagram-stage">
        <div className="lc-edge-pair">
          <div><span>SRAM (volatile)</span><strong>{sram === null ? '0' : sram}</strong></div>
          <div><span>EEPROM (persistent)</span><strong>{written === null ? '0xFF' : written}</strong></div>
        </div>
        <p className="lc-narration" role="status">{message}</p>
      </div>
      <div className="lc-transport-row">
        <p className="lc-narration">Resets simulated: {resets}</p>
        <div className="lc-transport-controls">
          <button className="secondary-button" onClick={writeValue}>Write a value</button>
          <button className="primary-button" onClick={simulateReset} disabled={written === null}><ArrowClockwise size={16} aria-hidden="true" />Simulate reset</button>
        </div>
      </div>
      <p className="lc-footnote">This is a simplified two-bank model, not wired to the real engine. The actual exercise writes to a real simulated EEPROM peripheral — pressing the workbench's own Reset button there genuinely leaves its content untouched.</p>
    </div>
  );
}
