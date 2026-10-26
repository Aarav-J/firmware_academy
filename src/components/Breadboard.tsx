import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { ArrowCounterClockwise, ArrowUUpLeft, ArrowsInSimple, ArrowsOutSimple, Cursor, Hand, MagnifyingGlass, Minus, Plus, Trash, X } from '@phosphor-icons/react';
import { BOARD_PINOUTS, LIVE_PIN_INDEX } from '../board-pinouts';
import { BREADBOARD_PARTS } from '../breadboard-parts';
import { samePinRef } from '../breadboard-contracts';
import type { BoardKey, BreadboardLayout, PinRef, PlacedComponent, Wire } from '../breadboard-contracts';
import type { CircuitScenario } from '../learning/circuit-types';
import { inspectCircuit } from '../learning/circuit-model';
import { BREADBOARD_BODY, BREADBOARD_HOLES, WIRE_COLORS, connectionWarnings, decodePhysicalLayout, describeRef, holeNet, holePoint, physicalLedStates, physicalNets, pinRefKey, placementIssues, toPhysicalLayout } from '../physical-breadboard';
import type { BenchPoint } from '../physical-breadboard';
import { BenchBoard, BenchPart, boardPinPoint, componentCenter, componentPinPoint } from './BenchArtwork';
import { BenchSchematic } from './BenchSchematic';
import './breadboard.css';

// Standalone board drawings also expose this typed pin interaction interface.
export type PinWiringProps = { ref: (el: HTMLElement | null) => void; onClick: () => void; className: string };
export type BoardWiring = { pin(pinId: string): PinWiringProps };
type BreadboardProps = {
  boardKey: BoardKey; pins: number[]; layout?: BreadboardLayout;
  onLayoutChange?: (layout: BreadboardLayout) => void; scenario?: CircuitScenario;
  enabled?: boolean; onButton?: (pressed: boolean) => void;
};
type Selection = { kind: 'part' | 'wire' | 'hole'; id: string } | null;
type View = { x: number; y: number; scale: number };
type Drag = { pointerId: number; start: BenchPoint; last: BenchPoint; part?: string; view: View; moved: boolean };
const EMPTY: BreadboardLayout = { version: 2, components: [], wires: [] };
const STORAGE_PREFIX = 'firmware-academy:breadboard:';
const PARTS = new Map(BREADBOARD_PARTS.map(part => [part.id, part]));
const pointDistance = (a: BenchPoint, b: BenchPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const wirePath = (points: BenchPoint[], liftBias = 0): string => {
  if (points.length < 2) return '';
  if (points.length === 2) {
    const [p0, p1] = points;
    const span = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const lift = Math.min(90, Math.max(24, span * 0.24) + liftBias);
    return `M${p0.x} ${p0.y} C${p0.x} ${p0.y - lift}, ${p1.x} ${p1.y - lift}, ${p1.x} ${p1.y}`;
  }
  let d = `M${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
};
const editable = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest('input,select,textarea,[contenteditable=true]');

function loadLayout(boardKey: BoardKey): BreadboardLayout {
  try { return decodePhysicalLayout(JSON.parse(localStorage.getItem(STORAGE_PREFIX + boardKey) ?? 'null'), boardKey) ?? structuredClone(EMPTY); }
  catch { return structuredClone(EMPTY); }
}

export function Breadboard(props: BreadboardProps) {
  return <PhysicalBench key={`${props.boardKey}:${props.scenario?.id ?? 'free'}`} {...props} />;
}

/** THESIS: an actual bench, not cards connected by lines. OWN-WORLD: teal PCB,
 * ivory plastic, metal leads, colored jumpers; existing app tokens frame the task.
 * STORY: inspect a strip, place leads, wire, then explain the same electrical nets.
 * FIRST VIEWPORT: Uno left, breadboard right; a compact tool strip and zoom HUD.
 * FORM: user-approved physical top-down workspace with progressive guidance. */
function PhysicalBench({ boardKey, pins, layout: controlled, onLayoutChange, scenario, enabled = false, onButton }: BreadboardProps) {
  const isolated = controlled !== undefined || scenario !== undefined;
  const [local, setLocal] = useState(() => isolated ? structuredClone(scenario?.initialLayout ?? EMPTY) : loadLayout(boardKey));
  const layout = useMemo(() => toPhysicalLayout(controlled ?? local), [controlled, local]);
  const current = useRef(layout); current.current = layout;
  const history = useRef<BreadboardLayout[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const [selection, setSelection] = useState<Selection>(null);
  const [pending, setPending] = useState<PinRef | null>(null);
  const [route, setRoute] = useState<BenchPoint[]>([]);
  const [cursor, setCursor] = useState<BenchPoint | null>(null);
  const [hover, setHover] = useState<PinRef | null>(null);
  const [message, setMessage] = useState('Select a pin or free hole to start a jumper.');
  const [mode, setMode] = useState<'wire' | 'pan'>('wire');
  const [color, setColor] = useState<string>(WIRE_COLORS[3]);
  const [view, setView] = useState<View>({ x: 0, y: 0, scale: 1 });
  const viewRef = useRef(view); viewRef.current = view;
  const [expanded, setExpanded] = useState(false);
  const [explain, setExplain] = useState(false);
  const [finder, setFinder] = useState(false);
  const [query, setQuery] = useState('');
  const [located, setLocated] = useState<PinRef | null>(null);
  const [adding, setAdding] = useState(false);
  const [dragPreview, setDragPreview] = useState<{ id: string; x: number; y: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const connectHere = useRef<HTMLButtonElement>(null);
  const drag = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, BenchPoint>());
  const pinch = useRef<{ distance: number; center: BenchPoint; view: View } | null>(null);
  const space = useRef(false);
  const suppressClick = useRef(false);
  const press = useRef(false);
  const buttonCallback = useRef(onButton); buttonCallback.current = onButton;
  const initialFit = useRef(false);
  const boardPins = useMemo(() => BOARD_PINOUTS[boardKey].headers.flatMap(header => header.pins).filter(pin => boardPinPoint(boardKey, pin.id)), [boardKey]);
  const inspection = useMemo(() => scenario ? inspectCircuit(layout, scenario) : null, [layout, scenario]);
  const lit = useMemo(() => scenario ? undefined : physicalLedStates(layout, boardKey, pins), [layout, boardKey, pins, scenario]);
  const nets = useMemo(() => physicalNets(layout, boardKey), [layout, boardKey]);
  const safetyWarnings = useMemo(() => connectionWarnings(layout, boardKey), [layout, boardKey]);
  const occupied = useMemo(() => {
    const result = new Map<string, string>();
    for (const part of layout.components) for (const [pin, hole] of Object.entries(part.holes ?? {})) result.set(hole, `${part.instanceId} ${pin}`);
    for (const wire of layout.wires) for (const ref of [wire.a, wire.b]) if (ref.kind === 'breadboard') result.set(ref.pinId, `jumper ${wire.id}`);
    return result;
  }, [layout]);
  const selectedPart = selection?.kind === 'part' ? layout.components.find(part => part.instanceId === selection.id) : undefined;
  const selectedWire = selection?.kind === 'wire' ? layout.wires.find(wire => wire.id === selection.id) : undefined;
  const activeRef = hover ?? pending ?? located ?? (selection?.kind === 'hole' ? { kind: 'breadboard' as const, pinId: selection.id } : null);
  const activeNet = activeRef ? nets.get(pinRefKey(activeRef)) : undefined;
  const selectedDefinition = selectedPart ? PARTS.get(selectedPart.componentId) : undefined;
  const locatedSeat = located?.kind === 'component' ? layout.components.find(part => part.instanceId === located.instanceId)?.holes?.[located.pinId] : undefined;
  const locatedCanAct = located && !!endpointPoint(located) && (located.kind !== 'breadboard' || !occupied.has(located.pinId));

  function publish(next: BreadboardLayout, remember = true) {
    if (remember) { history.current = [...history.current.slice(-39), current.current]; setUndoCount(history.current.length); }
    current.current = next;
    if (controlled === undefined) setLocal(next);
    onLayoutChange?.(next);
  }
  function updatePart(id: string, update: Partial<PlacedComponent>) {
    const next = { ...current.current, components: current.current.components.map(part => part.instanceId === id ? { ...part, ...update } : part) };
    const issues = placementIssues(next);
    if (issues.length) { setMessage(issues[0]); return false; }
    if (pending?.kind === 'component' && pending.instanceId === id) { setPending(null); setRoute([]); }
    publish(next); return true;
  }
  function undo() {
    const previous = history.current.pop();
    if (!previous) return;
    publish(previous, false); setUndoCount(history.current.length);
    setSelection(null); setPending(null); setLocated(null); setHover(null); setRoute([]); setMessage('Last edit undone.');
  }
  function removeSelection() {
    if (!selection) return;
    const next = current.current;
    if (selection.kind === 'wire') publish({ ...next, wires: next.wires.filter(wire => wire.id !== selection.id) });
    if (selection.kind === 'part') publish({ ...next, components: next.components.filter(part => part.instanceId !== selection.id), wires: next.wires.filter(wire => ![wire.a, wire.b].some(ref => ref.kind === 'component' && ref.instanceId === selection.id)) });
    setSelection(null); setPending(null); setLocated(null); setHover(null); setRoute([]); setMessage('Removed. Undo restores your last edit.');
  }
  const setViewport = useCallback((next: View) => { viewRef.current = next; setView(next); }, []);
  const fit = useCallback(() => {
    const element = canvas.current;
    if (!element) return;
    const bounds = { left: 35, top: 105, right: 1345, bottom: 620 };
    for (const part of current.current.components) {
      const center = componentCenter(part);
      bounds.left = Math.min(bounds.left, center.x - 90); bounds.right = Math.max(bounds.right, center.x + 90);
      bounds.top = Math.min(bounds.top, center.y - 75); bounds.bottom = Math.max(bounds.bottom, center.y + 80);
    }
    const width = element.clientWidth, height = element.clientHeight;
    const scale = Math.max(.18, Math.min(1.7, (width - 48) / (bounds.right - bounds.left), (height - 64) / (bounds.bottom - bounds.top)));
    setViewport({ scale, x: (width - (bounds.right - bounds.left) * scale) / 2 - bounds.left * scale, y: (height - (bounds.bottom - bounds.top) * scale) / 2 - bounds.top * scale });
  }, [setViewport]);
  function zoom(scale: number, at?: BenchPoint) {
    const element = canvas.current; if (!element) return;
    const old = viewRef.current;
    const nextScale = Math.max(.18, Math.min(4, scale));
    const anchor = at ?? { x: element.clientWidth / 2, y: element.clientHeight / 2 };
    setViewport({ scale: nextScale, x: anchor.x - (anchor.x - old.x) / old.scale * nextScale, y: anchor.y - (anchor.y - old.y) / old.scale * nextScale });
  }
  function endpointPoint(ref: PinRef): BenchPoint | undefined {
    if (ref.kind === 'board') return boardPinPoint(boardKey, ref.pinId);
    if (ref.kind === 'breadboard') return holePoint(ref.pinId);
    const part = current.current.components.find(part => part.instanceId === ref.instanceId);
    return part ? componentPinPoint(part, ref.pinId) : undefined;
  }
  function focusPoint(point: BenchPoint, minimumScale: number) {
    setExplain(false);
    requestAnimationFrame(() => {
      const element = canvas.current; if (!element) return;
      const scale = Math.max(minimumScale, viewRef.current.scale);
      setViewport({ scale, x: element.clientWidth / 2 - point.x * scale, y: element.clientHeight / 2 - point.y * scale });
    });
  }
  function locate(ref: PinRef) {
    const point = endpointPoint(ref);
    if (!point) return;
    focusPoint(point, 1.8);
    setLocated(ref); setHover(null); setFinder(false);
    setMessage(`${describeRef(ref, layout, boardKey)} highlighted. Select its socket or use the connection button below.`);
    requestAnimationFrame(() => connectHere.current?.focus({ preventScroll: true }));
  }
  function choose(ref: PinRef) {
    if (!endpointPoint(ref) || (pending && !endpointPoint(pending))) {
      setPending(null); setLocated(null); setRoute([]);
      setMessage('That endpoint no longer exists. Select a pin or socket on the current circuit.');
      return;
    }
    setLocated(ref);
    if (ref.kind === 'breadboard') {
      setSelection({ kind: 'hole', id: ref.pinId });
      if (occupied.has(ref.pinId)) { setMessage(`${ref.pinId} contains ${occupied.get(ref.pinId)}. Choose a free socket in its highlighted connected group.`); return; }
    }
    if (ref.kind === 'component') {
      const part = layout.components.find(part => part.instanceId === ref.instanceId);
      if (part?.holes?.[ref.pinId]) {
        setSelection({ kind: 'part', id: part.instanceId });
        setLocated({ kind: 'breadboard', pinId: part.holes[ref.pinId] });
        setMessage(`${ref.pinId} is inserted in ${part.holes[ref.pinId]}. Connect a free hole in the same strip.`); return;
      }
    }
    if (!pending) { setPending(ref); setRoute([]); setMessage(`Connecting ${describeRef(ref, layout, boardKey)} → choose destination. Click empty bench to add a bend.`); return; }
    if (samePinRef(pending, ref)) { setPending(null); setRoute([]); setMessage('Jumper cancelled.'); return; }
    if (layout.wires.some(wire => samePinRef(wire.a, pending) && samePinRef(wire.b, ref) || samePinRef(wire.b, pending) && samePinRef(wire.a, ref))) { setMessage('Those terminals already have a jumper.'); return; }
    if (layout.wires.length >= 128) { setMessage('The bench supports 128 jumpers. Remove one before adding another.'); return; }
    const wire: Wire = { id: `wire-${crypto.randomUUID()}`, a: pending, b: ref, status: 'ok', color, ...(route.length ? { bends: route } : {}) };
    const next = { ...current.current, wires: [...current.current.wires, wire] };
    const issues = placementIssues(next);
    if (issues.length) { setMessage(issues[0]); return; }
    publish(next); setPending(null); setRoute([]); setCursor(null); setSelection({ kind: 'wire', id: wire.id });
    setMessage(`Connected ${describeRef(wire.a, layout, boardKey)} → ${describeRef(wire.b, layout, boardKey)}.`);
  }
  function addComponent(componentId: string) {
    if (layout.components.length >= 32) { setMessage('The bench supports 32 parts. Remove a part before adding another.'); return; }
    const definition = PARTS.get(componentId); if (!definition) return;
    const holes: Record<string, string> = {};
    if (componentId === 'resistor' || componentId === 'led') {
      const span = componentId === 'resistor' ? 5 : 1;
      for (let number = 2; number + span <= 30; number++) {
        const a = `e${number}`, b = `e${number + span}`;
        if (!occupied.has(a) && !occupied.has(b)) { holes[definition.pins[0].id] = a; holes[definition.pins[1].id] = b; break; }
      }
    }
    const part: PlacedComponent = { instanceId: `${componentId}-${crypto.randomUUID().slice(0, 6)}`, componentId, x: 570 + layout.components.length % 4 * 170, y: 640, holes, ...(componentId === 'resistor' ? { resistanceOhms: 330 } : {}) };
    publish({ ...layout, components: [...layout.components, part] });
    setSelection({ kind: 'part', id: part.instanceId }); setAdding(false); setMessage(`${definition.name} added. Inspect its leads below or drag the body to place it.`);
  }
  function pointerPoint(event: { clientX: number; clientY: number }): BenchPoint {
    const bounds = canvas.current!.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }
  function worldPoint(point: BenchPoint): BenchPoint { const v = viewRef.current; return { x: (point.x - v.x) / v.scale, y: (point.y - v.y) / v.scale }; }
  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.button !== 1) return;
    if ((event.target as Element).closest('.bench-hud')) return;
    const point = pointerPoint(event);
    if (!pointers.current.size) suppressClick.current = false;
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { distance: pointDistance(a, b), center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view: { ...viewRef.current } };
      drag.current = null; setDragPreview(null); suppressClick.current = true;
      event.currentTarget.setPointerCapture(event.pointerId); return;
    }
    const target = event.target as Element;
    const part = target.closest('[data-part-id]')?.getAttribute('data-part-id') ?? undefined;
    const isEndpoint = target.closest('[data-endpoint]');
    const isWire = target.closest('[data-wire-id]');
    if (space.current || mode === 'pan' || event.button === 1 || part || (!isEndpoint && !isWire)) {
      drag.current = { pointerId: event.pointerId, start: point, last: point, view: { ...viewRef.current }, part: mode === 'wire' && !space.current ? part : undefined, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
      if (event.button === 1) event.preventDefault();
    }
  }
  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const point = pointerPoint(event); if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, point);
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]; const gesture = pinch.current;
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const scale = Math.max(.18, Math.min(4, gesture.view.scale * pointDistance(a, b) / Math.max(1, gesture.distance)));
      setViewport({ scale, x: center.x - (gesture.center.x - gesture.view.x) / gesture.view.scale * scale, y: center.y - (gesture.center.y - gesture.view.y) / gesture.view.scale * scale }); return;
    }
    if (pending) setCursor(worldPoint(point));
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    state.last = point;
    if (pointDistance(point, state.start) > 5) state.moved = true;
    if (!state.moved) return;
    suppressClick.current = true;
    if (state.part) setDragPreview({ id: state.part, x: (point.x - state.start.x) / state.view.scale, y: (point.y - state.start.y) / state.view.scale });
    else setViewport({ ...state.view, x: state.view.x + point.x - state.start.x, y: state.view.y + point.y - state.start.y });
  }
  function pointerUp(event: ReactPointerEvent<HTMLDivElement>, cancelled = false) {
    pointers.current.delete(event.pointerId);
    if (pinch.current) { if (pointers.current.size < 2) pinch.current = null; drag.current = null; setDragPreview(null); return; }
    const state = drag.current; drag.current = null; setDragPreview(null);
    if (!state || state.pointerId !== event.pointerId || cancelled || !state.part) return;
    if (!state.moved) {
      setSelection({ kind: 'part', id: state.part }); setLocated(null);
      suppressClick.current = true;
      return;
    }
    const part = current.current.components.find(part => part.instanceId === state.part); if (!part) return;
    const delta = { x: (state.last.x - state.start.x) / state.view.scale, y: (state.last.y - state.start.y) / state.view.scale };
    const holes: Record<string, string> = {};
    let allSeated = true;
    for (const pin of PARTS.get(part.componentId)?.pins ?? []) {
      const old = componentPinPoint(part, pin.id)!;
      const desired = { x: old.x + delta.x, y: old.y + delta.y };
      let closest = BREADBOARD_HOLES[0], distance = Infinity;
      for (const hole of BREADBOARD_HOLES) { const d = pointDistance(hole, desired); if (d < distance) { distance = d; closest = hole; } }
      if (distance > 17) { allSeated = false; break; }
      holes[pin.id] = closest.id;
    }
    if (allSeated) {
      if (updatePart(part.instanceId, { holes })) setMessage('Leads inserted. Their breadboard strips now determine the connections.');
    } else {
      const center = componentCenter(part); const desired = { x: center.x + delta.x, y: center.y + delta.y };
      const inside = desired.x > 500 && desired.x < 1330 && desired.y > 160 && desired.y < 590;
      if (inside) setMessage('Align each lead with a hole, or choose exact holes in the part inspector. No placement changed.');
      else if (updatePart(part.instanceId, { holes: {}, x: Math.max(20, Math.min(1300, desired.x - 13)), y: Math.max(60, Math.min(690, desired.y - 18)) })) setMessage('Part lifted off the breadboard. Its old strip connections are disconnected.');
    }
  }
  function sceneClick(event: React.MouseEvent<HTMLDivElement>) {
    if (suppressClick.current) { suppressClick.current = false; return; }
    if ((event.target as Element).closest('[data-endpoint],[data-part-id],[data-wire-id],.bench-hud')) return;
    if (pending && mode === 'wire') { if (route.length < 16) setRoute(points => [...points, worldPoint(pointerPoint(event))]); }
    else { setSelection(null); setLocated(null); }
  }
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (editable(event.target)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (pending) { setPending(null); setRoute([]); setMessage('Jumper cancelled.'); }
      else if (finder || adding) { setFinder(false); setAdding(false); }
      else if (expanded) { setExpanded(false); expandButton.current?.focus(); }
      else setSelection(null);
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(); }
    if (event.key === 'Delete' || event.key === 'Backspace') { if (selection && selection.kind !== 'hole') { event.preventDefault(); removeSelection(); } }
    if (event.target === canvas.current) {
      if (event.code === 'Space') { event.preventDefault(); space.current = true; }
      if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(viewRef.current.scale * 1.25); }
      if (event.key === '-') { event.preventDefault(); zoom(viewRef.current.scale / 1.25); }
      if (event.key === 'Home' || event.key === '0') { event.preventDefault(); fit(); }
      if (event.key.startsWith('Arrow')) { event.preventDefault(); const v = viewRef.current; setViewport({ ...v, x: v.x + (event.key === 'ArrowLeft' ? 50 : event.key === 'ArrowRight' ? -50 : 0), y: v.y + (event.key === 'ArrowUp' ? 50 : event.key === 'ArrowDown' ? -50 : 0) }); }
    }
    if (expanded && event.key === 'Tab' && root.current) {
      const focusable = [...root.current.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,[tabindex="0"]')].filter(element => element.getClientRects().length > 0);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }

  useEffect(() => {
    if (isolated) return;
    try { localStorage.setItem(STORAGE_PREFIX + boardKey, JSON.stringify(local)); }
    catch { setMessage('Browser storage is unavailable. Your edits remain available until you leave this bench.'); }
  }, [boardKey, local, isolated]);
  useLayoutEffect(() => {
    const element = canvas.current; if (!element) return;
    const observer = new ResizeObserver(() => { if (!initialFit.current && element.clientWidth > 0) { initialFit.current = true; fit(); } });
    observer.observe(element); return () => observer.disconnect();
  }, [fit]);
  useEffect(() => {
    const element = canvas.current; if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault(); const bounds = element.getBoundingClientRect();
      const old = viewRef.current; const scale = Math.max(.18, Math.min(4, old.scale * Math.exp(-event.deltaY * .008)));
      const anchor = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      setViewport({ scale, x: anchor.x - (anchor.x - old.x) / old.scale * scale, y: anchor.y - (anchor.y - old.y) / old.scale * scale });
    };
    element.addEventListener('wheel', wheel, { passive: false }); return () => element.removeEventListener('wheel', wheel);
  }, [setViewport]);
  useEffect(() => {
    if (!expanded) return;
    const old = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = old; };
  }, [expanded]);
  useEffect(() => () => { if (press.current) buttonCallback.current?.(false); }, []);
  useEffect(() => { if (!enabled && press.current) { press.current = false; buttonCallback.current?.(false); } }, [enabled]);

  const from = pending ? endpointPoint(pending) : undefined;
  const selectedNet = (ref: PinRef) => !!activeNet && nets.get(pinRefKey(ref)) === activeNet;
  function endpoint(ref: PinRef, point: BenchPoint) {
    const isPending = !!pending && samePinRef(pending, ref);
    const isLocated = !!located && samePinRef(located, ref);
    const isOccupied = ref.kind === 'breadboard' && occupied.has(ref.pinId);
    const live = ref.kind === 'board' ? pins[LIVE_PIN_INDEX[boardKey][ref.pinId]] : undefined;
    return <g key={pinRefKey(ref)} data-endpoint={pinRefKey(ref)} className={`bench-endpoint${selectedNet(ref) ? ' is-net' : ''}${isPending ? ' is-pending' : ''}${isLocated ? ' is-located' : ''}${isOccupied ? ' is-occupied' : ''}${live === 1 ? ' is-high' : ''}`} role="button" tabIndex={-1} aria-label={`${describeRef(ref, layout, boardKey)}${isOccupied ? ` occupied by ${occupied.get(ref.pinId)}` : ''}`} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(ref); } }} onClick={event => { event.stopPropagation(); if (suppressClick.current) { suppressClick.current = false; return; } if (mode === 'wire') choose(ref); }} onPointerEnter={() => setHover(ref)} onPointerLeave={() => setHover(null)}>
      <title>{describeRef(ref, layout, boardKey)}{ref.kind === 'breadboard' ? ` · ${holeNet(ref.pinId)} connected strip${isOccupied ? ' · occupied' : ''}` : live === undefined ? '' : ` · ${live ? 'HIGH' : 'LOW'}`}</title>
      {isLocated && <circle cx={point.x} cy={point.y} r="16" className="bench-pin-locator" />}
      <rect x={point.x - 5} y={point.y - 5} width="10" height="10" rx={ref.kind === 'board' ? 1 : 3} className="bench-socket-rim" />
      <circle cx={point.x} cy={point.y} r={isOccupied ? 3.5 : 2.4} className="bench-socket-core" />
      <circle cx={point.x} cy={point.y} r="10" className="bench-pin-hit" />
    </g>;
  }
  const findResults = useMemo<{ ref: PinRef; label: string }[]>(() => [
    ...boardPins.map(pin => ({ ref: { kind: 'board' as const, pinId: pin.id }, label: `${pin.id} · ${pin.id === 'VIN' ? 'external supply input' : pin.kind}${pin.voltage ? ` · ${pin.voltage} V` : ''}` })),
    ...layout.components.flatMap(part => (PARTS.get(part.componentId)?.pins ?? []).map(pin => ({ ref: { kind: 'component' as const, instanceId: part.instanceId, pinId: pin.id }, label: `${PARTS.get(part.componentId)?.name} ${part.instanceId} · ${pin.label}` }))),
    ...(query.trim() ? BREADBOARD_HOLES.filter(hole => hole.id.toLowerCase() === query.trim().toLowerCase()).map(hole => ({ ref: { kind: 'breadboard' as const, pinId: hole.id }, label: `Hole ${hole.id} · ${hole.net}` })) : []),
  ].filter(result => !query.trim() || result.label.toLowerCase().includes(query.trim().toLowerCase())), [boardPins, layout, query]);
  const statusRef = hover ?? located;
  return <div ref={root} className={`breadboard physical-bench${scenario ? ' breadboard-lesson' : ''}${expanded ? ' bench-expanded' : ''}`} role={expanded ? 'dialog' : 'region'} aria-modal={expanded || undefined} aria-label="Physical electronics bench" onKeyDown={keyDown}>
    <div className="bench-toolbar">
      <div className="bench-view-switch" role="group" aria-label="Circuit representation"><button type="button" aria-pressed={!explain} onClick={() => setExplain(false)}>Physical bench</button><button type="button" aria-pressed={explain} onClick={() => setExplain(true)}>Explain connections</button></div>
      <div className="bench-tools">
        <button type="button" onClick={() => { setAdding(value => !value); setFinder(false); }} aria-expanded={adding}>+ Parts</button>
        <button type="button" onClick={() => { setFinder(value => !value); setAdding(false); }} aria-expanded={finder}><MagnifyingGlass size={16} />Find a pin</button>
        <button type="button" onClick={undo} disabled={!undoCount} title="Undo last circuit edit (⌘/Ctrl Z)" aria-label="Undo circuit edit"><ArrowUUpLeft size={17} /></button>
        <button type="button" onClick={() => { publish(structuredClone(scenario?.initialLayout ?? EMPTY)); setSelection(null); setPending(null); setLocated(null); setHover(null); setRoute([]); setMessage(scenario ? 'Activity restored to its starting circuit. Undo is available.' : 'Bench cleared. Undo is available.'); }} aria-label={scenario ? 'Reset circuit' : 'Clear wiring'} title={scenario ? 'Reset circuit' : 'Clear wiring'}><ArrowCounterClockwise size={17} /></button>
        <button ref={expandButton} type="button" onClick={() => setExpanded(value => !value)} aria-label={expanded ? 'Close expanded bench' : 'Expand bench'} title={expanded ? 'Close expanded bench' : 'Expand bench'}>{expanded ? <ArrowsInSimple size={18} /> : <ArrowsOutSimple size={18} />}</button>
      </div>
    </div>
    {finder && <section className="bench-finder" aria-label="Pin finder"><div><strong>Find a pin or hole</strong><button type="button" aria-label="Close pin finder" onClick={() => setFinder(false)}><X size={17} /></button></div><input autoFocus type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="D8, GND, anode, c19…" aria-label="Search pins and holes" /><p>Locate first, then select the highlighted socket to wire it.</p><div className="bench-finder-results">{findResults.map(result => <button key={pinRefKey(result.ref)} type="button" onClick={() => locate(result.ref)}>{result.label}<span>Locate ↗</span></button>)}{!findResults.length && <p>No matching pin or hole. Try D8, GND, or a hole such as c19.</p>}</div></section>}
    {adding && <section className="bench-parts-bin" aria-label="Component parts bin">{BREADBOARD_PARTS.filter(part => !scenario || scenario.allowedParts.includes(part.id)).map(part => <button key={part.id} type="button" onClick={() => addComponent(part.id)}>{part.id === 'resistor' ? <svg viewBox="0 0 64 30" aria-hidden="true"><path d="M1 15H63" stroke="#89979a" strokeWidth="3" /><rect x="17" y="6" width="30" height="18" rx="6" fill="#dfc18b" /><path d="M24 6V24 M31 6V24" stroke="#c74437" strokeWidth="4" /></svg> : part.id === 'led' ? <svg viewBox="0 0 64 30" aria-hidden="true"><path d="M27 18V29 M37 18V29" stroke="#89979a" strokeWidth="2" /><path d="M21 20V12A11 11 0 0 1 43 12V20Z" fill="#c5473f" /></svg> : <span className="bench-module-preview" aria-hidden="true" />}<span>{part.name}</span></button>)}</section>}
    <div className="bench-scene-wrap" hidden={explain}>
      <div ref={canvas} className={`bench-scene${mode === 'pan' ? ' is-pan' : ''}`} tabIndex={0} aria-label="Circuit canvas. Plus and minus zoom; arrows pan; Home fits the circuit. Use Find a pin for keyboard wiring." onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={event => pointerUp(event)} onPointerCancel={event => pointerUp(event, true)} onLostPointerCapture={event => { pointers.current.delete(event.pointerId); }} onClick={sceneClick} onKeyUp={event => { if (event.code === 'Space') space.current = false; }} onBlur={() => { space.current = false; }}>
        <svg className="bench-world" width="100%" height="100%" aria-label="Arduino and solderless breadboard physical wiring surface">
          <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
            <BenchBoard boardKey={boardKey} pins={pins} />
            <text x="500" y="118" className="bench-object-title">Solderless breadboard</text><text x="500" y="141" className="bench-object-caption">Five-hole strips · separate sides · continuous rails</text>
            <rect x={BREADBOARD_BODY.x + 3} y={BREADBOARD_BODY.y + 7} width={BREADBOARD_BODY.width} height={BREADBOARD_BODY.height} rx="14" fill="var(--bench-board-shadow)" />
            <rect {...BREADBOARD_BODY} rx="12" fill="#eeeae0" stroke="#c3c3b7" strokeWidth="2" />
            <rect x="524" y="382" width="786" height="17" rx="6" fill="#cbc9bf" /><path d="M532 388H1302" stroke="#b6b7af" strokeWidth="2" />
            {[189, 253, 526, 590].map((y, index) => <g key={y}><path d={`M548 ${y}H1280`} stroke={index % 2 ? '#4f8ab1' : '#c86758'} strokeWidth="2" /><text x="531" y={y + 5} fill={index % 2 ? '#376887' : '#9c4337'} fontSize="19">{index % 2 ? '−' : '+'}</text></g>)}
            {Array.from({ length: 30 }, (_, index) => <g key={index}><text x={565 + index * 24} y="267" textAnchor="middle" fill="#646c68" fontSize="12">{index + 1}</text><text x={565 + index * 24} y="518" textAnchor="middle" fill="#646c68" fontSize="12">{index + 1}</text></g>)}
            {Array.from('abcdefghij', (letter, index) => <g key={letter}><text x="542" y={(index < 5 ? 276 + index * 22 : 414 + (index - 5) * 22) + 4} textAnchor="middle" fill="#5d6863" fontSize="14">{letter}</text><text x="1293" y={(index < 5 ? 276 + index * 22 : 414 + (index - 5) * 22) + 4} textAnchor="middle" fill="#5d6863" fontSize="14">{letter}</text></g>)}
            {activeNet && BREADBOARD_HOLES.filter(hole => nets.get(pinRefKey({ kind: 'breadboard', pinId: hole.id })) === activeNet).map(hole => <circle key={`highlight:${hole.id}`} cx={hole.x} cy={hole.y} r="10" fill="#b4d7c0" />)}
            {BREADBOARD_HOLES.map(hole => endpoint({ kind: 'breadboard', pinId: hole.id }, hole))}
            {layout.wires.map((wire, index) => {
              const a = endpointPoint(wire.a), b = endpointPoint(wire.b); if (!a || !b) return null;
              const d = wirePath([a, ...(wire.bends ?? []), b], (index % 4) * 8);
              return <g key={wire.id} data-wire-id={wire.id} className={`bench-jumper${selectedWire?.id === wire.id ? ' is-selected' : ''}`} onClick={event => { event.stopPropagation(); if (suppressClick.current) { suppressClick.current = false; return; } setSelection({ kind: 'wire', id: wire.id }); setLocated(null); setMessage(`Jumper ${index + 1} selected. Delete removes it; Undo restores it.`); }}>
                <title>Jumper {index + 1}: {describeRef(wire.a, layout, boardKey)} → {describeRef(wire.b, layout, boardKey)}</title>
                <path d={d} className="bench-wire-hit" /><path d={d} className="bench-wire-outline" /><path d={d} stroke={wire.status === 'overvoltage' ? '#ce493e' : wire.color ?? WIRE_COLORS[index % WIRE_COLORS.length]} className="bench-wire-color" />
                <circle cx={a.x} cy={a.y} r="4" fill="#3d4445" /><circle cx={b.x} cy={b.y} r="4" fill="#3d4445" />
              </g>;
            })}
            {layout.components.map(part => <g key={part.instanceId} transform={dragPreview?.id === part.instanceId ? `translate(${dragPreview.x} ${dragPreview.y})` : undefined} opacity={dragPreview?.id === part.instanceId ? .7 : 1}><BenchPart part={part} lit={scenario ? !!inspection?.passed && pins[scenario.outputPin] === 1 : lit?.get(part.instanceId) ?? false} selected={selectedPart?.instanceId === part.instanceId} onSelect={() => { setSelection({ kind: 'part', id: part.instanceId }); setLocated(null); }} />{PARTS.get(part.componentId)?.pins.map(pin => { const point = componentPinPoint(part, pin.id); return point ? endpoint({ kind: 'component', instanceId: part.instanceId, pinId: pin.id }, point) : null; })}</g>)}
            {boardPins.map(pin => { const point = boardPinPoint(boardKey, pin.id); return point ? endpoint({ kind: 'board', pinId: pin.id }, point) : null; })}
            {from && cursor && <path d={wirePath([from, ...route, cursor])} stroke={color} className="bench-wire-preview" />}
          </g>
        </svg>
      </div>
      <div className="bench-hud" role="group" aria-label="Canvas navigation">
        <button type="button" onClick={() => { setMode('wire'); setMessage(pending ? `Connecting ${describeRef(pending, layout, boardKey)} → choose destination.` : 'Select a pin or free hole to start a jumper.'); }} aria-pressed={mode === 'wire'} aria-label="Wire tool" title="Wire tool"><Cursor size={17} /></button>
        <button type="button" onClick={() => { setMode('pan'); setPending(null); setRoute([]); setMessage('Pan mode. Drag the bench to move around; select Wire tool to connect pins.'); }} aria-pressed={mode === 'pan'} aria-label="Pan tool" title="Pan tool or hold Space"><Hand size={18} /></button>
        <span className="bench-hud-divider" />
        <button type="button" onClick={() => zoom(viewRef.current.scale / 1.25)} aria-label="Zoom out"><Minus size={16} /></button>
        <button type="button" className="bench-zoom-value" onClick={() => zoom(1)} title="Reset to 100%" aria-label={`Zoom ${Math.round(view.scale * 100)} percent. Reset to 100 percent.`}>{Math.round(view.scale * 100)}%</button>
        <button type="button" onClick={() => zoom(viewRef.current.scale * 1.25)} aria-label="Zoom in"><Plus size={16} /></button>
        <button type="button" onClick={fit}>Fit circuit</button>
      </div>
      {statusRef && <div className="bench-hover-label" aria-live="off">{describeRef(statusRef, layout, boardKey)}{statusRef.kind === 'breadboard' && <span> · {holeNet(statusRef.pinId)?.startsWith('ae') ? 'a–e' : holeNet(statusRef.pinId)?.startsWith('fj') ? 'f–j' : holeNet(statusRef.pinId)} connected group{occupied.has(statusRef.pinId) ? ' · occupied' : ''}</span>}{statusRef.kind === 'board' && LIVE_PIN_INDEX[boardKey][statusRef.pinId] !== undefined && <span> · {pins[LIVE_PIN_INDEX[boardKey][statusRef.pinId]] ? 'HIGH' : 'LOW'} · {scenario ? 'teaching state' : 'emulated pin'}</span>}</div>}
    </div>
    {explain && <BenchSchematic layout={layout} boardKey={boardKey} selectedPart={selectedPart?.instanceId} selectedWire={selectedWire?.id} onSelectPart={id => setSelection({ kind: 'part', id })} onSelectWire={id => setSelection({ kind: 'wire', id })} />}
    <div className="bench-status" role="status">
      <span className={pending ? 'bench-status-active' : ''}>{message}</span>
      {located && locatedCanAct && (!pending || !samePinRef(pending, located)) && <button ref={connectHere} type="button" className="bench-connect-here" onClick={() => choose(located)}>{locatedSeat ? 'Inspect this lead' : pending ? 'Finish wire here' : 'Start wire here'}</button>}
      {pending && <button type="button" onClick={() => { setPending(null); setRoute([]); setMessage('Jumper cancelled. Select a pin or free hole to start another.'); }}>Cancel wire</button>}
      <div className="bench-wire-palette" role="group" aria-label="Jumper wire color">{WIRE_COLORS.map(value => <button key={value} type="button" style={{ backgroundColor: value }} aria-label={`Use ${['red', 'blue', 'yellow', 'green', 'violet', 'black'][WIRE_COLORS.indexOf(value)]} jumper`} aria-pressed={color === value} onClick={() => { setColor(value); if (selectedWire) publish({ ...layout, wires: layout.wires.map(wire => wire.id === selectedWire.id ? { ...wire, color: value } : wire) }); }} />)}</div>
    </div>
    {safetyWarnings.length > 0 && <div className="bench-safety-warning" role="alert">{safetyWarnings.map(warning => <p key={warning}>{warning}</p>)}</div>}
    {selectedPart && selectedDefinition && <section className="bench-inspector" aria-label="Selected component"><div className="bench-inspector-heading"><strong>{selectedDefinition.name} <span>{selectedPart.instanceId}</span></strong><button type="button" aria-label="Close component inspector" onClick={() => setSelection(null)}><X size={16} /></button></div><div className="bench-inspector-fields">
      {selectedPart.componentId === 'resistor' && <label>Resistance<select aria-label={`Resistance for Resistor ${selectedPart.instanceId}`} value={selectedPart.resistanceOhms ?? ''} onChange={event => updatePart(selectedPart.instanceId, { resistanceOhms: Number(event.target.value) })}><option value="" disabled>Set resistance</option>{[...new Set([...(scenario?.resistanceOptions ?? [100, 220, 330, 470, 1000, 2200, 10000]), ...(selectedPart.resistanceOhms === undefined ? [] : [selectedPart.resistanceOhms])])].sort((a, b) => a - b).map(value => <option key={value} value={value}>{value} Ω</option>)}</select></label>}
      {selectedDefinition.pins.map(pin => <label key={pin.id}>{pin.label}<select aria-label={`Hole for ${selectedPart.instanceId} ${pin.id}`} value={selectedPart.holes?.[pin.id] ?? ''} onChange={event => { const holes = { ...selectedPart.holes }; if (event.target.value) holes[pin.id] = event.target.value; else delete holes[pin.id]; updatePart(selectedPart.instanceId, { holes }); }}><option value="">Not inserted</option>{BREADBOARD_HOLES.map(hole => <option key={hole.id} value={hole.id} disabled={occupied.has(hole.id) && selectedPart.holes?.[pin.id] !== hole.id}>{hole.id}{occupied.has(hole.id) && selectedPart.holes?.[pin.id] !== hole.id ? ' · occupied' : ''}</option>)}</select></label>)}
      {selectedDefinition.pins.length === 2 && <button type="button" onClick={() => { const [a, b] = selectedDefinition.pins; const holes = { ...selectedPart.holes }; const oldA = holes[a.id], oldB = holes[b.id]; delete holes[a.id]; delete holes[b.id]; if (oldA) holes[b.id] = oldA; if (oldB) holes[a.id] = oldB; updatePart(selectedPart.instanceId, { holes }); }}>Swap leads</button>}
      <button type="button" onClick={() => focusPoint(componentCenter(selectedPart), 1.5)}>Focus part</button>
      <button type="button" className="bench-remove" onClick={removeSelection}><Trash size={16} />Remove part</button>
    </div><p>{selectedPart.componentId === 'led' ? 'A / ANODE (+) faces the source; K / CATHODE (−) is the flat-edge side. Inserted leads connect to the five-hole strip beneath them.' : 'A component only connects through its inserted leads or an explicit jumper. Drag the body to reposition; the inspector gives exact placement.'}</p></section>}
    {selectedWire && <section className="bench-inspector bench-jumper-inspector" aria-label="Selected jumper"><span>{describeRef(selectedWire.a, layout, boardKey)} → {describeRef(selectedWire.b, layout, boardKey)}</span><button type="button" onClick={() => publish({ ...layout, wires: layout.wires.map(wire => wire.id === selectedWire.id ? { ...wire, bends: [] } : wire) })}>Straighten</button><button type="button" className="bench-remove" onClick={removeSelection}><Trash size={16} />Remove jumper</button><button type="button" aria-label="Close jumper inspector" onClick={() => setSelection(null)}><X size={16} /></button></section>}
    <div className="bench-footer">
      <span>{scenario ? `Teaching circuit · D${scenario.outputPin} ${pins[scenario.outputPin] ? 'HIGH' : 'LOW'}` : 'Live pin levels · connection model'} · LED current / damage are not simulated.</span>
      <details>
        <summary>How to use the bench</summary>
        <p>Click a pin, then a free socket to wire. A–e holes at one number share a strip; f–j form another. The center trench separates them. The four rails are separate and each runs continuously end to end on this board. Check the markings on real breadboards: some have split rails. Hover a hole to highlight its connected net. Pinch or Ctrl/⌘ + scroll to zoom. Drag empty space or hold Space to pan. + / − zoom and Home fits the circuit when the canvas is focused. Select a jumper and Delete to remove; Ctrl/⌘ Z undoes circuit edits. Find a pin locates an endpoint, then offers a keyboard-accessible button to start or finish a wire.</p>
      </details>
      {onButton && <button type="button" disabled={!enabled}
        onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); press.current = true; onButton(true); }}
        onPointerUp={() => { press.current = false; onButton(false); }}
        onPointerCancel={() => { press.current = false; onButton(false); }}
        onLostPointerCapture={() => { if (press.current) { press.current = false; onButton(false); } }}
        onKeyDown={event => { if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) { event.preventDefault(); press.current = true; onButton(true); } }}
        onKeyUp={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); press.current = false; onButton(false); } }}
        onBlur={() => { if (press.current) { press.current = false; onButton(false); } }}>
        Hold {boardKey === 'arduino-uno' ? 'D2' : 'PA0'} button
      </button>}
    </div>
  </div>;
}
