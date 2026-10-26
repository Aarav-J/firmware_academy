import assert from 'node:assert/strict';
import test from 'node:test';
import { arduinoCourse } from '../src/learning/course';
import { assessExercise } from '../src/learning/assessment';
import { courseLessons, decodeProgress, initialProgress, lessonComplete, resumeStep } from '../src/learning/progress';
import { CIRCUIT_SCENARIOS } from '../src/learning/circuit-model';
import type { CircuitDraft, CircuitScenario } from '../src/learning/circuit-types';
import { stepKey } from '../src/learning/types';
import type { ExerciseStep, GoalRule, Lesson, PredictStep, WorkbenchObservation } from '../src/learning/types';
import type { TraceEvent } from '../src/contracts';

const lessons = courseLessons(arduinoCourse);

function lessonById(id: string): Lesson {
  const lesson = lessons.find(item => item.id === id);
  assert.ok(lesson, `Missing course lesson ${id}`);
  return lesson;
}

function exerciseFor(lesson: Lesson): ExerciseStep {
  const exercise = lesson.steps.find(step => step.kind === 'exercise');
  assert.ok(exercise?.kind === 'exercise');
  return exercise;
}

function predictionFor(lesson: Lesson): PredictStep {
  const prediction = lesson.steps.find(step => step.kind === 'predict');
  assert.ok(prediction?.kind === 'predict');
  return prediction;
}

const firstLesson = lessonById('first-output');
const outputLesson = lessonById('output-state');
const blinkLesson = lessonById('blink-timing');
const steadyExercise = exerciseFor(firstLesson);
const delayedExercise = exerciseFor(outputLesson);
const blinkExercise = exerciseFor(blinkLesson);

const circuitLessons = arduinoCourse.units.find(unit => unit.id === 'connect-a-circuit')!.lessons;

function circuitActivityFor(lesson: Lesson) {
  const activity = lesson.steps.find(step => step.kind === 'circuit');
  assert.ok(activity?.kind === 'circuit');
  return activity;
}

function circuitDraftFor(scenario: CircuitScenario, currentAnswer = ''): CircuitDraft {
  return { layout: structuredClone(scenario.initialLayout), currentAnswer };
}

function pin(timeUs: number, level: 0 | 1, number = 13): TraceEvent {
  return { type: 'pin', timeUs, pin: number, level };
}

function observation(trace: TraceEvent[], timeUs: number, level: 0 | 1): WorkbenchObservation {
  const pins = Array<number>(20).fill(0);
  pins[13] = level;
  return { built: true, state: 'running', timeUs, pins, trace };
}

function passed(step: ExerciseStep, rule: GoalRule, evidence: WorkbenchObservation | null): boolean {
  const goal = step.goals.find(item => item.rule === rule);
  assert.ok(goal, `Missing exercise rule ${rule}`);
  const result = assessExercise(step, evidence).find(item => item.id === goal.id);
  assert.ok(result, `Missing assessment for ${rule}`);
  return result.passed;
}

function blinkTrace(highUs = 250_000, lowUs = 750_000): TraceEvent[] {
  const start = 1_000;
  const period = highUs + lowUs;
  return [
    pin(0, 0),
    pin(start, 1),
    pin(start + highUs, 0),
    pin(start + period, 1),
    pin(start + period + highUs, 0),
    pin(start + 2 * period, 1),
  ];
}

test('initial progress starts at the first available lesson and step without sharing mutable state', () => {
  const progress = initialProgress(arduinoCourse);
  assert.equal(progress.lessonId, lessons[0].id);
  assert.equal(progress.stepId, lessons[0].steps[0].id);
  assert.equal(progress.completedSteps.length, 0);
  assert.deepEqual(progress.drafts, {});
  assert.deepEqual(progress.predictions, {});

  progress.completedSteps.push(stepKey(firstLesson.id, firstLesson.steps[0].id));
  progress.drafts[stepKey(firstLesson.id, steadyExercise.id)] = 'changed draft';
  const prediction = predictionFor(firstLesson);
  progress.predictions[stepKey(firstLesson.id, prediction.id)] = prediction.answerId;
  const fresh = initialProgress(arduinoCourse);
  assert.deepEqual(fresh.completedSteps, []);
  assert.deepEqual(fresh.drafts, {});
  assert.deepEqual(fresh.predictions, {});
});

test('progress decoding safely resets absent, malformed, primitive, and incompatible storage', () => {
  const fallback = initialProgress(arduinoCourse);
  for (const raw of [null, '', '{', 'null', 'false', '42', '"saved"', '[]', '{}', '{"version":0}', '{"version":2}', '{"version":"1"}']) {
    assert.deepEqual(decodeProgress(arduinoCourse, raw), fallback, `Unexpected progress for ${raw}`);
  }
});

test('progress decoding rejects wrong field types without discarding a valid selected lesson', () => {
  for (const invalidRecord of [null, [], 'draft text', 123, false]) {
    const progress = decodeProgress(arduinoCourse, JSON.stringify({
      version: 1,
      lessonId: outputLesson.id,
      stepId: { id: 'exercise' },
      completedSteps: 'output-state/introduction',
      drafts: invalidRecord,
      predictions: invalidRecord,
    }));
    assert.equal(progress.lessonId, outputLesson.id);
    assert.equal(progress.stepId, outputLesson.steps[0].id);
    assert.deepEqual(progress.completedSteps, []);
    assert.deepEqual(progress.drafts, {});
    assert.deepEqual(progress.predictions, {});
  }

  const progress = decodeProgress(arduinoCourse, JSON.stringify({ version: 1, lessonId: [], stepId: 123 }));
  assert.deepEqual(progress, initialProgress(arduinoCourse));
});

test('stale lesson and step IDs fall back to real course locations', () => {
  const staleLesson = decodeProgress(arduinoCourse, JSON.stringify({ version: 1, lessonId: 'removed-lesson', stepId: 'removed-step' }));
  assert.equal(staleLesson.lessonId, lessons[0].id);
  assert.equal(staleLesson.stepId, lessons[0].steps[0].id);

  const staleStep = decodeProgress(arduinoCourse, JSON.stringify({ version: 1, lessonId: blinkLesson.id, stepId: 'removed-step' }));
  assert.equal(staleStep.lessonId, blinkLesson.id);
  assert.equal(staleStep.stepId, blinkLesson.steps[0].id);
});

test('progress decoding filters invalid completed keys and deduplicates valid lesson-qualified keys', () => {
  const firstKey = stepKey(firstLesson.id, steadyExercise.id);
  const otherKey = stepKey(outputLesson.id, delayedExercise.id);
  assert.notEqual(firstKey, otherKey);
  const progress = decodeProgress(arduinoCourse, JSON.stringify({
    ...initialProgress(arduinoCourse),
    completedSteps: [firstKey, firstKey, otherKey, 'exercise', 'removed-lesson/exercise', `${firstLesson.id}/removed-step`, null, 42, {}],
  }));
  assert.deepEqual(progress.completedSteps, [firstKey, otherKey]);
});

test('progress decoding preserves independent exercise drafts and removes invalid draft entries', () => {
  const firstKey = stepKey(firstLesson.id, steadyExercise.id);
  const outputKey = stepKey(outputLesson.id, delayedExercise.id);
  const blinkKey = stepKey(blinkLesson.id, blinkExercise.id);
  const drafts = { [firstKey]: 'void setup() { /* steady */ }', [outputKey]: 'void setup() { /* one shot */ }', [blinkKey]: '' };
  const progress = decodeProgress(arduinoCourse, JSON.stringify({
    ...initialProgress(arduinoCourse),
    drafts: {
      ...drafts,
      [stepKey(firstLesson.id, firstLesson.steps[0].id)]: 'not an exercise',
      'removed-lesson/exercise': 'stale code',
      [`${firstLesson.id}/removed-step`]: 'stale step',
    },
  }));
  assert.deepEqual(progress.drafts, drafts);

  progress.drafts[firstKey] = 'edited independently';
  assert.equal(progress.drafts[outputKey], drafts[outputKey]);
  assert.equal(progress.drafts[blinkKey], '');
  assert.deepEqual(decodeProgress(arduinoCourse, JSON.stringify(progress)).drafts, progress.drafts);

  const invalidValue = decodeProgress(arduinoCourse, JSON.stringify({ ...progress, drafts: { [firstKey]: 42, [outputKey]: null, [blinkKey]: ['code'] } }));
  assert.deepEqual(invalidValue.drafts, {});
});

test('progress decoding retains valid prediction choices including wrong answers and filters invalid choices', () => {
  const firstPrediction = predictionFor(firstLesson);
  const outputPrediction = predictionFor(outputLesson);
  const blinkPrediction = predictionFor(blinkLesson);
  const wrongChoice = firstPrediction.options.find(option => option.id !== firstPrediction.answerId);
  assert.ok(wrongChoice);
  const firstKey = stepKey(firstLesson.id, firstPrediction.id);
  const outputKey = stepKey(outputLesson.id, outputPrediction.id);
  const blinkKey = stepKey(blinkLesson.id, blinkPrediction.id);
  const progress = decodeProgress(arduinoCourse, JSON.stringify({
    ...initialProgress(arduinoCourse),
    predictions: {
      [firstKey]: wrongChoice.id,
      [outputKey]: outputPrediction.answerId,
      [blinkKey]: outputPrediction.answerId,
      [stepKey(firstLesson.id, steadyExercise.id)]: firstPrediction.answerId,
      'removed-lesson/predict': firstPrediction.answerId,
    },
  }));
  assert.deepEqual(progress.predictions, { [firstKey]: wrongChoice.id, [outputKey]: outputPrediction.answerId });
  const invalid = decodeProgress(arduinoCourse, JSON.stringify({ ...progress, predictions: { [firstKey]: null, [outputKey]: 1, [blinkKey]: {} } }));
  assert.deepEqual(invalid.predictions, {});
});

test('resuming prefers a valid saved step even if it was already completed', () => {
  const progress = { ...initialProgress(arduinoCourse), lessonId: outputLesson.id, stepId: delayedExercise.id, completedSteps: [stepKey(outputLesson.id, delayedExercise.id)] };
  assert.equal(resumeStep(outputLesson, progress), delayedExercise.id);
});

test('resuming another lesson or a stale step chooses its first incomplete step, then the first when complete', () => {
  const [first, second] = outputLesson.steps;
  assert.ok(second);
  const progress = { ...initialProgress(arduinoCourse), completedSteps: [stepKey(outputLesson.id, first.id)] };
  assert.equal(resumeStep(outputLesson, progress), second.id);
  assert.equal(resumeStep(outputLesson, { ...progress, lessonId: outputLesson.id, stepId: 'removed-step' }), second.id);
  const completed = { ...progress, completedSteps: outputLesson.steps.map(step => stepKey(outputLesson.id, step.id)) };
  assert.equal(resumeStep(outputLesson, completed), first.id);
});

test('a lesson completes only when all of its own steps are completed', () => {
  const keys = firstLesson.steps.map(step => stepKey(firstLesson.id, step.id));
  const progress = initialProgress(arduinoCourse);
  assert.equal(lessonComplete(firstLesson, progress), false);
  for (const omitted of keys) {
    assert.equal(lessonComplete(firstLesson, { ...progress, completedSteps: keys.filter(key => key !== omitted) }), false);
  }
  assert.equal(lessonComplete(firstLesson, { ...progress, completedSteps: keys }), true);
  assert.equal(lessonComplete(outputLesson, { ...progress, completedSteps: keys }), false);
});

test('assessments reject absent evidence and unbuilt sketches even when stale traces look correct', () => {
  const fixtures: [ExerciseStep, WorkbenchObservation][] = [
    [steadyExercise, observation([pin(1_000, 1)], 2_000_000, 1)],
    [delayedExercise, observation([pin(1_000, 1), pin(1_001_000, 0)], 2_001_000, 0)],
    [blinkExercise, observation(blinkTrace(), 2_001_000, 1)],
  ];
  for (const [exercise, evidence] of fixtures) {
    assert.ok(assessExercise(exercise, evidence).every(result => result.passed));
    assert.ok(assessExercise(exercise, null).every(result => !result.passed));
    assert.ok(assessExercise(exercise, { ...evidence, built: false }).every(result => !result.passed));
  }
});

test('successful compilation alone cannot satisfy output goals in inactive or error runtimes', () => {
  const fixtures: [ExerciseStep, GoalRule, WorkbenchObservation][] = [
    [steadyExercise, 'steady-high', observation([pin(1_000, 1)], 2_000_000, 1)],
    [delayedExercise, 'delayed-low', observation([pin(1_000, 1), pin(1_001_000, 0)], 2_001_000, 0)],
    [blinkExercise, 'timed-blink', observation(blinkTrace(), 2_001_000, 1)],
  ];
  for (const [exercise, rule, evidence] of fixtures) {
    for (const state of ['ready', 'idle', 'error', 'stopped']) {
      const inactive = { ...evidence, state };
      assert.equal(passed(exercise, 'build', inactive), true);
      assert.equal(passed(exercise, rule, inactive), false, `${rule} accepted ${state}`);
    }
    assert.equal(passed(exercise, rule, { ...evidence, state: 'paused' }), true);
  }
});

test('steady HIGH requires a full second since the latest HIGH transition and a currently HIGH pin', () => {
  const start = 1_000;
  assert.equal(passed(steadyExercise, 'steady-high', observation([pin(start, 1)], start + 999_999, 1)), false);
  assert.equal(passed(steadyExercise, 'steady-high', observation([pin(start, 1)], start + 1_000_000, 1)), true);
  assert.equal(passed(steadyExercise, 'steady-high', observation([pin(start, 1)], start + 2_000_000, 0)), false);
  assert.equal(passed(steadyExercise, 'steady-high', observation([], start + 2_000_000, 1)), false);
  assert.equal(passed(steadyExercise, 'steady-high', observation([pin(start, 1), pin(1_500_000, 0)], 3_000_000, 1)), false);
  assert.equal(passed(steadyExercise, 'steady-high', observation([pin(start, 1), pin(1_100_000, 0), pin(1_200_000, 1)], 2_000_000, 1)), false);
  assert.equal(passed(steadyExercise, 'steady-high', observation([pin(start, 1, 12)], 2_000_000, 1)), false);
});

test('one-shot output requires a startup rise, a one-second HIGH, and a full second observed LOW', () => {
  const start = 1_000;
  const fall = start + 1_000_000;
  const trace = [pin(start, 1), pin(fall, 0)];
  assert.equal(passed(delayedExercise, 'delayed-low', observation(trace, fall + 999_999, 0)), false);
  assert.equal(passed(delayedExercise, 'delayed-low', observation(trace, fall + 1_000_000, 0)), true);
  assert.equal(passed(delayedExercise, 'delayed-low', observation(trace, fall + 1_000_000, 1)), false);
  assert.equal(passed(delayedExercise, 'delayed-low', observation([pin(100_000, 1), pin(1_100_000, 0)], 3_000_000, 0)), false);
  assert.equal(passed(delayedExercise, 'delayed-low', observation([pin(0, 0)], 3_000_000, 0)), false);
  assert.equal(passed(delayedExercise, 'delayed-low', observation([pin(start, 1)], 3_000_000, 0)), false);
});

test('one-shot output enforces the duration tolerance and rejects repeated flashes', () => {
  const start = 1_000;
  for (const duration of [950_000, 1_000_000, 1_050_000]) {
    assert.equal(passed(delayedExercise, 'delayed-low', observation([pin(start, 1), pin(start + duration, 0)], 3_000_000, 0)), true);
  }
  for (const duration of [949_999, 1_050_001, 500_000, 2_000_000]) {
    assert.equal(passed(delayedExercise, 'delayed-low', observation([pin(start, 1), pin(start + duration, 0)], 4_000_000, 0)), false);
  }
  const repeated = [pin(start, 1), pin(start + 1_000_000, 0), pin(start + 2_000_000, 1), pin(start + 3_000_000, 0)];
  assert.equal(passed(delayedExercise, 'delayed-low', observation(repeated, 5_000_000, 0)), false);
});

test('preserved startup evidence grades old one-shot events absent from the rolling trace', () => {
  const startupTrace = [pin(1_000, 1), pin(1_001_000, 0)];
  const recent = observation([pin(1_001_000, 0), pin(9_000_000, 1, 12)], 10_000_000, 0);
  assert.equal(passed(delayedExercise, 'delayed-low', recent), false);
  assert.equal(passed(delayedExercise, 'delayed-low', { ...recent, startupTrace }), true);
  const repeatedStartup = [...startupTrace, pin(2_001_000, 1), pin(3_001_000, 0)];
  assert.equal(passed(delayedExercise, 'delayed-low', { ...recent, startupTrace: repeatedStartup }), false);
});

test('blink needs two complete HIGH and LOW cycles, not elapsed time or a partial second cycle', () => {
  const trace = blinkTrace();
  for (const partial of [[], trace.slice(0, 2), trace.slice(0, 4), trace.slice(0, 5)]) {
    assert.equal(passed(blinkExercise, 'timed-blink', observation(partial, 10_000_000, 0)), false);
  }
  assert.equal(passed(blinkExercise, 'timed-blink', observation(trace, 2_001_000, 1)), true);
});

test('blink checks each HIGH and LOW interval rather than accepting a correct total period with wrong duty', () => {
  for (const [highUs, lowUs] of [[500_000, 500_000], [750_000, 250_000], [250_000, 500_000], [500_000, 750_000]]) {
    assert.equal(passed(blinkExercise, 'timed-blink', observation(blinkTrace(highUs, lowUs), 4_000_000, 1)), false);
  }
  const inconsistent = [...blinkTrace(), pin(2_501_000, 0), pin(3_001_000, 1)];
  assert.equal(passed(blinkExercise, 'timed-blink', observation(inconsistent, 3_001_000, 1)), false);
});

test('blink applies five-percent tolerance independently to both interval durations', () => {
  for (const [highUs, lowUs] of [[237_500, 712_500], [262_500, 787_500], [250_000, 750_000]]) {
    assert.equal(passed(blinkExercise, 'timed-blink', observation(blinkTrace(highUs, lowUs), 1_000 + 2 * (highUs + lowUs), 1)), true);
  }
  for (const [highUs, lowUs] of [[237_499, 750_000], [262_501, 750_000], [250_000, 712_499], [250_000, 787_501]]) {
    assert.equal(passed(blinkExercise, 'timed-blink', observation(blinkTrace(highUs, lowUs), 1_000 + 2 * (highUs + lowUs), 1)), false);
  }
});

test('blink rejects a correct sequence that stops changing and mismatched current pin levels', () => {
  const highTrace = blinkTrace();
  const lowTrace = [...highTrace, pin(2_251_000, 0)];
  assert.equal(passed(blinkExercise, 'timed-blink', observation(lowTrace, 10_000_000, 0)), false);
  assert.equal(passed(blinkExercise, 'timed-blink', observation(highTrace, 2_001_000, 0)), false);
  assert.equal(passed(blinkExercise, 'timed-blink', observation(lowTrace, 2_251_000, 1)), false);
});

test('blink allows the current partial interval through its tolerance boundary but not beyond it', () => {
  const highTrace = blinkTrace();
  const highStart = 2_001_000;
  assert.equal(passed(blinkExercise, 'timed-blink', observation(highTrace, highStart + 262_500, 1)), true);
  assert.equal(passed(blinkExercise, 'timed-blink', observation(highTrace, highStart + 262_501, 1)), false);

  const lowStart = highStart + 250_000;
  const lowTrace = [...highTrace, pin(lowStart, 0)];
  assert.equal(passed(blinkExercise, 'timed-blink', observation(lowTrace, lowStart + 787_500, 0)), true);
  assert.equal(passed(blinkExercise, 'timed-blink', observation(lowTrace, lowStart + 787_501, 0)), false);
});

test('initial progress gives circuit work its own fresh record without populating untouched activities', () => {
  const progress = initialProgress(arduinoCourse);
  const fresh = initialProgress(arduinoCourse);
  assert.equal(Object.keys(progress.circuits).length, 0);
  assert.notEqual(progress.circuits, fresh.circuits);
  const lesson = lessonById('complete-the-path');
  const activity = circuitActivityFor(lesson);
  const key = stepKey(lesson.id, activity.id);
  progress.circuits[key] = circuitDraftFor(CIRCUIT_SCENARIOS['open-loop'], 'unfinished');
  assert.equal(fresh.circuits[key], undefined);
  assert.equal(Object.keys(progress.drafts).length, 0);
  assert.deepEqual(fresh.circuits, {});
});

test('progress decoding rejects malformed circuit records while retaining the selected circuit activity and other progress', () => {
  const lesson = lessonById('choose-a-resistor');
  const activity = circuitActivityFor(lesson);
  const prediction = predictionFor(lesson);
  const key = stepKey(lesson.id, activity.id);
  const sourceKey = stepKey(firstLesson.id, steadyExercise.id);
  const predictionKey = stepKey(lesson.id, prediction.id);
  for (const circuits of [null, [], 'circuit data', 123, false]) {
    const progress = decodeProgress(arduinoCourse, JSON.stringify({
      version: 1,
      lessonId: lesson.id,
      stepId: activity.id,
      completedSteps: [key],
      drafts: { [sourceKey]: steadyExercise.starterCode },
      predictions: { [predictionKey]: prediction.answerId },
      circuits,
    }));
    assert.equal(progress.lessonId, lesson.id);
    assert.equal(progress.stepId, activity.id);
    assert.deepEqual(progress.completedSteps, [key]);
    assert.deepEqual(progress.drafts, { [sourceKey]: steadyExercise.starterCode });
    assert.deepEqual(progress.predictions, { [predictionKey]: prediction.answerId });
    assert.deepEqual(progress.circuits, {});
  }
});

test('circuit drafts restore topology, resistor choices, placement, and current answers under lesson-qualified activity keys', () => {
  const pathLesson = lessonById('complete-the-path');
  const directionLesson = lessonById('led-direction');
  const resistorLesson = lessonById('choose-a-resistor');
  const pathActivity = circuitActivityFor(pathLesson);
  const directionActivity = circuitActivityFor(directionLesson);
  const resistorActivity = circuitActivityFor(resistorLesson);
  assert.equal(pathActivity.id, directionActivity.id);
  assert.equal(directionActivity.id, resistorActivity.id);
  const pathKey = stepKey(pathLesson.id, pathActivity.id);
  const directionKey = stepKey(directionLesson.id, directionActivity.id);
  const resistorKey = stepKey(resistorLesson.id, resistorActivity.id);
  const pathDraft = circuitDraftFor(CIRCUIT_SCENARIOS['open-loop'], 'not calculated');
  const directionDraft = circuitDraftFor(CIRCUIT_SCENARIOS['reversed-led']);
  const resistorDraft = circuitDraftFor(CIRCUIT_SCENARIOS['choose-resistor'], '6.38 mA');
  pathDraft.layout.wires.push(structuredClone(CIRCUIT_SCENARIOS['choose-resistor'].initialLayout.wires[2]));
  const resistor = resistorDraft.layout.components.find(component => component.componentId === 'resistor');
  assert.ok(resistor);
  resistor.resistanceOhms = 470;
  resistor.x = 184;
  resistor.y = 246;
  const expected = { [pathKey]: pathDraft, [directionKey]: directionDraft, [resistorKey]: resistorDraft };
  const progress = decodeProgress(arduinoCourse, JSON.stringify({
    ...initialProgress(arduinoCourse),
    lessonId: resistorLesson.id,
    stepId: resistorActivity.id,
    circuits: {
      ...expected,
      activity: pathDraft,
      'removed-lesson/activity': pathDraft,
      [stepKey(pathLesson.id, 'removed-step')]: pathDraft,
      [stepKey(pathLesson.id, pathLesson.steps[0].id)]: pathDraft,
      [stepKey(pathLesson.id, predictionFor(pathLesson).id)]: pathDraft,
      [stepKey(firstLesson.id, steadyExercise.id)]: pathDraft,
    },
  }));
  assert.deepEqual(progress.circuits, expected);
  assert.deepEqual(decodeProgress(arduinoCourse, JSON.stringify(progress)).circuits, expected);
  progress.circuits[pathKey].layout.wires[0].a.pinId = 'D7';
  progress.circuits[pathKey].layout.components[0].x = 400;
  progress.circuits[pathKey].currentAnswer = 'changed only here';
  assert.deepEqual(progress.circuits[directionKey], directionDraft);
  assert.deepEqual(progress.circuits[resistorKey], resistorDraft);
  assert.equal(pathDraft.layout.wires[0].a.pinId, 'D8');
  assert.equal(CIRCUIT_SCENARIOS['open-loop'].initialLayout.wires.length, 2);
  assert.equal(CIRCUIT_SCENARIOS['choose-resistor'].initialLayout.components[0].resistanceOhms, 100);
});

test('one malformed circuit draft resets only that activity and never discards other saved work', () => {
  const pathLesson = lessonById('complete-the-path');
  const resistorLesson = lessonById('choose-a-resistor');
  const pathActivity = circuitActivityFor(pathLesson);
  const resistorActivity = circuitActivityFor(resistorLesson);
  const pathKey = stepKey(pathLesson.id, pathActivity.id);
  const resistorKey = stepKey(resistorLesson.id, resistorActivity.id);
  const prediction = predictionFor(resistorLesson);
  const predictionKey = stepKey(resistorLesson.id, prediction.id);
  const sourceKey = stepKey(outputLesson.id, delayedExercise.id);
  const validDraft = circuitDraftFor(CIRCUIT_SCENARIOS['choose-resistor'], '30 mA; still too high');
  const badWire = circuitDraftFor(CIRCUIT_SCENARIOS['open-loop']);
  badWire.layout.wires[0].a.pinId = 'missing-pin';
  const badResistance = circuitDraftFor(CIRCUIT_SCENARIOS['open-loop']);
  badResistance.layout.components[0].resistanceOhms = -330;
  const malformedDrafts = [null, [], 42, {}, { layout: pathActivity.scenario.initialLayout, currentAnswer: 9 },
    { layout: { components: [], wires: 'not wires' }, currentAnswer: '' }, badWire, badResistance];
  for (const malformed of malformedDrafts) {
    const progress = decodeProgress(arduinoCourse, JSON.stringify({
      ...initialProgress(arduinoCourse),
      lessonId: resistorLesson.id,
      stepId: resistorActivity.id,
      completedSteps: [resistorKey],
      drafts: { [sourceKey]: delayedExercise.starterCode },
      predictions: { [predictionKey]: prediction.answerId },
      circuits: { [pathKey]: malformed, [resistorKey]: validDraft },
    }));
    assert.equal(progress.lessonId, resistorLesson.id);
    assert.equal(progress.stepId, resistorActivity.id);
    assert.deepEqual(progress.completedSteps, [resistorKey]);
    assert.deepEqual(progress.drafts, { [sourceKey]: delayedExercise.starterCode });
    assert.deepEqual(progress.predictions, { [predictionKey]: prediction.answerId });
    assert.deepEqual(progress.circuits[pathKey], circuitDraftFor(CIRCUIT_SCENARIOS['open-loop']));
    assert.deepEqual(progress.circuits[resistorKey], validDraft);
    progress.circuits[pathKey].layout.components[0].resistanceOhms = 1000;
    progress.circuits[pathKey].layout.wires[0].a.pinId = 'D7';
    assert.deepEqual(progress.circuits[resistorKey], validDraft);
    assert.equal(CIRCUIT_SCENARIOS['open-loop'].initialLayout.components[0].resistanceOhms, 330);
    assert.equal(CIRCUIT_SCENARIOS['open-loop'].initialLayout.wires[0].a.pinId, 'D8');
  }
});

test('legacy version-one storage without circuits retains source drafts, completions, prediction choices, and resume location', () => {
  const prediction = predictionFor(blinkLesson);
  const wrongAnswer = prediction.options.find(option => option.id !== prediction.answerId);
  assert.ok(wrongAnswer);
  const sourceKey = stepKey(blinkLesson.id, blinkExercise.id);
  const predictionKey = stepKey(blinkLesson.id, prediction.id);
  const legacy = {
    version: 1,
    lessonId: blinkLesson.id,
    stepId: blinkExercise.id,
    completedSteps: firstLesson.steps.map(step => stepKey(firstLesson.id, step.id)),
    drafts: { [sourceKey]: `${blinkExercise.starterCode}\n// preserved learner edit` },
    predictions: { [predictionKey]: wrongAnswer.id },
  };
  const progress = decodeProgress(arduinoCourse, JSON.stringify(legacy));
  assert.deepEqual(progress, { ...legacy, circuits: {} });
  assert.equal(resumeStep(blinkLesson, progress), blinkExercise.id);
  assert.equal(lessonComplete(firstLesson, progress), true);
  for (const lesson of circuitLessons) assert.equal(lessonComplete(lesson, progress), false);
});

test('external output keeps its hardware and source drafts independent from activities and excludes free-project data', () => {
  const externalLesson = lessonById('external-led');
  const externalExercise = exerciseFor(externalLesson);
  const activityLesson = lessonById('choose-a-resistor');
  const activity = circuitActivityFor(activityLesson);
  const exerciseKey = stepKey(externalLesson.id, externalExercise.id);
  const activityKey = stepKey(activityLesson.id, activity.id);
  assert.equal(externalExercise.hardware, CIRCUIT_SCENARIOS['external-led']);
  const hardware = circuitDraftFor(CIRCUIT_SCENARIOS['external-led'], '9.09');
  hardware.layout.wires = structuredClone(CIRCUIT_SCENARIOS['choose-resistor'].initialLayout.wires);
  const activityDraft = circuitDraftFor(CIRCUIT_SCENARIOS['choose-resistor'], '30');
  const source = `${externalExercise.starterCode}\n// saved external LED work`;
  const progress = decodeProgress(arduinoCourse, JSON.stringify({
    ...initialProgress(arduinoCourse),
    lessonId: externalLesson.id,
    stepId: externalExercise.id,
    drafts: { [exerciseKey]: source, [activityKey]: 'not a source exercise', 'free-project/exercise': 'unrelated source' },
    circuits: { [exerciseKey]: hardware, [activityKey]: activityDraft, 'free-project/exercise': hardware },
    freeProjects: { unrelated: { source: 'private free-project source', layout: hardware.layout } },
  }));
  assert.deepEqual(progress.drafts, { [exerciseKey]: source });
  assert.deepEqual(progress.circuits, { [exerciseKey]: hardware, [activityKey]: activityDraft });
  assert.equal(Object.hasOwn(progress, 'freeProjects'), false);
  progress.drafts[exerciseKey] = 'void setup() {}\nvoid loop() {}';
  assert.deepEqual(progress.circuits[exerciseKey], hardware);
  progress.circuits[exerciseKey].layout.wires.pop();
  progress.circuits[exerciseKey].currentAnswer = 'unfinished again';
  assert.equal(progress.drafts[exerciseKey], 'void setup() {}\nvoid loop() {}');
  assert.deepEqual(progress.circuits[activityKey], activityDraft);
  const restored = decodeProgress(arduinoCourse, JSON.stringify(progress));
  assert.deepEqual(restored.circuits, progress.circuits);
  assert.deepEqual(restored.drafts, progress.drafts);
  assert.equal(resumeStep(externalLesson, restored), externalExercise.id);
});

test('circuit lessons resume saved activities or exercises, otherwise their own first incomplete step', () => {
  for (const lesson of circuitLessons) {
    const practical = lesson.steps.find(step => step.kind === 'circuit' || step.kind === 'exercise');
    assert.ok(practical);
    const beforePractical = lesson.steps.filter(step => step.id !== practical.id).map(step => stepKey(lesson.id, step.id));
    const progress = decodeProgress(arduinoCourse, JSON.stringify({
      ...initialProgress(arduinoCourse), lessonId: lesson.id, stepId: practical.id, completedSteps: beforePractical,
    }));
    assert.equal(resumeStep(lesson, progress), practical.id);
    assert.equal(resumeStep(lesson, { ...progress, lessonId: firstLesson.id }), practical.id);
    assert.equal(resumeStep(lesson, { ...progress, stepId: 'removed-step' }), practical.id);
    const complete = { ...progress, completedSteps: [...beforePractical, stepKey(lesson.id, practical.id)] };
    assert.equal(resumeStep(lesson, complete), practical.id);
    assert.equal(resumeStep(lesson, { ...complete, stepId: 'removed-step' }), lesson.steps[0].id);
    assert.equal(resumeStep(lesson, { ...complete, lessonId: firstLesson.id }), lesson.steps[0].id);
  }
});

test('circuit lessons remain incomplete until every own step is marked, not merely their practical or another lesson', () => {
  for (const lesson of circuitLessons) {
    const keys = lesson.steps.map(step => stepKey(lesson.id, step.id));
    const otherKeys = lessons.filter(other => other.id !== lesson.id).flatMap(other => other.steps.map(step => stepKey(other.id, step.id)));
    const practical = lesson.steps.find(step => step.kind === 'circuit' || step.kind === 'exercise');
    assert.ok(practical);
    const progress = initialProgress(arduinoCourse);
    assert.equal(lessonComplete(lesson, progress), false);
    assert.equal(lessonComplete(lesson, { ...progress, completedSteps: [...otherKeys, stepKey(lesson.id, practical.id)] }), false);
    for (const omitted of keys) {
      const partial = { ...progress, completedSteps: [...otherKeys, ...keys.filter(key => key !== omitted)] };
      assert.equal(lessonComplete(lesson, partial), false, `${lesson.id} must still require ${omitted}`);
    }
    assert.equal(lessonComplete(lesson, { ...progress, completedSteps: keys }), true);
  }
});

test('legacy terminal circuits migrate to physical seats while retaining wrong outputs and unrelated learning progress', () => {
  const key = stepKey('external-led', 'exercise');
  const circuit = circuitDraftFor(CIRCUIT_SCENARIOS['external-led'], 'unfinished calculation');
  delete circuit.layout.version;
  for (const component of circuit.layout.components) delete component.holes;
  circuit.layout.wires = [
    { id: 'wrong-output', a: { kind: 'board', pinId: 'D13' }, b: { kind: 'component', instanceId: 'r1', pinId: 'A' }, status: 'ok' },
    { id: 'middle', a: { kind: 'component', instanceId: 'r1', pinId: 'B' }, b: { kind: 'component', instanceId: 'led1', pinId: 'ANODE' }, status: 'ok' },
    { id: 'return', a: { kind: 'component', instanceId: 'led1', pinId: 'CATHODE' }, b: { kind: 'board', pinId: 'P-GND1' }, status: 'ok' },
  ];
  const completed = [stepKey('first-output', 'introduction')];
  const progress = decodeProgress(arduinoCourse, JSON.stringify({
    ...initialProgress(arduinoCourse), lessonId: 'external-led', stepId: 'exercise',
    completedSteps: completed, drafts: { [key]: 'saved firmware' }, circuits: { [key]: circuit },
  }));
  assert.equal(progress.circuits[key].layout.version, 2);
  assert.ok(progress.circuits[key].layout.components.every(component => Object.keys(component.holes ?? {}).length === 2));
  assert.deepEqual(progress.circuits[key].layout.wires, circuit.layout.wires);
  assert.equal(progress.circuits[key].layout.wires[0].a.pinId, 'D13');
  assert.equal(progress.circuits[key].currentAnswer, 'unfinished calculation');
  assert.equal(progress.drafts[key], 'saved firmware');
  assert.deepEqual(progress.completedSteps, completed);
  assert.equal(resumeStep(lessonById('external-led'), progress), 'exercise');
});
