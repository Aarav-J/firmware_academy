import type { Course, LearningProgress, Lesson } from './types';
import { stepKey } from './types';
import { decodeCircuitDraft } from './circuit-model';
import type { CircuitDraft } from './circuit-types';

type NormalizedProgress = LearningProgress & { circuits: Record<string, CircuitDraft> };

export const PROGRESS_STORAGE_KEY = 'firmware-academy:learning:arduino:v1';

export function courseLessons(course: Course): Lesson[] {
  return course.units.flatMap(unit => unit.lessons);
}

export function initialProgress(course: Course): NormalizedProgress {
  const lesson = courseLessons(course)[0];
  return { version: 1, lessonId: lesson.id, stepId: lesson.steps[0].id, completedSteps: [], drafts: {}, predictions: {}, circuits: {} };
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

export function decodeProgress(course: Course, raw: string | null): NormalizedProgress {
  const fallback = initialProgress(course);
  if (!raw) return fallback;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1) return fallback;
    const saved = value as Partial<LearningProgress>;
    const lessons = courseLessons(course);
    const lesson = lessons.find(item => item.id === saved.lessonId) ?? lessons[0];
    const step = lesson.steps.find(item => item.id === saved.stepId) ?? lesson.steps[0];
    const validSteps = new Set(lessons.flatMap(item => item.steps.map(part => stepKey(item.id, part.id))));
    const drafts = stringRecord(saved.drafts);
    const predictions = stringRecord(saved.predictions);
    const exerciseKeys = new Set(lessons.flatMap(item => item.steps.filter(part => part.kind === 'exercise').map(part => stepKey(item.id, part.id))));
    const validPredictions = lessons.flatMap(item => item.steps.flatMap(part => {
      if (part.kind !== 'predict') return [];
      const key = stepKey(item.id, part.id);
      return part.options.some(option => option.id === predictions[key]) ? [[key, predictions[key]]] : [];
    }));
    const storedCircuits = saved.circuits && typeof saved.circuits === 'object' && !Array.isArray(saved.circuits) ? saved.circuits : {};
    const circuits: Record<string, CircuitDraft> = {};
    for (const item of lessons) {
      for (const part of item.steps) {
        const scenario = part.kind === 'circuit' ? part.scenario : part.kind === 'exercise' ? part.hardware : undefined;
        const key = stepKey(item.id, part.id);
        if (scenario && Object.hasOwn(storedCircuits, key)) circuits[key] = decodeCircuitDraft(scenario, storedCircuits[key]);
      }
    }
    return {
      version: 1,
      lessonId: lesson.id,
      stepId: step.id,
      completedSteps: Array.isArray(saved.completedSteps) ? [...new Set(saved.completedSteps.filter((key): key is string => typeof key === 'string' && validSteps.has(key)))] : [],
      drafts: Object.fromEntries(Object.entries(drafts).filter(([key]) => exerciseKeys.has(key))),
      predictions: Object.fromEntries(validPredictions),
      circuits,
    };
  } catch {
    return fallback;
  }
}

export function lessonComplete(lesson: Lesson, progress: LearningProgress): boolean {
  return lesson.steps.every(step => progress.completedSteps.includes(stepKey(lesson.id, step.id)));
}

export function resumeStep(lesson: Lesson, progress: LearningProgress): string {
  if (progress.lessonId === lesson.id && lesson.steps.some(step => step.id === progress.stepId)) return progress.stepId;
  return lesson.steps.find(step => !progress.completedSteps.includes(stepKey(lesson.id, step.id)))?.id ?? lesson.steps[0].id;
}
