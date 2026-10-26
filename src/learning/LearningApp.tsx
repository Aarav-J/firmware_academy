import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ArrowCounterClockwise, ArrowLeft, ArrowRight, BookOpen, CaretDown, CheckCircle, Circuitry, Code, Lightbulb, List, Moon, Pause, Play, Sun, X } from '@phosphor-icons/react';
import { arduinoCourse } from './course';
import { CourseTimeline } from './CourseTimeline';
import { LessonContent } from './LessonContent';
import { PaneDivider } from './PaneDivider';
import { CircuitActivity } from './CircuitActivity';
import { decodeCircuitDraft } from './circuit-model';
import type { CircuitDraft } from './circuit-types';
import { assessExercise } from './assessment';
import { courseLessons, decodeProgress, lessonComplete, PROGRESS_STORAGE_KEY, resumeStep } from './progress';
import { stepKey } from './types';
import type { ExerciseStep, GoalResult, LearningWorkspace, Lesson, WorkbenchControls, WorkbenchObservation } from './types';
import './learning.css';

const Workbench = lazy(() => import('../App'));
const lessons = courseLessons(arduinoCourse);
const kindLabels = { read: 'Learn', explore: 'Explore', predict: 'Predict', circuit: 'Practice', exercise: 'Build' };
type Route = { view: 'course' | 'workbench' } | { view: 'lesson'; lessonId: string; stepId: string };

function currentRoute(): Route {
  if (location.hash === '#/workbench') return { view: 'workbench' };
  const match = /^#\/learn\/([^/]+)\/([^/]+)$/.exec(location.hash);
  const lesson = match && lessons.find(item => item.id === match[1]);
  if (lesson && (match[2] === 'complete' || lesson.steps.some(step => step.id === match[2]))) {
    return { view: 'lesson', lessonId: lesson.id, stepId: match[2] };
  }
  return { view: 'course' };
}

function readProgress() {
  try { return decodeProgress(arduinoCourse, localStorage.getItem(PROGRESS_STORAGE_KEY)); }
  catch { return decodeProgress(arduinoCourse, null); }
}

function initialTheme() {
  try {
    const saved = localStorage.getItem('firmware-academy:theme');
    if (saved === 'dark' || saved === 'light') return saved === 'dark';
  } catch { /* System preference remains available without storage. */ }
  return matchMedia('(prefers-color-scheme: dark)').matches;
}

export default function LearningApp() {
  const [route, setRoute] = useState<Route>(currentRoute);
  const [progress, setProgress] = useState(readProgress);
  const [dark, setDark] = useState(initialTheme);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const headingRef = useRef<HTMLDivElement>(null);
  const outlineRef = useRef<HTMLElement>(null);
  const outlineButton = useRef<HTMLButtonElement>(null);
  const lesson = route.view === 'lesson' ? lessons.find(item => item.id === route.lessonId)! : null;
  const unit = lesson ? arduinoCourse.units.find(item => item.lessons.includes(lesson)) : undefined;
  const step = lesson && route.view === 'lesson' ? lesson.steps.find(item => item.id === route.stepId) ?? lesson.steps[0] : null;
  const complete = lesson && route.view === 'lesson' && route.stepId === 'complete' && lessonComplete(lesson, progress);

  useEffect(() => {
    const update = () => { setRoute(currentRoute()); setOutlineOpen(false); };
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    try { localStorage.setItem('firmware-academy:theme', dark ? 'dark' : 'light'); } catch { /* Theme still works for this visit. */ }
  }, [dark]);

  useEffect(() => {
    try { localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress)); setStorageError(false); }
    catch { setStorageError(true); }
  }, [progress]);

  useEffect(() => {
    if (!lesson || !step || complete) return;
    setProgress(previous => previous.lessonId === lesson.id && previous.stepId === step.id ? previous : { ...previous, lessonId: lesson.id, stepId: step.id });
  }, [lesson?.id, step?.id, complete]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    headingRef.current?.focus({ preventScroll: true });
    document.title = lesson ? `${lesson.title} | Firmware Academy` : route.view === 'workbench' ? 'Workbench | Firmware Academy' : 'Arduino fundamentals | Firmware Academy';
  }, [route.view, lesson?.id, route.view === 'lesson' ? route.stepId : '']);

  useEffect(() => {
    if (!outlineOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!outlineRef.current?.contains(event.target as Node) && !outlineButton.current?.contains(event.target as Node)) setOutlineOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOutlineOpen(false); outlineButton.current?.focus(); }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape); };
  }, [outlineOpen]);

  function go(hash: string) {
    setOutlineOpen(false);
    if (location.hash === hash) setRoute(currentRoute());
    else location.hash = hash;
  }

  function openLesson(id: string) {
    const selected = lessons.find(item => item.id === id);
    if (selected) go(`#/learn/${selected.id}/${lessonComplete(selected, progress) ? selected.steps[0].id : resumeStep(selected, progress)}`);
  }

  function finishStep() {
    if (!lesson || !step) return;
    const key = stepKey(lesson.id, step.id);
    setProgress(previous => ({ ...previous, completedSteps: [...new Set([...previous.completedSteps, key])] }));
    const index = lesson.steps.indexOf(step);
    const next = lesson.steps[index + 1];
    go(`#/learn/${lesson.id}/${next?.id ?? 'complete'}`);
  }

  function answerPrediction(answer: string) {
    if (!lesson || !step || step.kind !== 'predict') return;
    const key = stepKey(lesson.id, step.id);
    setProgress(previous => ({ ...previous, predictions: { ...previous.predictions, [key]: answer }, completedSteps: answer === step.answerId ? previous.completedSteps : previous.completedSteps.filter(item => item !== key) }));
  }

  const nextLesson = lesson ? lessons[lessons.indexOf(lesson) + 1] : undefined;
  const stepIndex = lesson && step ? lesson.steps.indexOf(step) : 0;
  const key = lesson && step ? stepKey(lesson.id, step.id) : '';
  const canContinue = step?.kind !== 'predict' || progress.predictions[key] === step.answerId;
  const themeButton = <button className="icon-button academy-theme" onClick={() => setDark(value => !value)} aria-label={`Switch to ${dark ? 'light' : 'dark'} theme`} title={`Switch to ${dark ? 'light' : 'dark'} theme`}>{dark ? <Sun size={19} /> : <Moon size={19} />}</button>;

  return (
    <div className={`academy-app${lesson ? ' academy-in-lesson' : ''}${lesson && step?.kind === 'exercise' && !complete ? ' academy-exercise' : ''}`}>
      <a className="academy-skip" href="#academy-content" onClick={event => { event.preventDefault(); const content = document.getElementById('academy-content'); content?.setAttribute('tabindex', '-1'); content?.focus(); }}>Skip to content</a>
      {lesson && step ? (
        <header className="academy-lesson-header">
          <a className="academy-course-back" href="#/course" aria-label="Back to Arduino fundamentals"><ArrowLeft size={18} /><span>Arduino fundamentals</span></a>
          <button ref={outlineButton} className="icon-button academy-outline-toggle" aria-label="Course outline" title="Course outline" aria-expanded={outlineOpen} aria-controls="academy-outline" onClick={() => setOutlineOpen(value => !value)}><List size={18} /></button>
          <strong className="academy-lesson-title" title={lesson.title}>{lesson.title}</strong>
          <CompactMenu key={key + String(complete)} className="academy-step-menu" label={<>{complete ? 'Complete' : kindLabels[step.kind]}<small>{complete ? lesson.steps.length : stepIndex + 1}/{lesson.steps.length}</small></>} accessibleLabel={`Lesson steps: ${complete ? 'Complete' : kindLabels[step.kind]}, ${complete ? lesson.steps.length : stepIndex + 1} of ${lesson.steps.length}`}>
            {close => <nav aria-label="Lesson steps">{lesson.steps.map((part, index) => <button key={part.id} onClick={() => { close(); go(`#/learn/${lesson.id}/${part.id}`); }} aria-current={part.id === step.id && !complete ? 'step' : undefined}><span className="academy-menu-step-number">{progress.completedSteps.includes(stepKey(lesson.id, part.id)) ? <CheckCircle size={17} weight="fill" /> : index + 1}</span><span><strong>{kindLabels[part.kind]}</strong><small>{part.title}</small></span></button>)}</nav>}
          </CompactMenu>
          {themeButton}
        </header>
      ) : (
        <header className="academy-header">
          <a className="wordmark" href="#/course" aria-label="Firmware Academy courses"><Circuitry size={27} weight="duotone" /><strong>Firmware<span>Academy</span></strong></a>
          <nav aria-label="Main navigation" className="academy-navigation"><a href="#/course" aria-current={route.view !== 'workbench' ? 'page' : undefined}><BookOpen size={17} />Learn</a><a href="#/workbench" aria-current={route.view === 'workbench' ? 'page' : undefined}><Code size={17} />Workbench</a></nav>
          {themeButton}
        </header>
      )}
      {storageError && <div className="academy-storage-notice" role="status">Browser storage is unavailable. You can keep learning, but progress and code may not survive a reload.</div>}
      {route.view === 'course' && <main id="academy-content" className="academy-course" ref={headingRef} tabIndex={-1}><CourseTimeline course={arduinoCourse} progress={progress} onOpenLesson={openLesson} /></main>}
      {route.view === 'workbench' && <div id="academy-content" ref={headingRef} tabIndex={-1} className="academy-free-workbench"><Suspense fallback={<WorkspaceLoading />}><Workbench darkMode={dark} /></Suspense></div>}
      {lesson && step && <>
        {outlineOpen && <nav ref={outlineRef} id="academy-outline" className="academy-outline" aria-label="Lesson outline"><div><strong>{unit?.title}</strong><button className="icon-button" aria-label="Close course outline" onClick={() => { setOutlineOpen(false); outlineButton.current?.focus(); }}><X size={18} /></button></div>{unit?.lessons.map(item => <div className="academy-outline-lesson" key={item.id}><button onClick={() => openLesson(item.id)} aria-current={item.id === lesson.id ? 'page' : undefined}>{lessonComplete(item, progress) ? <CheckCircle size={18} /> : <BookOpen size={18} />}{item.title}</button>{item.id === lesson.id && item.steps.map(part => <button className="academy-outline-step" key={part.id} onClick={() => go(`#/learn/${item.id}/${part.id}`)} aria-current={part.id === step.id && !complete ? 'step' : undefined}>{progress.completedSteps.includes(stepKey(item.id, part.id)) ? <CheckCircle size={14} /> : <span className="academy-step-dot" />}{part.title}</button>)}</div>)}<a href="#/course">View full course roadmap <ArrowRight size={16} /></a><a href="#/workbench">Open free workbench <Code size={16} /></a></nav>}
        {complete ? <main id="academy-content" className="academy-completion" ref={headingRef} tabIndex={-1}><CheckCircle size={52} weight="duotone" /><p>Lesson complete</p><h1>{lesson.title}</h1><p>{lesson.description}</p><div className="academy-completion-summary"><strong>You worked through the whole loop.</strong><span>{lesson.steps.some(part => part.kind === 'exercise') ? 'Learned the concept, explored the model, made a prediction, and checked real firmware output.' : 'Learned the concept, explored the model, made a prediction, and checked your circuit and reasoning.'}</span></div><button className="primary-button" onClick={() => nextLesson ? openLesson(nextLesson.id) : go('#/course')}>{nextLesson ? `Next: ${nextLesson.title}` : 'Back to course'}<ArrowRight size={17} /></button><button className="text-button" onClick={() => go(`#/learn/${lesson.id}/${lesson.steps[0].id}`)}>Review this lesson</button></main>
          : step.kind === 'circuit' ? <main id="academy-content" className="academy-circuit-activity" ref={headingRef} tabIndex={-1}><CircuitActivity key={key} step={step} draft={progress.circuits?.[key] ?? decodeCircuitDraft(step.scenario, null)} onChange={draft => setProgress(previous => ({ ...previous, circuits: { ...previous.circuits, [key]: draft }, completedSteps: previous.completedSteps.filter(item => item !== key) }))} onComplete={finishStep} /></main>
          : step.kind === 'exercise' ? <ExerciseView key={key} lesson={lesson} step={step} source={progress.drafts[key] ?? step.starterCode} circuit={step.hardware ? progress.circuits?.[key] ?? decodeCircuitDraft(step.hardware, null) : undefined} dark={dark} onSourceChange={source => setProgress(previous => ({ ...previous, drafts: { ...previous.drafts, [key]: source }, completedSteps: previous.completedSteps.filter(item => item !== key) }))} onCircuitChange={draft => setProgress(previous => ({ ...previous, circuits: { ...previous.circuits, [key]: draft }, completedSteps: previous.completedSteps.filter(item => item !== key) }))} onContinue={finishStep} onBack={() => go(`#/learn/${lesson.id}/${lesson.steps[stepIndex - 1].id}`)} />
          : <><main id="academy-content" className={`academy-reader academy-reader-${step.kind}`} ref={headingRef} tabIndex={-1}><div className="academy-reading-context">{kindLabels[step.kind]}<span>{stepIndex + 1} of {lesson.steps.length}</span></div><LessonContent key={key} lesson={lesson} step={step} answer={progress.predictions[key]} onAnswer={answerPrediction} /></main><footer className="academy-step-footer"><button className="secondary-button" onClick={() => stepIndex ? go(`#/learn/${lesson.id}/${lesson.steps[stepIndex - 1].id}`) : go('#/course')}><ArrowLeft size={17} />{stepIndex ? 'Back' : 'Course overview'}</button><button className="primary-button" disabled={!canContinue} onClick={finishStep}>{lesson.steps[stepIndex + 1]?.kind === 'exercise' ? 'Try it in code' : lesson.steps[stepIndex + 1]?.kind === 'circuit' ? 'Try the circuit' : 'Continue'}<ArrowRight size={17} /></button></footer></>}
      </>}
    </div>
  );
}

function CompactMenu({ label, accessibleLabel, className = '', children }: {
  label: ReactNode;
  accessibleLabel: string;
  className?: string;
  children: (close: () => void) => ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const close = useCallback(() => {
    if (!ref.current) return;
    ref.current.open = false;
    ref.current.querySelector('summary')?.focus();
  }, []);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (ref.current?.open && !ref.current.contains(event.target as Node)) ref.current.open = false;
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && ref.current?.open) close(); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [close]);
  return <details ref={ref} className={`academy-compact-menu ${className}`}><summary aria-label={accessibleLabel}>{label}<CaretDown size={13} /></summary><div className="academy-compact-menu-panel">{children(close)}</div></details>;
}

function WorkspaceLoading() {
  return <div className="academy-workspace-loading" role="status"><div /><div /><p>Opening your firmware workspace…</p></div>;
}

function ExerciseView({ lesson, step, source, circuit, dark, onSourceChange, onCircuitChange, onContinue, onBack }: {
  lesson: Lesson;
  step: ExerciseStep;
  source: string;
  circuit?: CircuitDraft;
  dark: boolean;
  onSourceChange: (source: string) => void;
  onCircuitChange?: (draft: CircuitDraft) => void;
  onContinue: () => void;
  onBack: () => void;
}) {
  const [results, setResults] = useState<GoalResult[]>([]);
  const [hints, setHints] = useState(0);
  const [instructions, setInstructions] = useState(true);
  const [pane, setPane] = useState<'split' | 'code' | 'hardware'>('split');
  const [editorShare, setEditorShare] = useState(50);
  const [controls, setControls] = useState<WorkbenchControls | null>(null);
  const [analogVoltage, setAnalogVoltage] = useState(step.analogInput?.min ?? 0);
  const [lastSerialCommand, setLastSerialCommand] = useState('');
  const observation = useRef<WorkbenchObservation | null>(null);
  const checkedSuccessfully = useRef(false);
  const previousBuildFailed = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const receiveObservation = useCallback((value: WorkbenchObservation) => {
    const previous = observation.current;
    if (previous && ((!value.built && previous.built) || value.timeUs < previous.timeUs)) {
      checkedSuccessfully.current = false;
      setResults([]);
    } else if (checkedSuccessfully.current) {
      const currentResults = assessExercise(step, value);
      if (currentResults.some(result => !result.passed)) {
        checkedSuccessfully.current = false;
        setResults(currentResults);
      }
    }
    observation.current = value;
  }, [step]);
  const changeSource = useCallback((value: string) => { checkedSuccessfully.current = false; setResults([]); onSourceChange(value); }, [onSourceChange]);
  const receiveControls = useCallback((value: WorkbenchControls | null) => {
    if (value?.buildFailed && !previousBuildFailed.current) {
      setPane(current => current === 'hardware' ? 'code' : current);
    }
    previousBuildFailed.current = value?.buildFailed ?? false;
    setControls(value);
  }, []);
  const changeCircuit = useCallback((draft: CircuitDraft) => {
    checkedSuccessfully.current = false;
    setResults([]);
    onCircuitChange?.(draft);
  }, [onCircuitChange]);
  const changeAnalogVoltage = useCallback((voltage: number) => { checkedSuccessfully.current = false; setResults([]); setAnalogVoltage(voltage); }, []);
  const changeSerialCommand = useCallback((char: string) => { checkedSuccessfully.current = false; setResults([]); setLastSerialCommand(char); }, []);
  const learning = useMemo<LearningWorkspace>(() => ({ id: stepKey(lesson.id, step.id), source, onSourceChange: changeSource, onObservation: receiveObservation, onControls: receiveControls, hardware: step.hardware, circuit, onCircuitChange: changeCircuit, analogInput: step.analogInput, analogVoltage, onAnalogVoltageChange: changeAnalogVoltage, serialCommands: step.serialCommands, lastSerialCommand, onSerialCommandChange: changeSerialCommand }), [lesson.id, step.id, step.hardware, step.analogInput, step.serialCommands, source, circuit, analogVoltage, lastSerialCommand, changeAnalogVoltage, changeSerialCommand, changeCircuit, changeSource, receiveObservation, receiveControls]);
  const passed = results.length === step.goals.length && results.every(result => result.passed);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);

  function checkWork() {
    const currentResults = assessExercise(step, observation.current);
    checkedSuccessfully.current = currentResults.every(result => result.passed);
    setResults(currentResults);
    if (!instructions) setInstructions(true);
  }

  function completeExercise() {
    const currentResults = assessExercise(step, observation.current);
    if (currentResults.some(result => !result.passed)) {
      checkedSuccessfully.current = false;
      setResults(currentResults);
      setInstructions(true);
      return;
    }
    onContinue();
  }

  const layouts = { split: 'Split view', code: 'Code focus', hardware: 'Hardware focus' };
  return <>
    <div className="academy-exercise-controls">
      <div className="academy-toolbar-left">
        <button className="text-button" onClick={() => setInstructions(value => !value)} aria-label={instructions ? 'Hide instructions' : 'Show instructions'} aria-expanded={instructions} aria-controls="exercise-instructions"><BookOpen size={16} />Instructions</button>
        <CompactMenu label={layouts[pane]} accessibleLabel="Workspace layout" className="academy-layout-menu">{close => <div role="group" aria-label="Workspace layout options">{(['split', 'code', 'hardware'] as const).map(value => <button key={value} aria-pressed={pane === value} onClick={() => { setPane(value); close(); }}>{layouts[value]}{pane === value && <CheckCircle size={15} />}</button>)}</div>}</CompactMenu>
      </div>
      <div className="academy-toolbar-actions">
        <button className="icon-button" aria-label="Reset simulation" title="Reset simulation" disabled={!controls?.canControl} onClick={() => controls?.reset()}><ArrowCounterClockwise size={17} /></button>
        <button className="icon-button" aria-label={controls?.running ? 'Pause simulation' : 'Resume simulation'} title={controls?.running ? 'Pause simulation' : 'Resume simulation'} disabled={!controls?.canControl} onClick={() => controls?.togglePause()}>{controls?.running ? <Pause size={16} weight="fill" /> : <Play size={16} weight="fill" />}</button>
        <button className={passed ? 'secondary-button' : 'primary-button'} aria-label="Build and run sketch" disabled={!controls?.available || controls.building || controls.loading} onClick={() => controls?.run()}><Play size={14} weight="fill" />{controls?.building ? 'Building…' : controls?.loading ? 'Starting…' : 'Run'}</button>
        <button className="secondary-button academy-check-work" onClick={checkWork} disabled={!!controls?.building || !!controls?.loading}><CheckCircle size={16} />Check work</button>
        {passed && <button className="primary-button academy-complete-action" onClick={completeExercise}>Complete lesson<ArrowRight size={16} /></button>}
      </div>
    </div>
    <div id="academy-content" className={`academy-exercise-layout${instructions ? '' : ' instructions-hidden'} exercise-pane-${pane}`} style={{ '--editor-share': `${editorShare}%` } as CSSProperties}>
      <aside id="exercise-instructions" className="academy-exercise-instructions" hidden={!instructions} aria-label="Exercise instructions">
        <button className="text-button academy-back-explanation" onClick={onBack}><ArrowLeft size={14} />Back to explanation</button>
        <h1 ref={heading} tabIndex={-1}>{step.title}</h1><p>{step.paragraphs[0]}</p>
        <details className="academy-api-reference"><summary>API reference & guidance</summary>{step.paragraphs.slice(1).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</details>
        <h2>What to make happen</h2>
        <ul className="academy-goals">{step.goals.map(goal => {
          const result = results.find(item => item.id === goal.id);
          return <li key={goal.id} className={result?.passed ? 'goal-passed' : ''}><CheckCircle size={19} weight={result?.passed ? 'fill' : 'regular'} /><div><strong>{goal.label}</strong>{result && <span>{result.detail}</span>}</div></li>;
        })}</ul>
        <div className={`academy-check-feedback${passed ? ' is-passed' : ''}`} role="status">{results.length > 0 && (passed ? 'All goals observed. Complete this lesson when you’re ready.' : 'Not there yet. Adjust your sketch using the feedback above, run it, then check again.')}</div>
        <p className="academy-observation-note">Checks use the current compiled sketch and simulated D{step.signal?.pin ?? step.hardware?.outputPin ?? 13} output{step.hardware ? ', plus your actual circuit connections and the stated current model' : ''}, not words in your code.</p>
        <div className="academy-hints"><button className="text-button" disabled={hints === step.hints.length} onClick={() => setHints(value => value + 1)}><Lightbulb size={17} />{hints === step.hints.length ? 'All hints shown' : hints ? 'Show another hint' : 'Need a hint?'}</button>{step.hints.slice(0, hints).map((hint, index) => <p key={index}><strong>Hint {index + 1}.</strong> {hint}</p>)}</div>
      </aside>
      <section className="academy-exercise-workspace" aria-label="Code and hardware workspace"><Suspense fallback={<WorkspaceLoading />}><Workbench learning={learning} darkMode={dark} paneDivider={<PaneDivider value={editorShare} onChange={setEditorShare} />} /></Suspense></section>
    </div>
  </>;
}
