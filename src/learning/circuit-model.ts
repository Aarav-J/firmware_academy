import { BOARD_PINOUTS, LIVE_PIN_INDEX } from '../board-pinouts';
import { BREADBOARD_PARTS } from '../breadboard-parts';
import type { BreadboardLayout, PinRef, PlacedComponent, Wire } from '../breadboard-contracts';
import type { CircuitDraft, CircuitInspection, CircuitScenario } from './circuit-types';
import type { CircuitStep, GoalResult } from './types';
import { BREADBOARD_HOLES, decodePhysicalLayout, physicalConnections, pinRefKey, placementIssues } from '../physical-breadboard';

const MAX_COMPONENTS = 32;
const MAX_WIRES = 128;
const MAX_ANSWER_LENGTH = 200;
const PARTS = new Map(BREADBOARD_PARTS.map(part => [part.id, part]));

const boardRef = (pinId: string): PinRef => ({ kind: 'board', pinId });
const partRef = (instanceId: string, pinId: string): PinRef => ({ kind: 'component', instanceId, pinId });
const holeRef = (pinId: string): PinRef => ({ kind: 'breadboard', pinId });
const pinKey = pinRefKey;
const wire = (id: string, a: PinRef, b: PinRef): Wire => ({ id, a, b, status: 'ok' });

function initialParts(resistanceOhms: number): PlacedComponent[] {
  return [
    { instanceId: 'r1', componentId: 'resistor', x: 733, y: 335, resistanceOhms, holes: { A: 'e8', B: 'e13' } },
    { instanceId: 'led1', componentId: 'led', x: 985, y: 285, holes: { ANODE: 'a18', CATHODE: 'a19' } },
  ];
}

function scenario(id: string, resistanceOhms: number, wires: Wire[]): CircuitScenario {
  return {
    id,
    boardKey: 'arduino-uno',
    outputPin: 8,
    supplyVolts: 5,
    ledForwardVolts: 2,
    minCurrentMa: 2,
    maxCurrentMa: 10,
    resistanceOptions: [100, 220, 330, 470, 1000],
    allowedParts: ['resistor', 'led'],
    initialLayout: { version: 2, components: initialParts(resistanceOhms).map(part => id === 'reversed-led' && part.componentId === 'led' ? { ...part, holes: { ANODE: 'a19', CATHODE: 'a18' } } : part), wires },
  };
}

export const CIRCUIT_SCENARIOS: Record<'open-loop' | 'reversed-led' | 'choose-resistor' | 'external-led', CircuitScenario> = {
  'open-loop': scenario('open-loop', 330, [
    wire('open-source', boardRef('D8'), holeRef('b8')),
    wire('open-led', holeRef('b13'), holeRef('b18')),
  ]),
  'reversed-led': scenario('reversed-led', 330, [
    wire('reverse-source', boardRef('D8'), holeRef('b8')),
    wire('reverse-led', holeRef('b13'), holeRef('b18')),
    wire('reverse-ground', holeRef('b19'), boardRef('P-GND1')),
  ]),
  'choose-resistor': scenario('choose-resistor', 100, [
    wire('current-source', boardRef('D8'), holeRef('b8')),
    wire('current-led', holeRef('b13'), holeRef('b18')),
    wire('current-ground', holeRef('b19'), boardRef('P-GND1')),
  ]),
  'external-led': scenario('external-led', 330, []),
};

function cloneLayout(layout: BreadboardLayout): BreadboardLayout {
  return structuredClone(layout);
}


function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 100;
}


/** Decode persisted data without correcting electrically valid but incorrect student work. */
export function decodeCircuitDraft(circuit: CircuitScenario, raw: unknown): CircuitDraft {
  const fallback = (): CircuitDraft => ({ layout: cloneLayout(circuit.initialLayout), currentAnswer: '' });
  if (!raw || typeof raw !== 'object') return fallback();
  const value = raw as Record<string, unknown>;
  if (typeof value.currentAnswer !== 'string' || value.currentAnswer.length > MAX_ANSWER_LENGTH) return fallback();
  const layout = decodePhysicalLayout(value.layout, circuit.boardKey);
  return layout ? { layout, currentAnswer: value.currentAnswer } : fallback();
}

type PartEdge = { kind: 'resistor' | 'led'; a: string; b: string };
type PathEdge = { edge: PartEdge; from: string; to: string };

/**
 * A topology check, not an electrical solver. Wires form zero-ohm nets; the
 * resistor and directed LED remain distinct edges between those nets.
 */
export function inspectCircuit(layout: BreadboardLayout, circuit: CircuitScenario): CircuitInspection {
  const issues: string[] = placementIssues(layout);
  const refs = new Map<string, PinRef>();
  const wires = new Map<string, Set<string>>();
  const addRef = (ref: PinRef): string => {
    const key = pinKey(ref);
    refs.set(key, ref);
    if (!wires.has(key)) wires.set(key, new Set());
    return key;
  };
  const joinWire = (a: string, b: string): void => {
    wires.get(a)?.add(b);
    wires.get(b)?.add(a);
  };
  const boardPins = BOARD_PINOUTS[circuit.boardKey].headers.flatMap(header => header.pins);
  const sourcePin = boardPins.find(pin => LIVE_PIN_INDEX[circuit.boardKey][pin.id] === circuit.outputPin);
  const source = sourcePin ? pinKey(boardRef(sourcePin.id)) : null;
  const grounds = boardPins.filter(pin => pin.kind === 'ground').map(pin => pinKey(boardRef(pin.id)));
  for (const pin of boardPins) addRef(boardRef(pin.id));
  for (const hole of BREADBOARD_HOLES) addRef(holeRef(hole.id));
  // The board's real GND header pins share its ground plane.
  for (const ground of grounds.slice(1)) joinWire(grounds[0], ground);
  if (!source) issues.push('The selected output pin is not available on this board.');
  if (!grounds.length) issues.push('This board has no supported ground connection.');
  if (layout.components.length > MAX_COMPONENTS || layout.wires.length > MAX_WIRES) issues.push('There are too many parts or wires for this series-circuit activity.');
  const instances = new Set<string>();
  for (const component of layout.components) {
    if (!identifier(component.instanceId) || instances.has(component.instanceId)) issues.push('Each placed part needs a unique instance ID.');
    instances.add(component.instanceId);
    const definition = PARTS.get(component.componentId);
    if (!definition || !circuit.allowedParts.includes(component.componentId) || (component.componentId !== 'resistor' && component.componentId !== 'led')) {
      issues.push(`Unsupported part: ${component.componentId}. Use only one resistor and one LED.`);
    }
    for (const pin of definition?.pins ?? []) addRef(partRef(component.instanceId, pin.id));
  }
  for (const connection of physicalConnections(layout, circuit.boardKey).slice(layout.wires.length)) {
    const a = pinKey(connection.a), b = pinKey(connection.b);
    if (refs.has(a) && refs.has(b)) joinWire(a, b);
  }
  const resistors = layout.components.filter(component => component.componentId === 'resistor');
  const leds = layout.components.filter(component => component.componentId === 'led');
  if (resistors.length !== 1) issues.push(`Use exactly one resistor; found ${resistors.length}.`);
  if (leds.length !== 1) issues.push(`Use exactly one LED; found ${leds.length}.`);
  const wireIds = new Set<string>();
  const unwantedPins = new Set<string>();
  for (const connection of layout.wires) {
    if (!identifier(connection.id) || wireIds.has(connection.id)) issues.push('Each wire needs a unique ID.');
    wireIds.add(connection.id);
    const a = pinKey(connection.a);
    const b = pinKey(connection.b);
    if (!refs.has(a) || !refs.has(b)) {
      issues.push('A wire refers to a missing part or an unsupported pin.');
      continue;
    }
    for (const ref of [connection.a, connection.b]) {
      if (ref.kind === 'board' && LIVE_PIN_INDEX[circuit.boardKey][ref.pinId] !== circuit.outputPin && !grounds.includes(pinKey(ref))) unwantedPins.add(ref.pinId);
    }
    joinWire(a, b);
  }
  if (unwantedPins.size) issues.push(`Remove connections to ${[...unwantedPins].join(', ')}. Use only the selected output and GND, not another output or power pin.`);
  const supported = issues.length === 0;
  const resistor = resistors.length === 1 ? resistors[0] : undefined;
  const led = leds.length === 1 ? leds[0] : undefined;
  const resistanceOhms = resistor && typeof resistor.resistanceOhms === 'number' && Number.isFinite(resistor.resistanceOhms) && resistor.resistanceOhms > 0 ? resistor.resistanceOhms : null;
  if (resistor && resistanceOhms === null) issues.push('Set an explicit, positive, finite resistance in ohms.');

  // Collapse only wires. Never collapse the resistor's A–B edge into a net.
  const nets = new Map<string, string>();
  for (const key of refs.keys()) {
    if (nets.has(key)) continue;
    const queue = [key];
    nets.set(key, key);
    for (let index = 0; index < queue.length; index++) {
      for (const neighbor of wires.get(queue[index]) ?? []) {
        if (!nets.has(neighbor)) {
          nets.set(neighbor, key);
          queue.push(neighbor);
        }
      }
    }
  }
  const resistorEdge: PartEdge | null = resistor ? { kind: 'resistor', a: pinKey(partRef(resistor.instanceId, 'A')), b: pinKey(partRef(resistor.instanceId, 'B')) } : null;
  const ledEdge: PartEdge | null = led ? { kind: 'led', a: pinKey(partRef(led.instanceId, 'ANODE')), b: pinKey(partRef(led.instanceId, 'CATHODE')) } : null;
  const edges: PartEdge[] = [];
  if (resistorEdge) edges.push(resistorEdge);
  if (ledEdge) edges.push(ledEdge);
  const sourceNet = source ? nets.get(source) : undefined;
  const groundNet = grounds.length ? nets.get(grounds[0]) : undefined;
  const closedPaths: PathEdge[][] = [];
  // With exactly two possible part edges, exhaustive simple-net paths are small
  // even if the wire graph contains many cycles or parallel wires.
  const visit = (net: string, visited: Set<string>, path: PathEdge[]): void => {
    if (net === groundNet) {
      closedPaths.push([...path]);
      return;
    }
    for (const edge of edges) {
      const a = nets.get(edge.a);
      const b = nets.get(edge.b);
      const from = a === net ? edge.a : b === net ? edge.b : null;
      const to = from === edge.a ? edge.b : edge.a;
      const next = from ? nets.get(to) : undefined;
      if (!from || !next || visited.has(next)) continue;
      visited.add(next);
      path.push({ edge, from, to });
      visit(next, visited, path);
      path.pop();
      visited.delete(next);
    }
  };
  if (sourceNet && groundNet) visit(sourceNet, new Set([sourceNet]), []);
  const ledPath = closedPaths.find(path => path.some(segment => segment.edge.kind === 'led'));
  const connected = supported && ledPath !== undefined;
  const forward = connected && !!ledPath?.some(segment => segment.edge.kind === 'led' && segment.from === segment.edge.a);
  const bypassedResistor = resistorEdge !== null && nets.get(resistorEdge.a) === nets.get(resistorEdge.b);
  const bypassedLed = ledEdge !== null && nets.get(ledEdge.a) === nets.get(ledEdge.b);
  const sourceShort = !!sourceNet && sourceNet === groundNet;
  const unprotectedPath = closedPaths.some(path => path.some(segment => segment.edge.kind === 'led') && !path.some(segment => segment.edge.kind === 'resistor'));
  const ledBypassPath = connected && closedPaths.some(path => !path.some(segment => segment.edge.kind === 'led'));
  const shorted = sourceShort || bypassedResistor || bypassedLed || unprotectedPath || ledBypassPath;
  const seriesResistor = connected && resistanceOhms !== null && !shorted && closedPaths.every(path => path.some(segment => segment.edge.kind === 'resistor') && path.some(segment => segment.edge.kind === 'led'));
  if (sourceShort) issues.push('The output is shorted directly to GND by wires. Remove the wire-only bypass.');
  if (bypassedResistor || unprotectedPath) issues.push('The resistor is bypassed or absent from an LED current path. Every LED path must pass through the resistor.');
  if (bypassedLed || ledBypassPath) issues.push('The LED is bypassed by another path. Remove the connection around it.');
  if (!connected) issues.push('Complete a closed path from the output through the LED to a real GND pin.');
  else if (!forward) issues.push('The LED is reversed: current must enter ANODE (+) and leave CATHODE (−).');

  const modelValid = Number.isFinite(circuit.supplyVolts) && Number.isFinite(circuit.ledForwardVolts)
    && circuit.supplyVolts > circuit.ledForwardVolts && circuit.ledForwardVolts >= 0
    && Number.isFinite(circuit.minCurrentMa) && Number.isFinite(circuit.maxCurrentMa)
    && circuit.minCurrentMa >= 0 && circuit.maxCurrentMa >= circuit.minCurrentMa;
  if (!modelValid) issues.push('The scenario does not define a valid supply, LED voltage drop, and safe-current range.');
  const estimate = supported && forward && seriesResistor && resistanceOhms !== null && modelValid ? (circuit.supplyVolts - circuit.ledForwardVolts) / resistanceOhms * 1000 : null;
  const currentMa = estimate !== null && Number.isFinite(estimate) ? estimate : null;
  if (estimate !== null && !Number.isFinite(estimate)) issues.push('This resistance is outside the finite range of the current-estimation model. Choose a practical resistance.');
  const safeCurrent = currentMa !== null && currentMa >= circuit.minCurrentMa && currentMa <= circuit.maxCurrentMa;
  if (currentMa !== null && !safeCurrent) issues.push(`Estimated current is ${currentMa.toFixed(2)} mA; choose a resistor for ${circuit.minCurrentMa}–${circuit.maxCurrentMa} mA.`);

  // Recover real endpoints for the teaching view, including every wire hop.
  const wireRoute = (start: string, targets: Set<string>): string[] => {
    const queue = [start];
    const previous = new Map<string, string | null>([[start, null]]);
    for (let index = 0; index < queue.length; index++) {
      const current = queue[index];
      if (targets.has(current)) {
        const route: string[] = [];
        let cursor: string | null = current;
        while (cursor !== null) {
          route.push(cursor);
          cursor = previous.get(cursor) ?? null;
        }
        return route.reverse();
      }
      for (const neighbor of wires.get(current) ?? []) {
        if (!previous.has(neighbor)) {
          previous.set(neighbor, current);
          queue.push(neighbor);
        }
      }
    }
    return [];
  };
  const pathKeys: string[] = [];
  if (source && ledPath && connected) {
    pathKeys.push(source);
    let cursor = source;
    for (const segment of ledPath) {
      pathKeys.push(...wireRoute(cursor, new Set([segment.from])).slice(1), segment.to);
      cursor = segment.to;
    }
    pathKeys.push(...wireRoute(cursor, new Set(grounds)).slice(1));
  }
  return {
    connected,
    forward,
    seriesResistor,
    shorted,
    safeCurrent,
    currentMa,
    resistanceOhms,
    path: pathKeys.map(key => ({ ...refs.get(key)! })),
    issues: [...new Set(issues)],
    passed: supported && connected && forward && seriesResistor && !shorted && safeCurrent,
  };
}

export function assessCircuit(step: CircuitStep, draft: CircuitDraft): GoalResult[] {
  const inspection = inspectCircuit(draft.layout, step.scenario);
  const source = `D${step.scenario.outputPin}`;
  return step.goals.map(goal => {
    if (goal.rule === 'complete-path') return {
      id: goal.id,
      passed: inspection.connected,
      detail: inspection.connected ? `A closed path connects ${source}, the LED, and GND.` : `Connect ${source} through the LED and back to a real GND pin. A missing return wire leaves an open circuit.`,
    };
    if (goal.rule === 'led-forward') return {
      id: goal.id,
      passed: inspection.forward,
      detail: inspection.forward ? 'The LED faces forward: ANODE (+) toward the source, CATHODE (−) toward GND.' : 'Complete the loop with current entering ANODE (+) and leaving CATHODE (−).',
    };
    if (goal.rule === 'series-resistor') return {
      id: goal.id,
      passed: inspection.seriesResistor,
      detail: inspection.seriesResistor ? 'Every source-to-GND path passes through both the resistor and LED; neither is bypassed.' : 'Use exactly one resistor in series, before or after the LED. Remove any wire bypassing either part or shorting the output to GND.',
    };
    if (goal.rule === 'safe-current') return {
      id: goal.id,
      passed: inspection.safeCurrent,
      detail: inspection.currentMa === null ? 'A supported, forward, protected series circuit with an explicit resistance is needed before estimating current.' : `Estimated current: ${inspection.currentMa.toFixed(2)} mA. The model target is ${step.scenario.minCurrentMa}–${step.scenario.maxCurrentMa} mA; this is not measured current.`,
    };
    const text = draft.currentAnswer.trim();
    const numeric = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text) ? Number(text) : NaN;
    const passed = inspection.currentMa !== null && Number.isFinite(numeric) && Math.abs(numeric - inspection.currentMa) <= 0.1 + 1e-9;
    return {
      id: goal.id,
      passed,
      detail: inspection.currentMa === null ? 'Finish a valid forward series circuit before calculating its estimated current.' : passed ? 'Your numerical answer agrees with the model estimate within 0.1 mA; it is an estimate, not a measurement.' : `Enter only a number in mA: (${step.scenario.supplyVolts} − ${step.scenario.ledForwardVolts}) ÷ resistance in ohms × 1000. Match the model estimate within 0.1 mA.`,
    };
  });
}
