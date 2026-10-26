import assert from 'node:assert/strict';
import test from 'node:test';
import type { BreadboardLayout, PinRef, Wire } from '../src/breadboard-contracts';
import { assessCircuit, CIRCUIT_SCENARIOS, decodeCircuitDraft, inspectCircuit } from '../src/learning/circuit-model';
import type { CircuitDraft, CircuitGoalRule, CircuitInspection } from '../src/learning/circuit-types';
import type { CircuitStep } from '../src/learning/types';

const scenario = CIRCUIT_SCENARIOS['external-led'];
const board = (pinId: string): PinRef => ({ kind: 'board', pinId });
const part = (instanceId: string, pinId: string): PinRef => ({ kind: 'component', instanceId, pinId });
const wire = (id: string, a: PinRef, b: PinRef): Wire => ({ id, a, b, status: 'ok' });

function seriesLayout(options: {
  afterLed?: boolean;
  swapLegs?: boolean;
  reversed?: boolean;
  ground?: string;
  source?: string;
  resistorId?: string;
  ledId?: string;
  resistance?: number;
} = {}): BreadboardLayout {
  const resistorId = options.resistorId ?? 'resistor-under-test';
  const ledId = options.ledId ?? 'led-under-test';
  const resistorIn = part(resistorId, options.swapLegs ? 'B' : 'A');
  const resistorOut = part(resistorId, options.swapLegs ? 'A' : 'B');
  const ledIn = part(ledId, options.reversed ? 'CATHODE' : 'ANODE');
  const ledOut = part(ledId, options.reversed ? 'ANODE' : 'CATHODE');
  const source = board(options.source ?? 'D8');
  const ground = board(options.ground ?? 'P-GND1');
  return {
    version: 2,
    components: [
      { instanceId: resistorId, componentId: 'resistor', x: 20, y: 30, resistanceOhms: options.resistance ?? 330 },
      { instanceId: ledId, componentId: 'led', x: 80, y: 90 },
    ],
    wires: options.afterLed
      ? [wire('source', source, ledIn), wire('middle', ledOut, resistorIn), wire('return', resistorOut, ground)]
      : [wire('source', source, resistorIn), wire('middle', resistorOut, ledIn), wire('return', ledOut, ground)],
  };
}

function circuitStep(rule: CircuitGoalRule): CircuitStep {
  return {
    id: 'graph-assessment', kind: 'circuit', title: 'Circuit assessment', paragraphs: [], hints: [], scenario,
    goals: [{ id: rule, label: rule, rule }],
  };
}

function goalPassed(rule: CircuitGoalRule, layout: BreadboardLayout, currentAnswer = ''): boolean {
  const results = assessCircuit(circuitStep(rule), { layout, currentAnswer });
  const result = results.find(item => item.id === rule);
  assert.ok(result);
  return result.passed;
}

function assertProtected(inspection: CircuitInspection, expectedCurrent = 3000 / 330): void {
  assert.equal(inspection.connected, true);
  assert.equal(inspection.forward, true);
  assert.equal(inspection.seriesResistor, true);
  assert.equal(inspection.shorted, false);
  assert.equal(inspection.safeCurrent, true);
  assert.equal(inspection.passed, true);
  assert.ok(inspection.currentMa !== null);
  assert.ok(Math.abs(inspection.currentMa - expectedCurrent) < 1e-10);
}

function assertNoCurrent(inspection: CircuitInspection): void {
  assert.equal(inspection.currentMa, null);
  assert.equal(inspection.safeCurrent, false);
  assert.equal(inspection.passed, false);
}

for (const [id, connected, forward, seriesResistor, shorted, currentMa] of [
  ['open-loop', false, false, false, false, null],
  ['reversed-led', true, false, true, false, null],
  ['choose-resistor', true, true, true, false, 30],
  ['external-led', false, false, false, false, null],
] as const) {
  test(`scenario ${id} seeds its actual electrical fault`, () => {
    const fixture = CIRCUIT_SCENARIOS[id];
    const inspection = inspectCircuit(fixture.initialLayout, fixture);
    assert.equal(inspection.connected, connected);
    assert.equal(inspection.forward, forward);
    assert.equal(inspection.seriesResistor, seriesResistor);
    assert.equal(inspection.shorted, shorted);
    assert.equal(inspection.currentMa, currentMa);
    assert.equal(inspection.safeCurrent, false);
    assert.equal(inspection.passed, false);
  });
}

test('closing the missing ground wire passes the first circuit without changing any parts', () => {
  const fixture = CIRCUIT_SCENARIOS['open-loop'];
  const draft = decodeCircuitDraft(fixture, null);
  assert.equal(inspectCircuit(draft.layout, fixture).connected, false);
  draft.layout.wires.push(wire('close-loop', part('led1', 'CATHODE'), board('P-GND1')));
  assertProtected(inspectCircuit(draft.layout, fixture));
  const step = { ...circuitStep('complete-path'), scenario: fixture };
  assert.equal(assessCircuit(step, draft)[0].passed, true);
  assert.equal(inspectCircuit(fixture.initialLayout, fixture).connected, false);
});

for (const afterLed of [false, true]) {
  for (const swapLegs of [false, true]) {
    for (const ground of ['P-GND1', 'P-GND2', 'D-GND']) {
      for (const arbitraryIds of [false, true]) {
        test(`series circuit accepts resistor ${afterLed ? 'after' : 'before'} LED, legs ${swapLegs ? 'swapped' : 'normal'}, ${ground}, ${arbitraryIds ? 'arbitrary' : 'ordinary'} IDs`, () => {
          const layout = seriesLayout({
            afterLed, swapLegs, ground,
            resistorId: arbitraryIds ? 'part resistor / 42' : 'r1',
            ledId: arbitraryIds ? 'light:beta-7' : 'led1',
          });
          const inspection = inspectCircuit(layout, scenario);
          assertProtected(inspection);
          assert.deepEqual(inspection.path[0], board('D8'));
          assert.deepEqual(inspection.path.at(-1), board(ground));
          const anode = inspection.path.findIndex(ref => ref.kind === 'component' && ref.pinId === 'ANODE');
          const cathode = inspection.path.findIndex(ref => ref.kind === 'component' && ref.pinId === 'CATHODE');
          assert.ok(anode >= 0 && cathode > anode);
          assert.equal(goalPassed('series-resistor', layout), true);
        });
      }
    }
  }
}

test('wire direction, wire ordering, component ordering, and parallel copies do not change a valid circuit', () => {
  const layout = seriesLayout();
  const expected = inspectCircuit(layout, scenario);
  layout.components.reverse();
  layout.wires = layout.wires.reverse().map(connection => ({ ...connection, a: connection.b, b: connection.a }));
  layout.wires.push({ ...layout.wires[0], id: 'same-net-parallel-copy' });
  const actual = inspectCircuit(layout, scenario);
  assertProtected(actual);
  assert.equal(actual.currentMa, expected.currentMa);
  assert.deepEqual(actual.path, expected.path);
});

for (const missing of ['source', 'middle', 'return']) {
  test(`removing the ${missing} wire opens the path and removes the current estimate`, () => {
    const layout = seriesLayout();
    layout.wires = layout.wires.filter(connection => connection.id !== missing);
    const inspection = inspectCircuit(layout, scenario);
    assert.equal(inspection.connected, false);
    assert.equal(inspection.forward, false);
    assert.equal(inspection.seriesResistor, false);
    assert.deepEqual(inspection.path, []);
    assertNoCurrent(inspection);
    assert.equal(goalPassed('complete-path', layout), false);
    assert.equal(goalPassed('current-calculation', layout, '9.09'), false);
  });
}

for (const afterLed of [false, true]) {
  test(`reversed LED ${afterLed ? 'before' : 'after'} resistor stays closed but fails polarity and has no current estimate`, () => {
    const layout = seriesLayout({ afterLed, reversed: true });
    const inspection = inspectCircuit(layout, scenario);
    assert.equal(inspection.connected, true);
    assert.equal(inspection.forward, false);
    assert.equal(inspection.seriesResistor, true);
    assert.equal(inspection.shorted, false);
    assertNoCurrent(inspection);
    assert.equal(goalPassed('led-forward', layout), false);
    assert.equal(goalPassed('current-calculation', layout, '9.09'), false);
  });
}

for (const source of ['D7', 'D13', '5V', '3V3', 'VIN', 'A0']) {
  test(`using ${source} instead of the selected D8 source fails`, () => {
    const inspection = inspectCircuit(seriesLayout({ source }), scenario);
    assert.equal(inspection.connected, false);
    assertNoCurrent(inspection);
  });
  test(`adding a ${source} connection rejects an otherwise valid D8 circuit`, () => {
    const layout = seriesLayout();
    layout.wires.push(wire('unwanted-board-pin', board(source), layout.wires[0].b));
    assertNoCurrent(inspectCircuit(layout, scenario));
  });
}

for (const [name, endpoint] of [
  ['unknown board pin', board('D99')],
  ['unknown component instance', part('missing-instance', 'A')],
  ['unknown component leg', part('resistor-under-test', 'NOT-A-LEG')],
] as const) {
  test(`${name} invalidates even an otherwise valid circuit`, () => {
    const layout = seriesLayout();
    layout.wires.push(wire('invalid-reference', board('D8'), endpoint));
    assertNoCurrent(inspectCircuit(layout, scenario));
  });
}

for (const componentId of ['resistor', 'led', 'temp-sensor', 'unknown-part']) {
  test(`an extra ${componentId} is rejected even when disconnected from a valid path`, () => {
    const layout = seriesLayout();
    layout.components.push({ instanceId: 'extra-instance', componentId, x: 100, y: 100, resistanceOhms: 330 });
    assertNoCurrent(inspectCircuit(layout, scenario));
  });
}

for (const duplicate of ['component', 'wire']) {
  test(`duplicate ${duplicate} identity cannot pass a valid-looking circuit`, () => {
    const layout = seriesLayout();
    if (duplicate === 'component') layout.components[1].instanceId = layout.components[0].instanceId;
    else layout.wires[1].id = layout.wires[0].id;
    assertNoCurrent(inspectCircuit(layout, scenario));
  });
}

for (const [name, a, b] of [
  ['parallel resistor bypass', part('resistor-under-test', 'A'), part('resistor-under-test', 'B')],
  ['LED short', part('led-under-test', 'ANODE'), part('led-under-test', 'CATHODE')],
  ['source to ground short', board('D8'), board('P-GND2')],
] as const) {
  test(`${name} rejects a circuit even while all original series wires remain`, () => {
    const layout = seriesLayout();
    assertProtected(inspectCircuit(layout, scenario));
    layout.wires.push(wire('unsafe-parallel-route', a, b));
    const inspection = inspectCircuit(layout, scenario);
    assert.equal(inspection.shorted, true);
    assert.equal(inspection.seriesResistor, false);
    assertNoCurrent(inspection);
    assert.equal(goalPassed('series-resistor', layout), false);
    assert.equal(goalPassed('safe-current', layout), false);
  });
}

test('a direct unprotected LED path cannot pass merely because a resistor exists elsewhere', () => {
  const layout = seriesLayout();
  layout.wires = [
    wire('source', board('D8'), part('led-under-test', 'ANODE')),
    wire('return', part('led-under-test', 'CATHODE'), board('P-GND1')),
  ];
  const inspection = inspectCircuit(layout, scenario);
  assert.equal(inspection.connected, true);
  assert.equal(inspection.forward, true);
  assert.equal(inspection.shorted, true);
  assert.equal(inspection.seriesResistor, false);
  assertNoCurrent(inspection);
});

test('a closed LED path without any resistor cannot pass', () => {
  const layout = seriesLayout();
  layout.components = layout.components.filter(component => component.componentId !== 'resistor');
  layout.wires = [wire('source', board('D8'), part('led-under-test', 'ANODE')), layout.wires[2]];
  const inspection = inspectCircuit(layout, scenario);
  assert.equal(inspection.seriesResistor, false);
  assertNoCurrent(inspection);
});

for (const resistance of [undefined, 0, -330, NaN, Infinity, -Infinity]) {
  test(`resistance ${String(resistance)} is not a valid explicit current-limiting value`, () => {
    const layout = seriesLayout();
    layout.components[0].resistanceOhms = resistance;
    const inspection = inspectCircuit(layout, scenario);
    assert.equal(inspection.connected, true);
    assert.equal(inspection.forward, true);
    assert.equal(inspection.resistanceOhms, null);
    assert.equal(inspection.seriesResistor, false);
    assertNoCurrent(inspection);
  });
}

for (const [resistance, expectedCurrent, safe] of [
  [100, 30, false], [220, 150 / 11, false], [330, 100 / 11, true],
  [470, 300 / 47, true], [1000, 3, true], [10_000, 0.3, false],
] as const) {
  test(`${resistance} ohms estimates ${expectedCurrent} mA and ${safe ? 'passes' : 'fails'} the safe range`, () => {
    const layout = seriesLayout({ resistance });
    const inspection = inspectCircuit(layout, scenario);
    assert.equal(inspection.connected, true);
    assert.equal(inspection.forward, true);
    assert.equal(inspection.seriesResistor, true);
    assert.equal(inspection.shorted, false);
    assert.equal(inspection.resistanceOhms, resistance);
    assert.ok(inspection.currentMa !== null);
    assert.ok(Math.abs(inspection.currentMa - expectedCurrent) < 1e-10);
    assert.equal(inspection.safeCurrent, safe);
    assert.equal(inspection.passed, safe);
    assert.equal(goalPassed('safe-current', layout), safe);
  });
}

test('finite positive resistance too small for a finite estimate fails safely', () => {
  const inspection = inspectCircuit(seriesLayout({ resistance: Number.MIN_VALUE }), scenario);
  assert.equal(inspection.resistanceOhms, Number.MIN_VALUE);
  assertNoCurrent(inspection);
});

for (const answer of ['', '   ', 'not a number', '9.09 mA', '9,09', 'Infinity', '-Infinity', 'NaN', '1e999', '0x9', '0', '9.20', '8.98']) {
  test(`current calculation rejects ${JSON.stringify(answer)}`, () => {
    assert.equal(goalPassed('current-calculation', seriesLayout(), answer), false);
  });
}

for (const answer of ['9.09', ' 9.09 ', '+9.09', '9.09e0', String(100 / 11), String(100 / 11 - 0.1), String(100 / 11 + 0.1)]) {
  test(`current calculation accepts ${JSON.stringify(answer)} within inclusive 0.1 mA tolerance`, () => {
    assert.equal(goalPassed('current-calculation', seriesLayout(), answer), true);
  });
}

for (const delta of [-0.10001, 0.10001]) {
  test(`current calculation rejects an error of ${delta} mA just outside tolerance`, () => {
    assert.equal(goalPassed('current-calculation', seriesLayout(), String(100 / 11 + delta)), false);
  });
}

function draft(layout = seriesLayout()): CircuitDraft {
  return { layout, currentAnswer: 'student answer unchanged' };
}

for (const id of ['open-loop', 'reversed-led', 'choose-resistor', 'external-led'] as const) {
  test(`decoder preserves and deeply clones the valid ${id} student mistake`, () => {
    const fixture = CIRCUIT_SCENARIOS[id];
    const raw = draft(structuredClone(fixture.initialLayout));
    const before = structuredClone(raw);
    const decoded = decodeCircuitDraft(fixture, raw);
    assert.deepEqual(decoded, before);
    assert.deepEqual(raw, before);
    assert.notStrictEqual(decoded.layout, raw.layout);
    assert.notStrictEqual(decoded.layout.components, raw.layout.components);
    assert.notStrictEqual(decoded.layout.wires, raw.layout.wires);
    assert.notStrictEqual(decoded.layout.components[0], raw.layout.components[0]);
    if (raw.layout.wires.length) {
      assert.notStrictEqual(decoded.layout.wires[0], raw.layout.wires[0]);
      assert.notStrictEqual(decoded.layout.wires[0].a, raw.layout.wires[0].a);
      assert.notStrictEqual(decoded.layout.wires[0].b, raw.layout.wires[0].b);
      decoded.layout.wires[0].a.pinId = 'mutated-only-in-result';
    }
    decoded.layout.components[0].x += 1;
    assert.deepEqual(raw, before);
    assert.deepEqual(fixture.initialLayout, before.layout);
  });
}

test('decoding preserves shorts, wrong source, overvoltage markers, and disconnected valid parts for assessment', () => {
  const raw = draft(seriesLayout({ source: 'D13', resistance: 100 }));
  raw.layout.wires.push(wire('short', board('D13'), board('P-GND1')));
  raw.layout.wires[0].status = 'overvoltage';
  raw.layout.components.push({ instanceId: 'sensor', componentId: 'temp-sensor', x: -20, y: 40 });
  const before = structuredClone(raw);
  const decoded = decodeCircuitDraft(scenario, raw);
  assert.deepEqual(decoded, before);
  assert.equal(inspectCircuit(decoded.layout, scenario).passed, false);
  assert.deepEqual(raw, before);
});

for (const resistance of [1, 17.5, 100, 220, 1e12, Number.MIN_VALUE]) {
  test(`decoder preserves arbitrary positive ${resistance} ohms instead of correcting unsafe student work`, () => {
    const raw = draft(seriesLayout({ resistance }));
    const decoded = decodeCircuitDraft(scenario, raw);
    assert.deepEqual(decoded, raw);
    const inspection = inspectCircuit(decoded.layout, scenario);
    assert.equal(inspection.resistanceOhms, resistance);
    assert.equal(inspection.safeCurrent, false);
    assert.equal(inspection.passed, false);
  });
}

const malformedDrafts: [string, () => unknown][] = [
  ['null', () => null],
  ['array', () => []],
  ['primitive', () => 'saved draft'],
  ['missing layout', () => ({ currentAnswer: '' })],
  ['array layout', () => ({ layout: [], currentAnswer: '' })],
  ['missing answer', () => ({ layout: seriesLayout() })],
  ['nonnumeric answer field', () => ({ layout: seriesLayout(), currentAnswer: 9.09 })],
  ['oversized answer', () => ({ layout: seriesLayout(), currentAnswer: '9'.repeat(201) })],
  ['nonarray components', () => ({ layout: { components: {}, wires: [] }, currentAnswer: '' })],
  ['nonarray wires', () => ({ layout: { components: [], wires: {} }, currentAnswer: '' })],
  ['null component', () => { const raw = draft(); return { ...raw, layout: { ...raw.layout, components: [null] } }; }],
  ['unknown component type', () => { const raw = draft(); raw.layout.components[0].componentId = 'missing-type'; return raw; }],
  ['empty instance ID', () => { const raw = draft(); raw.layout.components[0].instanceId = ' '; return raw; }],
  ['oversized instance ID', () => { const raw = draft(); raw.layout.components[0].instanceId = 'r'.repeat(101); return raw; }],
  ['duplicate component ID', () => { const raw = draft(); raw.layout.components[1].instanceId = raw.layout.components[0].instanceId; return raw; }],
  ['null wire', () => { const raw = draft(); return { ...raw, layout: { ...raw.layout, wires: [null] } }; }],
  ['empty wire ID', () => { const raw = draft(); raw.layout.wires[0].id = ''; return raw; }],
  ['oversized wire ID', () => { const raw = draft(); raw.layout.wires[0].id = 'w'.repeat(101); return raw; }],
  ['duplicate wire ID', () => { const raw = draft(); raw.layout.wires[1].id = raw.layout.wires[0].id; return raw; }],
  ['unknown wire status', () => { const raw = draft(); return { ...raw, layout: { ...raw.layout, wires: [{ ...raw.layout.wires[0], status: 'unknown' }] } }; }],
  ['null endpoint', () => { const raw = draft(); return { ...raw, layout: { ...raw.layout, wires: [{ ...raw.layout.wires[0], a: null }] } }; }],
  ['unknown endpoint kind', () => { const raw = draft(); return { ...raw, layout: { ...raw.layout, wires: [{ ...raw.layout.wires[0], a: { kind: 'unknown', pinId: 'D8' } }] } }; }],
  ['unknown board endpoint', () => { const raw = draft(); raw.layout.wires[0].a = board('D99'); return raw; }],
  ['unknown instance endpoint', () => { const raw = draft(); raw.layout.wires[0].b = part('missing', 'A'); return raw; }],
  ['unknown leg endpoint', () => { const raw = draft(); raw.layout.wires[0].b = part('resistor-under-test', 'ANODE'); return raw; }],
  ['too many parts', () => { const raw = draft(); raw.layout.components = Array.from({ length: 33 }, (_, i) => ({ instanceId: `r-${i}`, componentId: 'resistor', x: 0, y: 0 })); return raw; }],
  ['too many wires', () => { const raw = draft(); raw.layout.wires = Array.from({ length: 129 }, (_, i) => wire(`wire-${i}`, board('D8'), board('P-GND1'))); return raw; }],
];

for (const [name, makeRaw] of malformedDrafts) {
  test(`decoder safely resets ${name} without mutating input or sharing fallback objects`, () => {
    const fixture = CIRCUIT_SCENARIOS['open-loop'];
    const raw = makeRaw();
    const before = structuredClone(raw);
    const first = decodeCircuitDraft(fixture, raw);
    const second = decodeCircuitDraft(fixture, raw);
    assert.deepEqual(first, { layout: fixture.initialLayout, currentAnswer: '' });
    assert.deepEqual(second, first);
    assert.deepEqual(raw, before);
    first.layout.components[0].x += 1;
    first.layout.wires[0].a.pinId = 'changed-fallback';
    assert.notDeepEqual(first, second);
    assert.deepEqual(second, { layout: fixture.initialLayout, currentAnswer: '' });
  });
}

for (const axis of ['x', 'y'] as const) {
  for (const value of [NaN, Infinity, -Infinity, 10_001, -10_001]) {
    test(`decoder rejects ${axis}=${String(value)} outside the finite position bounds`, () => {
      const raw = draft();
      raw.layout.components[0][axis] = value;
      assert.deepEqual(decodeCircuitDraft(scenario, raw), { layout: scenario.initialLayout, currentAnswer: '' });
      assert.ok(Object.is(raw.layout.components[0][axis], value));
    });
  }
}

for (const resistance of [0, -1, NaN, Infinity, -Infinity, '330']) {
  test(`decoder safely resets invalid persisted resistance ${String(resistance)}`, () => {
    const raw = draft();
    const malformed = {
      ...raw,
      layout: { ...raw.layout, components: [{ ...raw.layout.components[0], resistanceOhms: resistance }, raw.layout.components[1]] },
    };
    assert.deepEqual(decodeCircuitDraft(scenario, malformed), { layout: scenario.initialLayout, currentAnswer: '' });
    assert.ok(Object.is(malformed.layout.components[0].resistanceOhms, resistance));
  });
}

test('decoder accepts finite position boundaries and the answer length boundary without clamping', () => {
  const raw = draft();
  raw.layout.components[0].x = -10_000;
  raw.layout.components[0].y = 10_000;
  raw.layout.components[1].x = 10_000;
  raw.layout.components[1].y = -10_000;
  raw.currentAnswer = '9'.repeat(200);
  assert.deepEqual(decodeCircuitDraft(scenario, raw), raw);
});

test('decoder keeps missing resistance as a student mistake rather than inventing a current estimate', () => {
  const raw = draft();
  delete raw.layout.components[0].resistanceOhms;
  const decoded = decodeCircuitDraft(scenario, raw);
  assert.deepEqual(decoded, raw);
  assertNoCurrent(inspectCircuit(decoded.layout, scenario));
});

test('inspection and assessment do not mutate the graph, scenario, or answer', () => {
  const raw = draft();
  const before = structuredClone(raw);
  const scenarioBefore = structuredClone(scenario);
  inspectCircuit(raw.layout, scenario);
  for (const rule of ['complete-path', 'led-forward', 'series-resistor', 'safe-current', 'current-calculation'] as const) {
    assessCircuit(circuitStep(rule), raw);
  }
  assert.deepEqual(raw, before);
  assert.deepEqual(scenario, scenarioBefore);
});
