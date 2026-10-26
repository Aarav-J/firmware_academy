import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, rm } from 'node:fs/promises';
import { compileArduino } from '../server/stm32-build/arduino';
import { projectTempDirectory } from '../server/stm32-build/storage';
import { assessExercise } from '../src/learning/assessment';
import { arduinoCourse } from '../src/learning/course';
import type { CircuitDraft } from '../src/learning/circuit-types';
import type { ExerciseStep, WorkbenchObservation } from '../src/learning/types';
import { ATmega328PSimulation, parseIntelHex } from '../src/simulator/avr-engine';
import { pinTransitions, retainPinTrace } from '../src/trace';
import type { TraceEvent } from '../src/contracts';

function exerciseFor(lessonId: string): ExerciseStep {
  const lesson = arduinoCourse.units.flatMap(unit => unit.lessons).find(lesson => lesson.id === lessonId);
  assert.ok(lesson, `Course lesson ${lessonId} must exist`);
  const exercise = lesson.steps.find(step => step.kind === 'exercise');
  assert.ok(exercise?.kind === 'exercise', `Course lesson ${lessonId} must have an exercise`);
  return exercise;
}

async function createSimulation(source: string): Promise<ATmega328PSimulation> {
  const directory = await projectTempDirectory('request');
  try {
    const { elfPath, hexPath } = await compileArduino(directory, source);
    const elf = await readFile(elfPath);
    assert.equal(elf.subarray(0, 4).toString('hex'), '7f454c46');
    const hex = await readFile(hexPath, 'utf8');
    return new ATmega328PSimulation(parseIntelHex(hex));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function observe(simulation: ATmega328PSimulation, targetUs: number): WorkbenchObservation {
  let trace: TraceEvent[] = [];
  const startupTrace: TraceEvent[] = [];
  let frame = simulation.frame();
  const deadline = performance.now() + 19_000;
  while (frame.timeUs < targetUs && performance.now() < deadline) {
    simulation.step(targetUs, 10);
    frame = simulation.frame();
    for (const event of frame.events) {
      if (startupTrace.length >= 16) break;
      if (event.type === 'pin' && event.pin === 13) startupTrace.push(event);
    }
    trace = retainPinTrace(trace, frame.events, frame.timeUs);
  }
  assert.ok(frame.timeUs >= targetUs, `AVR core stalled at ${frame.timeUs} us before ${targetUs} us`);
  return { built: true, state: 'paused', timeUs: frame.timeUs, pins: frame.pins, trace, startupTrace };
}

function assertAllGoalsPass(exercise: ExerciseStep, observation: WorkbenchObservation): void {
  const results = assessExercise(exercise, observation);
  assert.deepEqual(results.map(result => result.id), exercise.goals.map(goal => goal.id));
  for (const result of results) assert.equal(result.passed, true, `${result.id}: ${result.detail}`);
}

test('first-output exercise accepts a real compiled sketch that holds D13 HIGH', async () => {
  const simulation = await createSimulation(`void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, HIGH);
}

void loop() {}
`);
  const observation = observe(simulation, 1_200_000);
  assert.equal(observation.pins[13], 1);
  assertAllGoalsPass(exerciseFor('first-output'), observation);
});

test('output-state exercise retains real startup evidence after the rolling trace expires', async () => {
  const simulation = await createSimulation(`void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, HIGH);
  delay(1000);
  digitalWrite(LED_BUILTIN, LOW);
}

void loop() {}
`);
  const observation = observe(simulation, 6_200_000);
  const exercise = exerciseFor('output-state');
  assert.ok(observation.timeUs > 6_000_000);
  assert.equal(observation.pins[13], 0);
  assert.deepEqual(pinTransitions(observation.startupTrace ?? [], 13).map(edge => edge.level), [1, 0]);
  assert.deepEqual(pinTransitions(observation.trace, 13).map(edge => edge.level), [0]);
  assertAllGoalsPass(exercise, observation);

  const withoutStartup = assessExercise(exercise, { ...observation, startupTrace: undefined });
  const outputGoal = exercise.goals.find(goal => goal.rule === 'delayed-low');
  assert.ok(outputGoal);
  assert.equal(withoutStartup.find(result => result.id === outputGoal.id)?.passed, false,
    'The expired rolling trace alone cannot prove the startup HIGH interval');
});

test('blink-timing exercise accepts real 250 ms HIGH and 750 ms LOW AVR output', async () => {
  const simulation = await createSimulation(`void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(250);
  digitalWrite(LED_BUILTIN, LOW);
  delay(750);
}
`);
  assertAllGoalsPass(exerciseFor('blink-timing'), observe(simulation, 3_200_000));
});

test('blink-timing exercise rejects reversed duty cycle even though the real sketch builds', async () => {
  const simulation = await createSimulation(`void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(750);
  digitalWrite(LED_BUILTIN, LOW);
  delay(250);
}
`);
  const exercise = exerciseFor('blink-timing');
  const observation = observe(simulation, 3_200_000);
  const results = assessExercise(exercise, observation);
  const buildGoal = exercise.goals.find(goal => goal.rule === 'build');
  const outputGoal = exercise.goals.find(goal => goal.rule === 'timed-blink');
  assert.ok(buildGoal);
  assert.ok(outputGoal);
  assert.equal(results.find(result => result.id === buildGoal.id)?.passed, true);
  assert.equal(results.find(result => result.id === outputGoal.id)?.passed, false,
    'A matching blink period cannot substitute for the requested HIGH/LOW durations');
});

function externalLedDraft(exercise: ExerciseStep): CircuitDraft {
  assert.ok(exercise.hardware, 'The external LED exercise must provide its actual circuit scenario');
  return {
    currentAnswer: '',
    layout: {
      version: 2,
      components: structuredClone(exercise.hardware.initialLayout.components),
      wires: [
        {
          id: 'external-source',
          a: { kind: 'board', pinId: `D${exercise.hardware.outputPin}` },
          b: { kind: 'breadboard', pinId: 'b8' },
          status: 'ok',
        },
        {
          id: 'external-led',
          a: { kind: 'breadboard', pinId: 'b13' },
          b: { kind: 'breadboard', pinId: 'b18' },
          status: 'ok',
        },
        {
          id: 'external-ground',
          a: { kind: 'breadboard', pinId: 'b19' },
          b: { kind: 'board', pinId: 'P-GND1' },
          status: 'ok',
        },
      ],
    },
  };
}

function blinkSketch(pin: number, highMs: number, lowMs: number): string {
  return `void setup() {
  pinMode(${pin}, OUTPUT);
}

void loop() {
  digitalWrite(${pin}, HIGH);
  delay(${highMs});
  digitalWrite(${pin}, LOW);
  delay(${lowMs});
}
`;
}

function assertExternalLedGoals(
  exercise: ExerciseStep,
  observation: WorkbenchObservation,
  wiringPasses: boolean,
  timingPasses: boolean,
  context: string,
): void {
  const results = assessExercise(exercise, observation);
  const expected = [
    ['build', true],
    ['circuit-wiring', wiringPasses],
    ['timed-blink', timingPasses],
  ] as const;
  for (const [rule, passed] of expected) {
    const goal = exercise.goals.find(goal => goal.rule === rule);
    assert.ok(goal, `The external LED exercise must include the ${rule} goal`);
    const result = results.find(result => result.id === goal.id);
    assert.ok(result, `${context}: missing ${rule} assessment`);
    assert.equal(result.passed, passed, `${context}: ${rule}: ${result.detail}`);
  }
}

test('external-led exercise separates actual circuit faults from correct compiled D8 timing', async () => {
  const exercise = exerciseFor('external-led');
  assert.ok(exercise.signal, 'Use the actual exercise signal target, not the built-in LED defaults');
  const { pin, highMs, lowMs } = exercise.signal;
  const simulation = await createSimulation(blinkSketch(pin, highMs, lowMs));
  const observation = observe(simulation, 3_200_000);
  const circuit = externalLedDraft(exercise);
  assert.ok(pinTransitions(observation.trace, pin).length >= 5, 'The compiled output must produce repeated transitions on the exercise pin');
  assertAllGoalsPass(exercise, { ...observation, circuit });

  const missingGround: CircuitDraft = {
    ...circuit,
    layout: { ...circuit.layout, wires: circuit.layout.wires.filter(wire => wire.id !== 'external-ground') },
  };
  const reversedLed: CircuitDraft = {
    ...circuit,
    layout: {
      ...circuit.layout,
      components: circuit.layout.components.map(component => component.componentId === 'led'
        ? { ...component, holes: { ANODE: 'a19', CATHODE: 'a18' } }
        : component),
    },
  };
  const bypassedResistor: CircuitDraft = {
    ...circuit,
    layout: {
      ...circuit.layout,
      wires: [...circuit.layout.wires, {
        id: 'resistor-bypass',
        a: { kind: 'breadboard', pinId: 'c8' },
        b: { kind: 'breadboard', pinId: 'c13' },
        status: 'ok',
      }],
    },
  };
  const liftedCathode: CircuitDraft = {
    ...circuit,
    layout: { ...circuit.layout, components: circuit.layout.components.map(component => component.componentId === 'led'
      ? { ...component, holes: { ANODE: 'a18' } }
      : component) },
  };
  const wrongTrenchSide: CircuitDraft = {
    ...circuit,
    layout: { ...circuit.layout, wires: circuit.layout.wires.map(wire => wire.id === 'external-ground'
      ? { ...wire, a: { kind: 'breadboard', pinId: 'g19' } }
      : wire) },
  };
  for (const [label, faultyCircuit] of [
    ['missing ground', missingGround],
    ['reversed LED', reversedLed],
    ['bypassed resistor', bypassedResistor],
    ['lifted cathode lead', liftedCathode],
    ['return across unbridged center trench', wrongTrenchSide],
  ] as const) {
    assertExternalLedGoals(exercise, { ...observation, circuit: faultyCircuit }, false, true, label);
  }

  const rewiredCircuit = externalLedDraft(exercise);
  assertAllGoalsPass(exercise, { ...observation, circuit: rewiredCircuit });
  const unsafeResistor: CircuitDraft = {
    ...rewiredCircuit,
    layout: {
      ...rewiredCircuit.layout,
      components: rewiredCircuit.layout.components.map(component => component.componentId === 'resistor'
        ? { ...component, resistanceOhms: 100 }
        : component),
    },
  };
  assertExternalLedGoals(exercise, { ...observation, circuit: unsafeResistor }, false, true, '100-ohm resistor after valid rewiring');
  assertAllGoalsPass(exercise, { ...observation, circuit: externalLedDraft(exercise) });
});

test('external-led exercise rejects real D13 blink output despite valid D8 wiring', async () => {
  const exercise = exerciseFor('external-led');
  assert.ok(exercise.signal);
  const { pin, highMs, lowMs } = exercise.signal;
  const simulation = await createSimulation(blinkSketch(13, highMs, lowMs));
  const observation = observe(simulation, 3_200_000);
  assert.ok(pinTransitions(observation.trace, 13).length >= 5, 'The wrong pin really is blinking');
  assert.equal(pinTransitions(observation.trace, pin).filter(edge => edge.level === 1).length, 0,
    'The required external output must have no HIGH pulses');
  assertExternalLedGoals(exercise, { ...observation, circuit: externalLedDraft(exercise) }, true, false, 'D13 is not the required output');
});

test('external-led exercise rejects compiled D8 reversed duty cycle despite valid wiring', async () => {
  const exercise = exerciseFor('external-led');
  assert.ok(exercise.signal);
  const { pin, highMs, lowMs } = exercise.signal;
  const simulation = await createSimulation(blinkSketch(pin, lowMs, highMs));
  const observation = observe(simulation, 3_200_000);
  assert.ok(pinTransitions(observation.trace, pin).length >= 5, 'The required output really is blinking');
  assertExternalLedGoals(exercise, { ...observation, circuit: externalLedDraft(exercise) }, true, false,
    'The correct period cannot substitute for 250 ms HIGH and 750 ms LOW');
});
