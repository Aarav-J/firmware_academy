import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BenchSchematic } from '../src/components/BenchSchematic';
import { BREADBOARD_HOLES, connectionWarnings, decodePhysicalLayout, holeNet, holePoint, physicalConnections, physicalLedStates, physicalNets, pinRefKey, placementIssues, toPhysicalLayout } from '../src/physical-breadboard';
import { CIRCUIT_SCENARIOS, decodeCircuitDraft, inspectCircuit } from '../src/learning/circuit-model';
import { arduinoCourse } from '../src/learning/course';
import { decodeProgress } from '../src/learning/progress';
import { boardPinPoint, componentPinPoint } from '../src/components/BenchArtwork';
import type { BreadboardLayout, PinRef, Wire } from '../src/breadboard-contracts';

const board = (pinId: string): PinRef => ({ kind: 'board', pinId });
const hole = (pinId: string): PinRef => ({ kind: 'breadboard', pinId });
const part = (instanceId: string, pinId: string): PinRef => ({ kind: 'component', instanceId, pinId });
const wire = (id: string, a: PinRef, b: PinRef): Wire => ({ id, a, b, status: 'ok' });
const scenario = CIRCUIT_SCENARIOS['external-led'];
function series(afterLed = false): BreadboardLayout {
  return { ...structuredClone(scenario.initialLayout), wires: afterLed ? [
    wire('source', board('D8'), hole('c18')),
    wire('middle', hole('c19'), hole('c8')),
    wire('return', hole('c13'), board('P-GND1')),
  ] : [
    wire('source', board('D8'), hole('c8')),
    wire('middle', hole('c13'), hole('c18')),
    wire('return', hole('c19'), board('P-GND1')),
  ] };
}
const pins = (high: boolean) => Array.from({ length: 20 }, (_, pin) => pin === 8 && high ? 1 : 0);

for (let number = 1; number <= 30; number++) test(`five-hole strips at ${number} connect only on their own side`, () => {
  const nets = physicalNets({ version: 2, components: [], wires: [] }, 'arduino-uno');
  const net = (id: string) => nets.get(pinRefKey(hole(id)));
  for (const letter of 'abcde') assert.equal(net(`${letter}${number}`), net(`a${number}`));
  for (const letter of 'fghij') assert.equal(net(`${letter}${number}`), net(`f${number}`));
  assert.notEqual(net(`a${number}`), net(`f${number}`));
  assert.notEqual(net(`a${number}`), net(`a${number === 30 ? 1 : number + 1}`));
});

test('every socket has a distinct position, and all four continuous rails remain isolated', () => {
  assert.equal(new Set(BREADBOARD_HOLES.map(hole => hole.id)).size, BREADBOARD_HOLES.length);
  assert.equal(new Set(BREADBOARD_HOLES.map(hole => `${hole.x},${hole.y}`)).size, BREADBOARD_HOLES.length);
  const rails = ['top+', 'top-', 'bottom+', 'bottom-'];
  for (const rail of rails) assert.equal(holeNet(`${rail}:1`), holeNet(`${rail}:30`));
  assert.equal(new Set(rails.map(rail => holeNet(`${rail}:1`))).size, rails.length);
  assert.notEqual(holeNet('a1'), holeNet('top+:1'));
  assert.equal(holePoint('z99'), undefined);
});

for (const afterLed of [false, true]) for (const swapped of [false, true]) for (const ground of ['D-GND', 'P-GND1', 'P-GND2']) {
  test(`actual socket wiring passes with resistor ${afterLed ? 'after' : 'before'} LED, ${swapped ? 'swapped' : 'normal'} resistor legs, ${ground}`, () => {
    const layout = series(afterLed);
    if (swapped) layout.components[0].holes = { A: 'e13', B: 'e8' };
    layout.wires[2].b = board(ground);
    const inspection = inspectCircuit(layout, scenario);
    assert.equal(inspection.passed, true, inspection.issues.join(' '));
    assert.equal(placementIssues(layout).length, 0);
    assert.ok(inspection.path.some(ref => ref.kind === 'breadboard'));
    assert.equal(physicalLedStates(layout, 'arduino-uno', pins(true)).get('led1'), true);
    assert.equal(physicalLedStates(layout, 'arduino-uno', pins(false)).get('led1'), false);
  });
}

test('an adjacent socket closes the missing return without touching the LED leg', () => {
  const layout = structuredClone(CIRCUIT_SCENARIOS['open-loop'].initialLayout);
  assert.equal(inspectCircuit(layout, scenario).connected, false);
  layout.wires.push(wire('return', hole('d19'), board('P-GND2')));
  assert.equal(inspectCircuit(layout, scenario).passed, true);
});

test('a return on the far side of the trench remains open until a real bridge joins the strips', () => {
  const layout = series();
  layout.wires[2].a = hole('g19');
  assert.equal(inspectCircuit(layout, scenario).connected, false);
  assert.equal(physicalLedStates(layout, 'arduino-uno', pins(true)).get('led1'), false);
  layout.wires.push(wire('trench-bridge', hole('e19'), hole('f19')));
  assert.equal(inspectCircuit(layout, scenario).passed, true);
});

test('continuous power rail can carry a return but the other rail is not implicitly connected', () => {
  const layout = series();
  layout.wires[2] = wire('rail-return', hole('c19'), hole('bottom-:1'));
  layout.wires.push(wire('rail-ground', hole('bottom-:30'), board('P-GND1')));
  assert.equal(inspectCircuit(layout, scenario).passed, true);
  layout.wires[3].a = hole('bottom+:30');
  assert.equal(inspectCircuit(layout, scenario).connected, false);
});

test('moving or lifting a component actually disconnects its old strip, and swapping LED leads reverses polarity', () => {
  const layout = series();
  const led = layout.components[1];
  led.holes = { ANODE: 'a18', CATHODE: 'a20' };
  assert.equal(inspectCircuit(layout, scenario).connected, false);
  led.holes = { ANODE: 'a19', CATHODE: 'a18' };
  assert.equal(inspectCircuit(layout, scenario).connected, true);
  assert.equal(inspectCircuit(layout, scenario).forward, false);
  assert.equal(physicalLedStates(layout, 'arduino-uno', pins(true)).get('led1'), false);
  led.holes = {};
  assert.equal(inspectCircuit(layout, scenario).connected, false);
});

test('copper bypass around a resistor fails even if the resistor remains physically present', () => {
  const layout = series();
  layout.wires.push(wire('bypass', hole('d8'), hole('d13')));
  const inspection = inspectCircuit(layout, scenario);
  assert.equal(inspection.shorted, true);
  assert.equal(inspection.seriesResistor, false);
  assert.equal(inspection.passed, false);
  assert.equal(physicalLedStates(layout, 'arduino-uno', pins(true)).get('led1'), false);
});

test('two resistor leads in one copper strip do not count as a series resistor', () => {
  const layout = series();
  layout.components[0].holes = { A: 'e8', B: 'd8' };
  const inspection = inspectCircuit(layout, scenario);
  assert.equal(inspection.shorted, true);
  assert.equal(inspection.passed, false);
});

test('one socket cannot contain two leads or a lead plus a jumper; adjacent free sockets remain legal', () => {
  const layout = series();
  layout.wires[0].b = hole('e8');
  assert.match(placementIssues(layout).join(' '), /occupied twice/);
  assert.equal(inspectCircuit(layout, scenario).passed, false);
  layout.wires[0].b = hole('b8');
  assert.equal(placementIssues(layout).length, 0);
  assert.equal(inspectCircuit(layout, scenario).passed, true);
});

test('schematic net identity joins copper only, never a resistor body or an LED', () => {
  const layout = series();
  const nets = physicalNets(layout, 'arduino-uno');
  const net = (ref: PinRef) => nets.get(pinRefKey(ref));
  assert.equal(net(board('D8')), net(part('r1', 'A')));
  assert.equal(net(part('r1', 'B')), net(part('led1', 'ANODE')));
  assert.notEqual(net(part('r1', 'A')), net(part('r1', 'B')));
  assert.notEqual(net(part('led1', 'ANODE')), net(part('led1', 'CATHODE')));
  assert.equal(net(part('led1', 'CATHODE')), net(board('D-GND')));
  assert.ok(physicalConnections(layout).length > layout.wires.length);
});

test('restored unknown resistance is not invented or presented as a protected LED path', () => {
  const layout = series(); delete layout.components[0].resistanceOhms;
  assert.equal(inspectCircuit(layout, scenario).currentMa, null);
  assert.equal(physicalLedStates(layout, 'arduino-uno', pins(true)).get('led1'), false);
  const decoded = decodePhysicalLayout(layout, 'arduino-uno');
  assert.ok(decoded); assert.equal(decoded.components[0].resistanceOhms, undefined);
});

test('legacy terminal wires and arbitrary part IDs migrate without changing electrical results', () => {
  const raw: BreadboardLayout = { components: [
    { instanceId: 'old resistor', componentId: 'resistor', x: 16, y: 360, resistanceOhms: 470 },
    { instanceId: 'old LED', componentId: 'led', x: 210, y: 360 },
  ], wires: [wire('s', board('D8'), part('old resistor', 'A')), wire('l', part('old resistor', 'B'), part('old LED', 'ANODE')), wire('g', part('old LED', 'CATHODE'), board('P-GND1'))] };
  const before = structuredClone(raw);
  const migrated = decodeCircuitDraft(scenario, { layout: raw, currentAnswer: '6.38' });
  assert.deepEqual(migrated.layout.wires, before.wires);
  assert.equal(migrated.currentAnswer, '6.38');
  assert.equal(inspectCircuit(migrated.layout, scenario).passed, true);
  assert.equal(inspectCircuit(migrated.layout, scenario).currentMa, inspectCircuit(raw, scenario).currentMa);
  assert.equal(new Set(migrated.layout.components.flatMap(part => Object.values(part.holes ?? {}).map(holeNet))).size, 4);
  assert.deepEqual(raw, before);
  assert.deepEqual(decodePhysicalLayout(migrated.layout, 'arduino-uno'), migrated.layout);
});

test('migration never reuses an existing physical strip for an unrelated old lead', () => {
  const raw: BreadboardLayout = { components: [
    { instanceId: 'already seated', componentId: 'resistor', x: 0, y: 0, resistanceOhms: 330, holes: { A: 'a1', B: 'a2' } },
    { instanceId: 'old LED', componentId: 'led', x: 0, y: 0 },
  ], wires: [wire('existing', board('D8'), hole('c3'))] };
  const migrated = toPhysicalLayout(raw);
  for (const id of Object.values(migrated.components[1].holes ?? {})) assert.ok(!['ae1', 'ae2', 'ae3'].includes(holeNet(id)!));
});

test('legacy duplicate AREF endpoint migrates to the actual analog-reference header, not RESET', () => {
  const raw: BreadboardLayout = { components: [], wires: [wire('old-reference', board('A-AREF'), hole('a1'))] };
  const decoded = decodePhysicalLayout(raw, 'arduino-uno');
  assert.ok(decoded); assert.deepEqual(decoded.wires[0].a, board('D-AREF'));
  assert.equal(boardPinPoint('arduino-uno', 'RESET'), undefined);
});

test('physical layout roundtrip retains wrong wiring, color, routing bends and component seats without shared references', () => {
  const raw = series(); raw.wires[0].a = board('D13'); raw.wires[0].color = '#3b82bb'; raw.wires[0].bends = [{ x: 180, y: 120 }];
  const decoded = decodePhysicalLayout(JSON.parse(JSON.stringify(raw)), 'arduino-uno');
  assert.deepEqual(decoded, raw); assert.ok(decoded);
  decoded.components[0].holes!.A = 'e1'; decoded.wires[0].bends![0].x++;
  assert.equal(raw.components[0].holes!.A, 'e8'); assert.equal(raw.wires[0].bends[0].x, 180);
  assert.equal(inspectCircuit(decoded, scenario).passed, false);
});

for (const [name, mutate] of [
  ['unknown hole', (layout: BreadboardLayout) => { layout.components[0].holes!.A = 'z99'; }],
  ['unknown lead', (layout: BreadboardLayout) => { layout.components[0].holes!.UNKNOWN = 'a1'; }],
  ['unknown endpoint', (layout: BreadboardLayout) => { layout.wires[0].b = hole('A999'); }],
  ['nonfinite bend', (layout: BreadboardLayout) => { layout.wires[0].bends = [{ x: Infinity, y: 10 }]; }],
  ['oversized bend', (layout: BreadboardLayout) => { layout.wires[0].bends = [{ x: 10_001, y: 10 }]; }],
  ['unknown color', (layout: BreadboardLayout) => { layout.wires[0].color = 'url(unsafe)'; }],
] as const) test(`malformed physical data rejects ${name} instead of silently reconnecting it`, () => {
  const layout = series(); mutate(layout);
  assert.equal(decodePhysicalLayout(layout, 'arduino-uno'), null);
  assert.deepEqual(decodeCircuitDraft(scenario, { layout, currentAnswer: '9.09' }), { layout: scenario.initialLayout, currentAnswer: '' });
});

test('new physical circuits keep course progress, drafts and current answers isolated on reload', () => {
  const layout = series();
  const saved = { version: 1, lessonId: 'external-led', stepId: 'exercise', completedSteps: ['first-output/introduction'], drafts: { 'external-led/exercise': 'student sketch' }, predictions: {}, circuits: { 'external-led/exercise': { layout, currentAnswer: '9.09' } } };
  const progress = decodeProgress(arduinoCourse, JSON.stringify(saved));
  assert.deepEqual(progress.circuits['external-led/exercise'].layout, layout);
  assert.equal(progress.drafts['external-led/exercise'], 'student sketch');
  assert.equal(progress.circuits['external-led/exercise'].currentAnswer, '9.09');
  assert.deepEqual(progress.completedSteps, saved.completedSteps);
});

test('power-net safety warnings propagate through breadboard copper, including cross-rail shorts', () => {
  const layout: BreadboardLayout = { version: 2, components: [{ instanceId: 'display', componentId: 'oled-display', x: 600, y: 500, holes: { VCC: 'a1' } }], wires: [wire('power', board('5V'), hole('e1'))] };
  assert.match(connectionWarnings(layout, 'arduino-uno').join(' '), /rated for 3.3 V.*5 V/);
  layout.wires[0].a = board('3V3');
  assert.deepEqual(connectionWarnings(layout, 'arduino-uno'), []);
  layout.wires.push(wire('short', hole('d1'), board('P-GND1')));
  assert.match(connectionWarnings(layout, 'arduino-uno').join(' '), /directly to GND/);
});

test('rendered component endpoints use the exact occupied hole coordinates; header order matches the physical Uno', () => {
  const layout = series();
  assert.deepEqual(componentPinPoint(layout.components[0], 'A'), holePoint('e8'));
  assert.deepEqual(componentPinPoint(layout.components[1], 'CATHODE'), holePoint('a19'));
  assert.ok(boardPinPoint('arduino-uno', 'D13')!.x < boardPinPoint('arduino-uno', 'D8')!.x);
  assert.ok(boardPinPoint('arduino-uno', 'D8')!.x < boardPinPoint('arduino-uno', 'RX')!.x);
  assert.ok(boardPinPoint('arduino-uno', 'A0')!.x < boardPinPoint('arduino-uno', 'A5')!.x);
  assert.ok(boardPinPoint('arduino-uno', '3V3')!.x < boardPinPoint('arduino-uno', 'VIN')!.x);
});

test('Uno R3 duplicate I2C and voltage-reference headers share actual board copper', () => {
  const layout = series();
  const nets = physicalNets(layout, 'arduino-uno');
  for (const [a, b] of [['SDA', 'A4'], ['SCL', 'A5'], ['IOREF', '5V']]) {
    assert.equal(nets.get(pinRefKey(board(a))), nets.get(pinRefKey(board(b))));
    assert.notDeepEqual(boardPinPoint('arduino-uno', a), boardPinPoint('arduino-uno', b));
  }
  layout.wires[0].a = board('SDA');
  const aliasScenario = { ...scenario, outputPin: 18 };
  assert.equal(inspectCircuit(layout, aliasScenario).passed, true);
  const levels = pins(false); levels[18] = 1;
  assert.equal(physicalLedStates(layout, 'arduino-uno', levels).get('led1'), true);
});

test('a supply short through IOREF propagates to the actual 5V net', () => {
  const layout: BreadboardLayout = { version: 2, components: [], wires: [wire('short', board('IOREF'), board('P-GND1'))] };
  assert.match(connectionWarnings(layout, 'arduino-uno').join(' '), /directly to GND/);
});

for (const source of ['D9', '5V', 'IOREF']) test(`an additional direct ${source} path cannot borrow another source’s resistor protection`, () => {
  const layout = series();
  const levels = pins(true); levels[9] = 1;
  assert.equal(physicalLedStates(layout, 'arduino-uno', levels).get('led1'), true);
  layout.wires.push(wire('unprotected-source', board(source), hole('d18')));
  assert.equal(placementIssues(layout).length, 0);
  assert.equal(physicalLedStates(layout, 'arduino-uno', levels).get('led1'), false);
});

test('known board supply powers a protected free-bench circuit without fabricated GPIO output', () => {
  const layout = series(); layout.wires[0].a = board('5V');
  assert.equal(physicalLedStates(layout, 'arduino-uno', pins(false)).get('led1'), true);
  layout.wires = layout.wires.filter(wire => wire.id !== 'return');
  assert.equal(physicalLedStates(layout, 'arduino-uno', pins(false)).get('led1'), false);
});

test('module explanation renders every physical terminal and follows actual shared-net changes', () => {
  const layout: BreadboardLayout = { version: 2, components: [{ instanceId: 'display', componentId: 'oled-display', x: 600, y: 200, holes: { VCC: 'a1', GND: 'a2', SDA: 'a3', SCL: 'a4' } }], wires: [
    wire('v', board('3V3'), hole('e1')), wire('g', board('P-GND1'), hole('e2')),
    wire('d', board('A4'), hole('e3')), wire('c', board('A5'), hole('e4')),
  ] };
  const render = () => renderToStaticMarkup(createElement(BenchSchematic, { layout, boardKey: 'arduino-uno', onSelectPart: assert.fail, onSelectWire: assert.fail }));
  const terminalNet = (markup: string, terminal: string) => {
    const match = markup.match(new RegExp(`data-terminal="${terminal}" data-net-number="(\\d+)"`));
    assert.ok(match, `Missing port connection for ${terminal}`);
    return match[1];
  };
  const initial = render();
  for (const terminal of ['VCC', 'GND', 'SDA', 'SCL']) terminalNet(initial, terminal);
  assert.notEqual(terminalNet(initial, 'SDA'), terminalNet(initial, 'SCL'));
  layout.wires.push(wire('bridge-data-clock', hole('b3'), hole('b4')));
  const bridged = render();
  assert.equal(terminalNet(bridged, 'SDA'), terminalNet(bridged, 'SCL'));
});
