import { useState } from 'react';
import type { ReactNode } from 'react';
import './landing.css';

const UNIT_COUNT = 11;
const LESSON_COUNT = 28;

const LOOP_STEPS: { tag: string; title: string; body: string; code: ReactNode }[] = [
  {
    tag: 'A first-lesson example',
    title: 'A write changes state.',
    body: 'digitalWrite() does not flash a pin for the duration of a function call. The output retains its state. That one idea is the difference between memorizing code and understanding it.',
    code: <>void setup() {'{'}<br />&nbsp;&nbsp;pinMode(LED_BUILTIN, OUTPUT);<br />&nbsp;&nbsp;<span className="lp-green">digitalWrite(LED_BUILTIN, HIGH);</span><br />{'}'}<br /><br />void loop() {'{'} <span className="lp-orange">/* The LED stays on. */</span> {'}'}</>,
  },
  {
    tag: 'Explore the model',
    title: 'Trace the execution.',
    body: 'The course uses guided models to unpack ideas before you write code: setup runs once, loop repeats. These concept models explain behavior; the build exercise runs the compiled sketch.',
    code: <>RESET<br />&nbsp;&nbsp;↓<br /><span className="lp-green">setup() → once</span><br />&nbsp;&nbsp;↓<br /><span className="lp-orange">loop() → again → again → again</span></>,
  },
  {
    tag: 'Predict before you check',
    title: 'Commit to an answer.',
    body: 'What happens after an empty loop finishes? The framework calls loop again, not setup. Prediction checks give you a chance to catch a mistaken mental model before building on it.',
    code: <>setup() finishes.<br />loop() has no statements.<br /><br /><span className="lp-green">What happens next?</span><br />A. setup() again<br />B. loop() again ←<br />C. the board stops</>,
  },
  {
    tag: 'Build and check',
    title: 'Make the behavior match.',
    body: 'Build the sketch, then compare the observed output with the goal. Compiling successfully and behaving correctly are different checks. The first exercise asks for a steady HIGH on D13 for at least one simulated second.',
    code: <>✓ Build the sketch<br /><span className="lp-green">→ Goal: hold D13 HIGH</span><br />→ Observe at least 1 simulated second<br /><br /><span className="lp-orange">Example goals, not live results.</span></>,
  },
];

const ROADMAP = [
  { title: 'Meet the board', body: 'setup(), loop(), a steady LED, and your first timing pattern.' },
  { title: 'Connect a circuit', body: 'Current paths, LED orientation, resistors, and an external output.' },
  { title: 'Read inputs', body: 'Pull-ups, active-low buttons, and dependable button decisions.' },
  { title: 'Observe and debug', body: 'Use serial output and observation to understand your program.' },
  { title: 'Make it responsive', body: 'Replace blocking waits with elapsed time and explicit states.' },
  { title: 'Read analog signals', body: 'Scale readings and build an alert with hysteresis.' },
  { title: 'Control outputs with PWM', body: 'Duty cycle, brightness, and mapping an input to an output.' },
  { title: 'Handle asynchronous events', body: 'Polling, interrupts, and why handlers should stay short.' },
  { title: 'Talk to another device', body: 'Communicate through the I2C interface.' },
  { title: 'Store data across resets', body: 'Keep values in EEPROM instead of losing them on reset.' },
  { title: 'Final project', body: 'Combine sampling, reporting, alerts, and a responsive button.' },
];

const INSTRUMENTS = [
  { tag: '01 / Logic analyzer', title: 'See when a pin changes.', body: 'Trace digital transitions instead of guessing from the source.' },
  { tag: '02 / Serial monitor', title: "Read the device's output.", body: 'Inspect UART output produced by the running firmware.' },
  { tag: '03 / Register inspector', title: 'Look beneath the API.', body: 'Inspect supported register state and see what the code touched.' },
  { tag: '04 / Virtual breadboard', title: 'Connect the idea.', body: 'Explore parts, pins, wiring, and the return path that completes a circuit.' },
];

const FAQ = [
  {
    q: 'What should I already know?',
    a: 'Basic C: variables, functions, control flow. Arduino sketches compile as C++, but the starting lessons do not need classes. The course introduces electronics and embedded ideas from the first output pin.',
    open: true,
  },
  {
    q: 'Do I need to buy a board?',
    a: 'No physical board is required for the simulated lessons. This is a learning environment with modeled hardware, not a replacement for every electrical behavior of a physical circuit.',
  },
  {
    q: 'Can I use it in the browser immediately?',
    a: 'Yes — the course and projects above run in this browser tab, no install step once the project is running. If you are standing the project up yourself rather than visiting a hosted copy, you still need Node 22+ and the compiler/emulator setup for your target board.',
  },
  {
    q: 'Are all three courses ready?',
    a: 'The Arduino course is the one available today. Bare-metal STM32 and Zephyr course cards are marked coming soon. Projects already support Pico and STM32 environments; a supported project environment does not mean a full course is ready for it.',
  },
];

const TRACE_COLORS = ['#f0532b', '#9b5de5', '#f5b82e', '#3cc47c', '#4a7cf7'];
const TRACE_POINTS = [
  '0,24 116,24 351,24 365,40 525,40 539,24 654,24 668,40 796,40 810,24 1027,24 1041,40 1254,40 1268,24 1391,24 1405,40 1572,40 1586,24',
  '0,74 5,74 253,74 267,58 407,58 421,74 601,74 615,58 828,58 842,74 984,74 998,58 1242,58 1256,74 1392,74 1406,58 1658,58 1672,74',
  '0,92 79,92 237,92 251,108 484,108 498,92 778,92 792,108 1034,108 1048,92 1263,92 1277,108 1463,108 1477,92',
  '0,142 67,142 299,142 313,126 506,126 520,142 740,142 754,126 933,126 947,142 1208,142 1222,126 1346,126 1360,142 1496,142 1510,126',
  '0,160 97,160 345,160 359,176 611,176 625,160 811,160 825,176 1018,176 1032,160 1315,160 1329,176 1524,176 1538,160',
];
const TRACE_DOTS: [number, number, string][] = [
  [532, 24, '#f0532b'], [1034, 40, '#f0532b'], [1579, 24, '#f0532b'],
  [414, 74, '#9b5de5'], [991, 58, '#9b5de5'], [1665, 74, '#9b5de5'],
  [491, 92, '#f5b82e'], [1270, 108, '#f5b82e'],
  [513, 142, '#3cc47c'], [1215, 126, '#3cc47c'],
  [618, 160, '#4a7cf7'], [1322, 176, '#4a7cf7'],
];
function pwmWavePath(dutyPercent: number, periods = 8, periodWidth = 100, highY = 25, lowY = 85): string {
  const highWidth = (periodWidth * dutyPercent) / 100;
  const lowWidth = periodWidth - highWidth;
  let path = `M0 ${lowY}`;
  let x = 0;
  for (let i = 0; i < periods; i++) {
    x += lowWidth;
    path += ` H${x} V${highY}`;
    x += highWidth;
    path += ` H${x} V${lowY}`;
  }
  return path;
}

export function Landing({ dark, onToggleTheme }: { dark: boolean; onToggleTheme: () => void }) {
  const [loopStep, setLoopStep] = useState(0);
  const [dutyPercent, setDutyPercent] = useState(50);
  const [paused, setPaused] = useState(false);
  const pwmLevel = Math.round((dutyPercent / 100) * 255);
  const step = LOOP_STEPS[loopStep];

  return (
    <div id="academy-content" tabIndex={-1} className={`lp${paused ? ' lp-paused' : ''}`}>
      <nav className="lp-nav"><div className="lp-wrap">
        <a className="lp-brand" href="#/"><span>firmware</span><b>/</b><span>academy</span></a>
        <div className="lp-navlinks">
          <a href="#learn">The experience</a>
          <a href="#curriculum">Curriculum</a>
          <a href="#/projects">Projects</a>
        </div>
        <button className="lp-theme" onClick={onToggleTheme} aria-label="Toggle color scheme">{dark ? '◑ Theme' : '◐ Theme'}</button>
        <a className="lp-btn lp-navcta" href="#/course" style={{ minHeight: 44, padding: '0 18px' }}>Start the course →</a>
      </div></nav>

      <header className="lp-hero"><div className="lp-wrap lp-hero-grid">
        <div>
          <span className="lp-tag lp-eyebrow"><i className="lp-eyebrow-dot" />For the code-to-hardware curious</span>
          <h1>Make code<br />do <em>something.</em></h1>
          <p>Not another console exercise. Write firmware. Watch a pin change. Follow a signal. Build a feel for the machine behind your code.</p>
          <div className="lp-actions">
            <a className="lp-btn" href="#/course">Start the course →</a>
            <a className="lp-btn lp-btn-alt" href="#playground">Play with a signal ↓</a>
          </div>
          <p className="lp-small lp-muted">Browser-based lessons + emulated hardware.<br />Runs locally. Node 22+ and board-specific toolchains required.</p>
          <div className="lp-statline">
            <div><strong>{UNIT_COUNT}</strong><span>Arduino units</span></div>
            <div><strong>{LESSON_COUNT}</strong><span>lessons to explore</span></div>
            <div><strong>0</strong><span>physical boards required</span></div>
          </div>
        </div>
        <div className="lp-scene" aria-label="Illustration of code flowing through a microcontroller to outputs">
          <div className="lp-badge">LESS SCROLLING.<br />MORE SIGNAL.</div>
          <svg viewBox="0 0 540 500" role="img"><title>Illustrative code to chip to signal animation</title>
            <g fill="none" strokeWidth={3}>
              <path d="M40 135 H135 L175 195 H215" stroke="var(--accent)" />
              <path d="M45 390 H150 L190 315 H215" stroke="#4169ef" />
              <path d="M330 205 H375 L405 145 H490" stroke="#88a245" />
              <path d="M330 275 H395 L430 320 H515" stroke="#9b72ed" />
              <path d="M270 325 V385 H375 V420 H485" stroke="#db9d24" />
            </g>
            <g fill="none" stroke="#fff9" strokeWidth={5}>
              <path className="lp-signal" d="M40 135 H135 L175 195 H215" />
              <path className="lp-signal lp-reverse" d="M45 390 H150 L190 315 H215" />
              <path className="lp-signal" d="M330 205 H375 L405 145 H490" />
              <path className="lp-signal" d="M330 275 H395 L430 320 H515" />
            </g>
            <g className="lp-float">
              <rect x={180} y={160} width={170} height={175} rx={10} fill="#23291e" stroke="#6e7a55" strokeWidth={2} />
              <g stroke="#8d9974" strokeWidth={8} strokeDasharray="6 9"><path d="M169 178 V320 M361 178 V320 M198 149 H332 M198 346 H332" /></g>
              <rect x={200} y={180} width={130} height={135} rx={4} fill="#353e2c" />
              <text x={265} y={229} textAnchor="middle" fill="#ddedc5" fontFamily="monospace" fontSize={16}>YOUR CODE.</text>
              <text x={265} y={252} textAnchor="middle" fill="#ddedc5" fontFamily="monospace" fontSize={16}>REAL EFFECT.</text>
              <circle className="lp-pulse" cx={265} cy={284} r={7} fill="#c8f263" />
            </g>
            <g fontFamily="monospace" fontSize={11}>
              <rect x={5} y={73} width={128} height={82} rx={7} fill="var(--surface)" stroke="var(--border)" />
              <text x={19} y={99} fill="var(--muted)">01 / WRITE</text>
              <text x={19} y={124} fill="var(--accent)">digitalWrite(</text>
              <text x={19} y={140} fill="var(--text)">&nbsp;&nbsp;13, HIGH);</text>
              <rect x={380} y={70} width={110} height={70} rx={7} fill="var(--surface)" stroke="var(--border)" />
              <text x={394} y={95} fill="var(--muted)">02 / OUTPUT</text>
              <circle className="lp-pulse" cx={404} cy={118} r={7} fill="#88a245" />
              <text x={422} y={121} fill="var(--text)">D13 HIGH</text>
              <rect x={376} y={325} width={145} height={74} rx={7} fill="var(--surface)" stroke="var(--border)" />
              <text x={390} y={349} fill="var(--muted)">03 / OBSERVE</text>
              <path d="M390 379 h20 v-15 h28 v15 h20 v-15 h28" fill="none" stroke="#9b72ed" strokeWidth={2} />
              <text x={20} y={418} fill="var(--muted)">CURIOSITY → CODE → SIGNAL</text>
            </g>
          </svg>
          <div className="lp-scene-label lp-mono">
            <span>ILLUSTRATION, NOT LIVE EMULATION</span>
            <button className="lp-pause" onClick={() => setPaused(value => !value)}>{paused ? 'Resume motion' : 'Pause motion'}</button>
          </div>
        </div>
      </div></header>

      <div className="lp-ribbon">
        <span>C / C++ firmware</span>
        <span>↗ Real compiler diagnostics</span>
        <span>GPIO + UART + timing</span>
        <span>Learn → predict → build</span>
      </div>

      <section id="learn"><div className="lp-wrap">
        <div className="lp-section-head">
          <div><span className="lp-tag">01 / Build intuition, then build firmware</span><h2>Less passive reading.<br />More &ldquo;oh, that&apos;s why.&rdquo;</h2></div>
          <p>A lesson takes you from a mental model to observable behavior. Click through the learning loop to see how it works.</p>
        </div>
        <div className="lp-steps" role="tablist" aria-label="Learning loop">
          {LOOP_STEPS.map((item, index) => (
            <button key={item.title} type="button" className={`lp-step${index === loopStep ? ' lp-active' : ''}`} role="tab" aria-selected={index === loopStep} onClick={() => setLoopStep(index)}>
              <span className="lp-num">{String(index + 1).padStart(2, '0')}</span>
              <h3>{['Learn.', 'Explore.', 'Predict.', 'Build.'][index]}</h3>
              <p>{[
                'Get the idea without getting buried in a datasheet.',
                'Change the model. Notice what changes with it.',
                'Make a call before the machine tells you.',
                'Write firmware and check the actual behavior.',
              ][index]}</p>
            </button>
          ))}
        </div>
        <div className="lp-loop-detail">
          <div><span className="lp-tag lp-muted">{step.tag}</span><h3>{step.title}</h3><p>{step.body}</p></div>
          <div className="lp-code">{step.code}</div>
        </div>
      </div></section>

      <section id="playground" className="lp-play"><div className="lp-wrap">
        <div className="lp-section-head">
          <div><span className="lp-tag">02 / A tiny taste of the idea</span><h2>Turn the knob.<br />Watch the brightness.</h2></div>
          <p className="lp-muted">A simple visual explanation of PWM: a digital pin switches HIGH and LOW fast enough that the LED looks dimmer or brighter instead of blinking. Change the duty cycle to change the brightness.</p>
        </div>
        <div className="lp-lab">
          <div className="lp-controls">
            <span className="lp-tag lp-muted">Illustrative PWM playground</span>
            <h3>From a number to a brightness.</h3>
            <p>A higher duty cycle means more time HIGH inside every cycle — a brighter LED. A lower duty cycle means more time LOW — a dimmer LED. The switching itself never slows down.</p>
            <label htmlFor="lp-duty">Duty cycle <b><output id="lp-duty-out" htmlFor="lp-duty">{dutyPercent}</output>%</b></label>
            <input id="lp-duty" type="range" min={0} max={100} step={5} value={dutyPercent} onChange={event => setDutyPercent(Number(event.target.value))} />
            <div className="lp-code" style={{ marginTop: 25 }}>
              pinMode(9, OUTPUT);<br />
              analogWrite(9, <span className="lp-green">{pwmLevel}</span>); <span className="lp-orange">// {dutyPercent}% duty cycle</span>
            </div>
          </div>
          <div className="lp-scope">
            <div className="lp-scope-top lp-mono"><span>D9 / PWM OUTPUT</span><i className="lp-led" style={{ opacity: 0.22 + (dutyPercent / 100) * 0.78, boxShadow: `0 0 ${8 + (dutyPercent / 100) * 30}px #aaf234` }} /></div>
            <div className="lp-wave">
              <svg viewBox="0 0 800 110" preserveAspectRatio="none">
                <path d={pwmWavePath(dutyPercent)} stroke="#c8f263" strokeWidth={3} fill="none" />
              </svg>
            </div>
            <div className="lp-lab-status lp-mono">Duty cycle: {dutyPercent}%<br />analogWrite level: {pwmLevel} / 255<br /><span style={{ opacity: .5 }}>~490 Hz PWM frequency · illustrative</span></div>
          </div>
        </div>
        <p className="lp-note">This landing-page animation is an illustration, not a compiler or microcontroller emulator. In the course, the Control outputs with PWM unit measures the real duty cycle produced by analogWrite() on simulated hardware, not just the number in your source.</p>
      </div></section>

      <section id="curriculum"><div className="lp-wrap">
        <div className="lp-section-head">
          <div><span className="lp-tag">03 / Your route into embedded</span><h2>One LED.<br />A whole new way to think.</h2></div>
          <p>Basic C is the starting point. No electronics experience needed. The available Arduino course grows from output pins to a responsive sensor monitor.</p>
        </div>
        <div className="lp-path-grid">
          <article className="lp-path-card lp-path-available">
            <span className="lp-tag">Course 01 / ATmega328P</span>
            <h3>Arduino Uno</h3>
            <span className="lp-pill">AVAILABLE · {UNIT_COUNT} UNITS / {LESSON_COUNT} LESSONS</span>
            <p>Turn familiar code into timing, inputs, signals, and state.</p>
            <ul><li>Digital I/O and breadboard circuits</li><li>Analog signals, PWM, interrupts</li><li>Serial, I2C, and EEPROM</li></ul>
          </article>
          <article className="lp-path-card">
            <span className="lp-tag">Course 02 / STM32F4</span>
            <h3>Bare-metal STM32</h3>
            <span className="lp-pill">COMING SOON</span>
            <p>Drop below the convenience libraries and work with peripheral registers.</p>
            <ul><li>RCC, GPIO, and NVIC</li><li>UART, SPI, and I2C</li><li>DMA</li></ul>
          </article>
          <article className="lp-path-card">
            <span className="lp-tag">Course 03 / STM32F4</span>
            <h3>Zephyr RTOS</h3>
            <span className="lp-pill">COMING SOON</span>
            <p>Meet the tools and abstractions used to structure RTOS-based firmware.</p>
            <ul><li>west, Devicetree, and Kconfig</li><li>Threads and semaphores</li><li>The sensor API</li></ul>
          </article>
        </div>
        <div className="lp-roadmap">
          {ROADMAP.map((unit, index) => (
            <div className="lp-unit" key={unit.title}><span className="lp-num">{String(index + 1).padStart(2, '0')}</span><div><b>{unit.title}</b><p>{unit.body}</p></div></div>
          ))}
        </div>
        <div className="lp-capstone">
          <div><span className="lp-tag">The final project</span><h3>A sensor monitor that doesn&apos;t miss a beat.</h3><p>Combine the course&apos;s ideas into several behaviors that keep running together, without a blocking delay().</p></div>
          <ul>
            <li>Read and scale the simulated A0 voltage.</li>
            <li>Report readings at a steady interval over Serial.</li>
            <li>Use hysteresis to keep the alert from chattering.</li>
            <li>Debounce a button and toggle an output while everything else keeps running.</li>
          </ul>
        </div>
      </div></section>

      <div className="lp-traces"><div className="lp-wrap lp-traces-in">
        <span className="lp-tag">Illustration, not live signals</span>
        <p>Every pin is a line that changes over time. The course teaches you to read them, then drive them.</p>
      </div>
      <svg viewBox="0 0 2880 230" preserveAspectRatio="none" aria-hidden="true">
        {[0, 1].map(copy => (
          <g key={copy} transform={`translate(${copy * 1440} 0)`}>
            {TRACE_POINTS.map((points, index) => (
              <polyline key={index} points={points} fill="none" stroke={TRACE_COLORS[index]} strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {TRACE_DOTS.map(([cx, cy, color], index) => (
              <circle key={index} cx={cx} cy={cy} r={7} fill="#14161a" stroke={color} strokeWidth={3} />
            ))}
          </g>
        ))}
      </svg></div>

      <section id="workbench-preview" className="lp-product"><div className="lp-wrap">
        <div className="lp-section-head">
          <div><span className="lp-tag">04 / Stay close to the machine</span><h2>Write. Run.<br />Look under the hood.</h2></div>
          <p>Create a project, pick its environment, and the workspace is yours. Write firmware and inspect what your code changes.</p>
        </div>
        <div className="lp-product-shot">
          <div className="lp-product-bar lp-mono">
            <span className="lp-dots"><i style={{ background: '#ff5f57' }} /><i style={{ background: '#febc2e' }} /><i style={{ background: '#28c840' }} /></span>
            <span>Project layout · illustrative</span>
          </div>
          <div className="lp-mock">
            <div className="lp-mock-editor">
              <div className="lp-mock-line" style={{ width: '40%' }} />
              <div className="lp-mock-line lp-mock-accent" style={{ width: '70%' }} />
              <div className="lp-mock-line" style={{ width: '55%' }} />
              <div className="lp-mock-line" style={{ width: '30%' }} />
              <div className="lp-mock-line lp-mock-accent" style={{ width: '62%' }} />
              <div className="lp-mock-line" style={{ width: '45%' }} />
            </div>
            <div className="lp-mock-board">
              <div className="lp-mock-chip">
                <div className="lp-mock-chip-body"><span /></div>
                <div className="lp-mock-chip-label">D13 OUTPUT<br />REGISTER PORTB</div>
              </div>
              <div className="lp-mock-trace">
                <svg viewBox="0 0 400 40" preserveAspectRatio="none"><path d="M0 32 H50 V8 H100 V32 H150 V8 H200 V32 H250 V8 H300 V32 H350 V8 H400" stroke="var(--accent)" strokeWidth={3} fill="none" /></svg>
              </div>
            </div>
          </div>
        </div>
        <p className="lp-note">Illustrative layout, not a screenshot — open the real thing below. Uno and Pico execute in a browser emulator; STM32 and Zephyr run through a local Renode session.</p>
        <div className="lp-actions"><a className="lp-btn lp-btn-alt" href="#/projects">Open Projects →</a></div>
        <div className="lp-instruments">
          {INSTRUMENTS.map(item => (
            <div className="lp-instrument" key={item.title}><span className="lp-tag">{item.tag}</span><h3>{item.title}</h3><p>{item.body}</p></div>
          ))}
        </div>
      </div></section>

      <section><div className="lp-wrap lp-faq">
        <div className="lp-section-head"><div><span className="lp-tag">Before you start</span><h2>A few useful answers.</h2></div></div>
        {FAQ.map(item => (
          <details key={item.q} open={item.open}><summary>{item.q}</summary><p>{item.a}</p></details>
        ))}
      </div></section>

      <div className="lp-final">
        <span className="lp-tag">Get closer to the hardware</span>
        <h2>Your code has a world<br />outside the terminal.</h2>
        <p>Start with one pin. Follow where it takes you.</p>
        <div className="lp-actions"><a className="lp-btn" href="#/course">Start the course →</a></div>
        <p className="lp-small">Local project · board-specific setup required</p>
      </div>
      <footer className="lp-footer"><div className="lp-wrap">
        <span className="lp-brand" style={{ fontSize: 15 }}>firmware/academy</span>
        <span>Arduino fundamentals available today · bare-metal STM32 and Zephyr coming soon</span>
      </div></footer>
    </div>
  );
}
