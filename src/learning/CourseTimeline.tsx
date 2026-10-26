import { ArrowRight, BookOpen, CaretDown, Check, CheckCircle, Clock, Code, Cpu, Lightbulb, Path, SlidersHorizontal } from '@phosphor-icons/react';
import { stepKey } from './types';
import type { Course, LearningProgress, Lesson, LessonStep } from './types';
import './course-timeline.css';

const stepKinds: { kind: LessonStep['kind']; label: string; Icon: typeof BookOpen }[] = [
  { kind: 'read', label: 'Read', Icon: BookOpen },
  { kind: 'explore', label: 'Explore', Icon: SlidersHorizontal },
  { kind: 'predict', label: 'Predict', Icon: Lightbulb },
  { kind: 'circuit', label: 'Circuit', Icon: Path },
  { kind: 'exercise', label: 'Code', Icon: Code },
];

export function CourseTimeline({ course, progress, onOpenLesson }: {
  course: Course;
  progress: LearningProgress;
  onOpenLesson: (lessonId: string) => void;
}) {
  const completedSteps = new Set(progress.completedSteps);
  const lessons = course.units.flatMap(unit => unit.lessons);
  const completedStepCount = (lesson: Lesson) => lesson.steps.reduce(
    (count, step) => count + Number(completedSteps.has(stepKey(lesson.id, step.id))), 0,
  );
  const isComplete = (lesson: Lesson) => lesson.steps.length > 0 && completedStepCount(lesson) === lesson.steps.length;
  const completedLessons = lessons.filter(isComplete).length;
  const currentLesson = lessons.find(lesson => lesson.id === progress.lessonId)
    ?? lessons.find(lesson => !isComplete(lesson))
    ?? lessons[0];
  const hasStarted = lessons.some(lesson => completedStepCount(lesson) > 0);
  const currentComplete = currentLesson ? isComplete(currentLesson) : false;
  const plannedUnits = course.units.filter(unit => unit.lessons.length === 0).length;

  return (
    <main className="ct-page">
      <header className="ct-intro">
        <div className="ct-intro-copy">
          <p className="ct-context"><Path size={18} aria-hidden="true" /> Your course</p>
          <h1>{course.title}</h1>
          <p className="ct-description">{course.description}</p>
          <dl className="ct-course-facts">
            <div><dt>Made for</dt><dd>{course.audience}</dd></div>
            <div><dt><Cpu size={16} aria-hidden="true" /> Your board</dt><dd>{course.board}</dd></div>
          </dl>
          {currentLesson && (
            <div className="ct-start">
              <button className="ct-primary" type="button" onClick={() => onOpenLesson(currentLesson.id)}>
                {currentComplete ? 'Review lesson' : hasStarted ? 'Continue learning' : 'Start learning'}
                <ArrowRight size={18} aria-hidden="true" />
              </button>
              <span className="ct-start-caption">
                <span>{currentComplete ? 'Revisit' : hasStarted ? 'Pick up with' : 'First up'}</span>
                <strong>{currentLesson.title}</strong>
              </span>
            </div>
          )}
        </div>
        <aside className="ct-progress" aria-label="Course progress">
          <p className="ct-progress-heading">A little progress, one lesson at a time.</p>
          <p className="ct-progress-count"><strong>{completedLessons}</strong><span> of {lessons.length} available {lessons.length === 1 ? 'lesson' : 'lessons'} completed</span></p>
          {lessons.length > 0 && (
            <progress className="ct-progress-meter" max={lessons.length} value={completedLessons} aria-label="Available lessons completed">
              {completedLessons} of {lessons.length}
            </progress>
          )}
          <p className="ct-progress-note">Read a little. Try an idea. Then make it work on the board.</p>
          {plannedUnits > 0 && <p className="ct-roadmap-note">Later units are planned and don’t count toward your progress.</p>}
        </aside>
      </header>

      <section className="ct-curriculum" aria-labelledby="ct-path-title">
        <div className="ct-path-heading">
          <div><h2 id="ct-path-title">Your learning path</h2><p>Small steps, with room to experiment.</p></div>
          <span>{lessons.length} {lessons.length === 1 ? 'lesson' : 'lessons'} available now</span>
        </div>
        <ol className="ct-units">
          {course.units.map((unit, unitIndex) => {
            const available = unit.lessons.length > 0;
            const unitComplete = available && unit.lessons.every(isComplete);
            const unitCompletedCount = unit.lessons.filter(isComplete).length;
            return (
              <li className={`ct-unit${available ? ' ct-unit-available' : ' ct-unit-planned'}${unitComplete ? ' ct-unit-complete' : ''}`} key={unit.id}>
                <span className="ct-unit-marker" aria-hidden="true">{unitComplete ? <Check size={18} weight="bold" /> : unitIndex + 1}</span>
                <details className="ct-unit-details" open={available}>
                  <summary className="ct-unit-summary">
                    <span className="ct-unit-heading">
                      <span className="ct-unit-label">Unit {unitIndex + 1}</span>
                      <span className="ct-unit-title">{unit.title}</span>
                      {available && <span className="ct-unit-description">{unit.description}</span>}
                    </span>
                    <span className="ct-unit-summary-end">
                      <span className={available ? 'ct-unit-count' : 'ct-planned-label'}>{available ? `${unitCompletedCount} / ${unit.lessons.length} complete` : 'Planned'}</span>
                      <CaretDown className="ct-disclosure" size={18} aria-hidden="true" />
                    </span>
                  </summary>
                  {available ? (
                    <ol className="ct-lessons">
                      {unit.lessons.map((lesson, lessonIndex) => {
                        const done = isComplete(lesson);
                        const stepCount = completedStepCount(lesson);
                        const current = lesson.id === currentLesson?.id;
                        const action = done ? 'Review' : stepCount > 0 ? 'Continue' : 'Open';
                        return (
                          <li key={lesson.id}>
                            <button
                              className={`ct-lesson${current ? ' ct-lesson-current' : ''}${done ? ' ct-lesson-complete' : ''}`}
                              type="button"
                              onClick={() => onOpenLesson(lesson.id)}
                              aria-label={`${action} ${lesson.title}${done ? ', completed' : ''}`}
                              aria-current={current ? 'step' : undefined}
                            >
                              <span className="ct-lesson-marker" aria-hidden="true">{done ? <CheckCircle size={23} weight="fill" /> : <span>{unitIndex + 1}.{lessonIndex + 1}</span>}</span>
                              <span className="ct-lesson-content">
                                <span className="ct-lesson-title-line"><strong>{lesson.title}</strong>{done ? <span className="ct-lesson-status ct-status-complete">Completed</span> : current && hasStarted ? <span className="ct-lesson-status ct-status-current">You’re here</span> : null}</span>
                                <span className="ct-lesson-description">{lesson.description}</span>
                                <span className="ct-lesson-meta">
                                  <span><Clock size={14} aria-hidden="true" />{lesson.durationMinutes} min</span>
                                  {stepKinds.filter(({ kind }) => lesson.steps.some(step => step.kind === kind)).map(({ kind, label, Icon }) => (
                                    <span key={kind}><Icon size={14} aria-hidden="true" />{label}</span>
                                  ))}
                                </span>
                              </span>
                              <span className="ct-lesson-action">{action}<ArrowRight size={17} aria-hidden="true" /></span>
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  ) : (
                    <div className="ct-planned-content">
                      <p>{unit.description}</p>
                      {unit.plannedTopics && unit.plannedTopics.length > 0 && <ul>{unit.plannedTopics.map(topic => <li key={topic}>{topic}</li>)}</ul>}
                      <p className="ct-planned-caption">This unit is on the roadmap. Lessons aren’t available yet.</p>
                    </div>
                  )}
                </details>
              </li>
            );
          })}
        </ol>
      </section>
    </main>
  );
}
