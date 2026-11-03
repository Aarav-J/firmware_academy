import { ArrowRight, BookOpen, CaretDown, Check, CheckCircle, Code, Cpu, Lightbulb, Path, SlidersHorizontal } from '@phosphor-icons/react';
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

type TrackCard = {
  n: string;
  title: string;
  board: string;
  blurb: string;
  topics: string[];
  locked: boolean;
};

const LOCKED_TRACKS: TrackCard[] = [
  { n: '02', title: 'Bare-metal STM32', board: 'STM32F4 Discovery', blurb: 'Drop the libraries. Configure clocks, GPIO and peripherals by writing registers directly.', topics: ['RCC', 'GPIO', 'NVIC', 'UART', 'SPI', 'I2C', 'DMA'], locked: true },
  { n: '03', title: 'Zephyr RTOS on STM32', board: 'STM32F4 Discovery', blurb: 'Devicetree, threads and the driver model. Build firmware the way production teams do.', topics: ['west', 'Devicetree', 'Kconfig', 'k_thread', 'k_sem', 'sensor API'], locked: true },
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
  const coursePct = lessons.length ? Math.round(completedLessons / lessons.length * 100) : 0;

  return (
    <main className="ct-page">
      <header className="ct-hero">
        <p className="ct-eyebrow"><Path size={14} aria-hidden="true" /> THE FIRMWARE TRACK</p>
        <h1>Learn firmware from the pins up.</h1>
        <p>Three tracks on one path: start with the Arduino core, then drop to bare-metal registers and RTOS on STM32. Every unit pairs an interactive explanation with an exercise that compiles and runs on a real simulated chip.</p>
      </header>

      <div className="ct-cards">
        <div className="ct-card ct-card-live">
          <div className="ct-card-top"><span>COURSE 01</span><span>ATmega328P</span></div>
          <div className="ct-card-title">{course.board}</div>
          <p className="ct-card-blurb">{course.description}</p>
          <div className="ct-card-topics"><span>digitalWrite</span><span>millis()</span><span>Serial</span><span>attachInterrupt</span><span>analogRead</span><span>Wire</span></div>
          <div className="ct-card-progress">
            <div className="ct-card-progress-track"><div style={{ width: `${coursePct}%` }} /></div>
            <span className="ct-card-progress-label">{coursePct}% complete · {course.units.length} units</span>
          </div>
        </div>
        {LOCKED_TRACKS.map(track => (
          <div className="ct-card ct-card-locked" key={track.title} aria-disabled="true">
            <div className="ct-card-top"><span>COURSE {track.n}</span><span>{track.board}</span></div>
            <div className="ct-card-title">{track.title}</div>
            <p className="ct-card-blurb">{track.blurb}</p>
            <div className="ct-card-topics">{track.topics.map(topic => <span key={topic}>{topic}</span>)}</div>
            <div className="ct-card-progress">
              <span className="ct-card-locked-badge">Coming soon</span>
            </div>
          </div>
        ))}
      </div>

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
          <span className="ct-start-audience"><Cpu size={14} aria-hidden="true" />{course.audience}</span>
        </div>
      )}

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
            const unitPct = available ? Math.round(unitCompletedCount / unit.lessons.length * 100) : 0;
            const status = !available ? 'Planned' : unitComplete ? 'Complete' : unitCompletedCount > 0 || unit.lessons.some(lesson => lesson.id === currentLesson?.id) ? 'In progress' : 'Not started';
            return (
              <li className="ct-unit" key={unit.id}>
                <details className="ct-unit-details" open={available && unitIndex === 0}>
                  <summary className="ct-unit-summary">
                    <span className="ct-unit-num">{String(unitIndex + 1).padStart(2, '0')}</span>
                    <span className="ct-unit-heading">
                      <span className="ct-unit-title">{unit.title}</span>
                      <span className="ct-unit-meta">{available ? `${unit.lessons.length} lessons · ${unit.lessons.filter(lesson => lesson.steps.some(step => step.kind === 'exercise' || step.kind === 'circuit')).length} exercises` : unit.description}</span>
                    </span>
                    <span className="ct-unit-progress-track"><span style={{ width: `${unitPct}%` }} /></span>
                    <span className={`ct-unit-status ct-unit-status-${status.replace(/\s+/g, '-').toLowerCase()}`}>{status}</span>
                    <CaretDown className="ct-disclosure" size={16} aria-hidden="true" />
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
                              <span className="ct-lesson-dot" aria-hidden="true">{done ? <Check size={11} weight="bold" /> : null}</span>
                              <span className="ct-lesson-kinds" aria-hidden="true">{stepKinds.filter(({ kind }) => lesson.steps.some(step => step.kind === kind)).map(({ kind, Icon }) => <Icon key={kind} size={13} />)}</span>
                              <span className="ct-lesson-content">
                                <span className="ct-lesson-title-line"><strong>{unitIndex + 1}.{lessonIndex + 1} {lesson.title}</strong>{current && hasStarted && !done && <span className="ct-lesson-status ct-status-current">You're here</span>}</span>
                                <span className="ct-lesson-description">{lesson.description}</span>
                              </span>
                              <span className={`ct-lesson-stat${done ? ' ct-status-complete' : current ? ' ct-status-current' : ''}`}>{done ? 'Done' : current ? 'In progress' : ''}</span>
                              <span className="ct-lesson-action">{action}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  ) : (
                    <div className="ct-planned-content">
                      <p>{unit.description}</p>
                      {unit.plannedTopics && unit.plannedTopics.length > 0 && <ul>{unit.plannedTopics.map(topic => <li key={topic}>{topic}</li>)}</ul>}
                      <p className="ct-planned-caption">This unit is on the roadmap. Lessons aren't available yet.</p>
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
