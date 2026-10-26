import { pinTransitions, measurePin } from '../trace';
import { inspectCircuit } from './circuit-model';
import type { ExerciseStep, GoalResult, WorkbenchObservation } from './types';

const TIMING_TOLERANCE = 0.05;
const near = (actual: number, expected: number) => Math.abs(actual - expected) <= expected * TIMING_TOLERANCE;

/** Button edges are active-low: a press is the transition to level 0, a release is the transition to level 1. */
function presses(trace: WorkbenchObservation['trace'], pin: number) {
  return pinTransitions(trace, pin).filter(edge => edge.level === 0);
}

/** A real switch bounces; the canonical count ignores extra edges arriving within the debounce window of the previous one. */
function debouncedPressCount(trace: WorkbenchObservation['trace'], pin: number, windowUs = 50_000): number {
  const edges = presses(trace, pin);
  let count = 0;
  let lastTimeUs = -Infinity;
  for (const edge of edges) {
    if (edge.timeUs - lastTimeUs >= windowUs) count++;
    lastTimeUs = edge.timeUs;
  }
  return count;
}

function lastNumber(text: string): number | null {
  const matches = text.match(/-?\d+(?:\.\d+)?/g);
  if (!matches?.length) return null;
  const value = Number(matches[matches.length - 1]);
  return Number.isFinite(value) ? value : null;
}

export function assessExercise(step: ExerciseStep, observation: WorkbenchObservation | null): GoalResult[] {
  const built = observation?.built === true;
  const active = built && observation !== null && (observation.state === 'running' || observation.state === 'paused');
  const text = observation?.serial ?? '';

  return step.goals.map(goal => {
    if (goal.rule === 'build') return { id: goal.id, passed: built, detail: built ? 'The current sketch compiled successfully.' : 'Build the current sketch successfully first.' };

    if (goal.rule === 'circuit-wiring') {
      if (!step.hardware || !observation?.circuit) return { id: goal.id, passed: false, detail: 'Connect the supplied resistor and LED in a complete series path from the required output to ground.' };
      const circuit = inspectCircuit(observation.circuit.layout, step.hardware);
      return {
        id: goal.id,
        passed: circuit.passed,
        detail: circuit.passed ? `Valid forward LED and series resistor circuit between D${step.hardware.outputPin} and GND. Current estimate: ${circuit.currentMa?.toFixed(2)} mA using the lesson model, not an electrical measurement.` : circuit.issues.join(' '),
      };
    }

    if (!active || !observation) return { id: goal.id, passed: false, detail: 'Build and run your current sketch before checking its output.' };
    const pin = goal.pin ?? step.signal?.pin ?? step.hardware?.outputPin ?? 13;
    const highUs = (goal.highMs ?? step.signal?.highMs ?? 250) * 1000;
    const lowUs = (goal.lowMs ?? step.signal?.lowMs ?? 750) * 1000;
    const label = `D${pin}`;
    const edges = pinTransitions(observation.trace, pin);

    if (goal.rule === 'steady-high') {
      const last = edges.at(-1);
      const passed = observation.pins[pin] === 1 && last?.level === 1 && observation.timeUs - last.timeUs >= 1_000_000;
      return { id: goal.id, passed, detail: passed ? `${label} has remained HIGH for at least 1 simulated second.` : `${label} needs to remain HIGH for at least 1 simulated second. Watch the board, then check again.` };
    }

    if (goal.rule === 'delayed-low') {
      const startup = pinTransitions(observation.startupTrace ?? observation.trace, pin);
      const rises = startup.filter(edge => edge.level === 1);
      const rise = rises[0];
      const fall = rise ? startup.find(edge => edge.level === 0 && edge.timeUs > rise.timeUs) : undefined;
      const passed = rises.length === 1 && !!rise && rise.timeUs < 100_000 && !!fall && near(fall.timeUs - rise.timeUs, 1_000_000) && observation.pins[pin] === 0 && observation.timeUs - fall.timeUs >= 1_000_000;
      return { id: goal.id, passed, detail: passed ? 'Observed one startup HIGH, a fall after 1 second, and at least 1 second remaining LOW.' : 'Expect one startup HIGH, LOW after 1000 ms (±5%), then at least 1 second with no further flash. Check after 2 simulated seconds.' };
    }

    if (goal.rule === 'timed-blink') {
      const intervals = edges.slice(0, -1).map((edge, index) => ({ level: edge.level, duration: edges[index + 1].timeUs - edge.timeUs }));
      const firstHigh = intervals.findIndex(interval => interval.level === 1);
      const cycles = firstHigh < 0 ? [] : intervals.slice(firstHigh);
      const latest = edges.at(-1);
      const currentDuration = latest ? observation.timeUs - latest.timeUs : Infinity;
      const stillToggling = !!latest && observation.pins[pin] === latest.level && currentDuration >= 0 && currentDuration <= (latest.level === 1 ? highUs : lowUs) * (1 + TIMING_TOLERANCE);
      const passed = stillToggling && cycles.length >= 4 && cycles.every(interval => near(interval.duration, interval.level === 1 ? highUs : lowUs));
      return { id: goal.id, passed, detail: passed ? `Observed at least two ${label} cycles with ${highUs / 1000} ms HIGH and ${lowUs / 1000} ms LOW (±5%).` : `Run for at least ${(highUs + lowUs) * 2 / 1_000_000} simulated seconds. ${label} must repeat ${highUs / 1000} ms HIGH and ${lowUs / 1000} ms LOW (±5%).` };
    }

    // --- Unit: Read inputs -------------------------------------------------
    if (goal.rule === 'mirrors-input') {
      const source = pinTransitions(observation.trace, 2);
      const settleUs = 30_000;
      const matched = source.filter(edge => edges.some(output => output.level === 1 - edge.level && output.timeUs >= edge.timeUs && output.timeUs - edge.timeUs <= settleUs));
      const passed = source.length >= 3 && matched.length === source.length;
      return { id: goal.id, passed, detail: passed ? `${label} lit while D2 is pressed and turned off within 30 ms of every release.` : `${label} must light while D2 is pressed (D2 reads LOW) and turn off within about 30 ms of release. Press the button a few times, then check again.` };
    }

    if (goal.rule === 'toggles-per-press') {
      const pressEdges = debouncedPressCount(observation.trace, 2);
      const passed = pressEdges >= 3 && edges.length === pressEdges;
      return { id: goal.id, passed, detail: passed ? `${label} toggled exactly once per debounced press (${pressEdges} presses, ${edges.length} toggles).` : `${label} should toggle exactly once per press, not once per press and release. Observed ${pressEdges} presses and ${edges.length} ${label} toggles.` };
    }

    if (goal.rule === 'debounced-count') {
      const expected = debouncedPressCount(observation.trace, 2);
      const reported = lastNumber(text);
      const passed = expected >= 2 && reported === expected;
      return { id: goal.id, passed, detail: passed ? `Reported count (${reported}) matches the debounced press count (${expected}).` : `Reported count ${reported ?? 'is missing'}; the debounced press count from the actual D2 trace is ${expected}. A bouncing switch produces extra raw edges within about 50 ms of the real transition.` };
    }

    // --- Unit: Observe and debug --------------------------------------------
    if (goal.rule === 'reports-events') {
      const expected = debouncedPressCount(observation.trace, 2);
      const reportedCount = (text.match(/press/gi) ?? []).length;
      const passed = expected >= 2 && reportedCount === expected;
      return { id: goal.id, passed, detail: passed ? `Logged ${reportedCount} press events, matching the ${expected} debounced presses observed.` : `Logged ${reportedCount} press events; the debounced press count is ${expected}. Log one event per accepted press, not per raw edge.` };
    }

    // --- Unit: Make it responsive --------------------------------------------
    if (goal.rule === 'responsive-under-load') {
      const responseWindowUs = 50_000;
      const pressEdges = presses(observation.trace, 2);
      const responded = pressEdges.filter(press => edges.some(output => output.timeUs >= press.timeUs && output.timeUs - press.timeUs <= responseWindowUs));
      const passed = pressEdges.length >= 2 && responded.length === pressEdges.length;
      return { id: goal.id, passed, detail: passed ? `${label} responded to all ${pressEdges.length} presses within ${responseWindowUs / 1000} ms, even while other work was pending.` : `${label} must respond to a press within ${responseWindowUs / 1000} ms. A blocking delay() elsewhere in loop() can make a response arrive late or not at all.` };
    }

    if (goal.rule === 'state-sequence') {
      const activeMs = highUs / 1000;
      const activeUs = activeMs * 1000;
      const windows: { start: number; end: number }[] = [];
      for (let index = 0; index < edges.length - 1; index++) {
        if (edges[index].level === 1) windows.push({ start: edges[index].timeUs, end: edges[index + 1].timeUs });
      }
      const validWindows = windows.filter(window => near(window.end - window.start, activeUs));
      const passed = validWindows.length >= 2 && windows.every(window => near(window.end - window.start, activeUs));
      return { id: goal.id, passed, detail: passed ? `Observed ${validWindows.length} complete ${activeMs} ms active windows (±5%), including a press that occurred mid-window being ignored.` : `${label} should go HIGH for exactly ${activeMs} ms per accepted press and ignore presses while already active. Found ${windows.length} window(s); durations must stay within ±5% of ${activeMs} ms.` };
    }

    // --- Unit: Control outputs with PWM --------------------------------------
    if (goal.rule === 'duty-cycle-match') {
      const expectedDuty = highUs / 1000;
      const measured = measurePin(observation.trace, pin);
      const passed = !!measured && near(measured.duty, expectedDuty);
      return { id: goal.id, passed, detail: passed ? `Measured ${measured!.duty.toFixed(1)}% duty cycle on ${label}, matching the requested ${expectedDuty}% (±5%).` : `${label}'s measured duty cycle is ${measured ? `${measured.duty.toFixed(1)}%` : 'not measurable yet — let it run longer'}; it should be ${expectedDuty}% (±5%).` };
    }

    if (goal.rule === 'duty-tracks-input') {
      const measured = measurePin(observation.trace, pin);
      const voltage = observation.analogVoltage ?? 0;
      const analogMax = step.analogInput?.max ?? 5;
      const expectedDuty = Math.max(0, Math.min(100, voltage / analogMax * 100));
      const passed = !!measured && Math.abs(measured.duty - expectedDuty) <= 8;
      return { id: goal.id, passed, detail: passed ? `Measured ${measured!.duty.toFixed(1)}% duty cycle for an analog input of ${voltage.toFixed(2)} V, within 8 points of the expected ${expectedDuty.toFixed(1)}%.` : `${label}'s duty cycle (${measured ? `${measured.duty.toFixed(1)}%` : 'not measurable yet'}) should track the analog input. At ${voltage.toFixed(2)} V the expected duty cycle is about ${expectedDuty.toFixed(1)}%.` };
    }

    // --- Unit: Read analog signals --------------------------------------------
    if (goal.rule === 'reports-analog-value') {
      const voltage = observation.analogVoltage ?? 0;
      const expectedRaw = Math.min(1023, Math.max(0, Math.round(voltage / 5 * 1023)));
      const reported = lastNumber(text);
      const passed = reported !== null && Math.abs(reported - expectedRaw) <= 4;
      return { id: goal.id, passed, detail: passed ? `Reported raw ADC value ${reported} matches ${voltage.toFixed(2)} V (expected about ${expectedRaw}, ±4 counts).` : `Reported ${reported ?? 'no value'}; at ${voltage.toFixed(2)} V analogRead should return about ${expectedRaw} (±4 counts of real ADC quantization).` };
    }

    if (goal.rule === 'scales-measurement') {
      const voltage = observation.analogVoltage ?? 0;
      const reported = lastNumber(text);
      const passed = reported !== null && Math.abs(reported - voltage) <= 0.1;
      return { id: goal.id, passed, detail: passed ? `Reported ${reported!.toFixed(2)} matches the real ${voltage.toFixed(2)} V input within 0.1 V.` : `Reported ${reported !== null ? reported.toFixed(2) : 'no value'}; the actual input is ${voltage.toFixed(2)} V. Scale the raw ADC count back to volts: raw ÷ 1023 × 5.0.` };
    }

    if (goal.rule === 'hysteresis-indicator') {
      const voltage = observation.analogVoltage ?? 0;
      const threshold = step.analogInput ? (step.analogInput.min + step.analogInput.max) / 2 : 2.5;
      const indicatorHigh = observation.pins[pin] === 1;
      const margin = (step.analogInput?.max ?? 5) * 0.1;
      const unambiguous = Math.abs(voltage - threshold) > margin;
      const passed = !unambiguous || indicatorHigh === voltage > threshold;
      return { id: goal.id, passed, detail: passed ? `${label} correctly reads ${indicatorHigh ? 'HIGH' : 'LOW'} at ${voltage.toFixed(2)} V against a ${threshold.toFixed(2)} V threshold.` : `${label} reads ${indicatorHigh ? 'HIGH' : 'LOW'} at ${voltage.toFixed(2)} V, which should be ${voltage > threshold ? 'HIGH' : 'LOW'} against a ${threshold.toFixed(2)} V threshold. Move well clear of the threshold, then check again.` };
    }

    // --- Unit: Handle asynchronous events --------------------------------------
    if (goal.rule === 'interrupt-count') {
      const expected = presses(observation.trace, 2).length;
      const reported = lastNumber(text);
      const passed = expected >= 3 && reported === expected;
      return { id: goal.id, passed, detail: passed ? `Reported count (${reported}) matches ${expected} real interrupt-triggering edges.` : `Reported ${reported ?? 'no count'}; ${expected} real falling edges occurred on D2. Count every edge the interrupt handler observes, including ones the main loop never sees.` };
    }

    // --- Unit: Talk to another device --------------------------------------------
    if (goal.rule === 'uart-command-handled') {
      const expectedHigh = observation.lastSerialCommand === '1';
      const expectedLow = observation.lastSerialCommand === '0';
      const indicatorHigh = observation.pins[pin] === 1;
      const passed = !!observation.lastSerialCommand && (expectedHigh ? indicatorHigh : expectedLow ? !indicatorHigh : false);
      return { id: goal.id, passed, detail: passed ? `${label} correctly reflects the last command received over Serial ('${observation.lastSerialCommand}').` : `${label} should reflect the command your sketch parsed from incoming Serial data: '1' means HIGH, '0' means LOW. Send a command and check again.` };
    }

    if (goal.rule === 'i2c-identifies-device') {
      const passed = /\b5A\b/i.test(text);
      return { id: goal.id, passed, detail: passed ? 'Serial output reports the identification register value 0x5A read from the supported device.' : 'Serial output does not yet show the identification register (0x5A) read from the supported device address.' };
    }

    if (goal.rule === 'i2c-handles-failure') {
      const reportsFailure = /\berr\w*\b|\bfail\w*\b|\bnack\b/i.test(text);
      const reportsLastGood = /\b5A\b/i.test(text) || /\bA4\b/.test(text);
      const passed = reportsFailure && reportsLastGood;
      return { id: goal.id, passed, detail: passed ? 'Serial output reports the communication failure for the unsupported address and still shows the last valid reading.' : 'Address both the supported and an unsupported device. Report the failure explicitly and keep showing the last successful reading, not a blank or crashed state.' };
    }

    return { id: goal.id, passed: false, detail: `Unknown goal rule: ${goal.rule}.` };
  });
}
