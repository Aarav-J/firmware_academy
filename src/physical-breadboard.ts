import { LIVE_PIN_INDEX } from './board-pinouts';
import { BOARD_PINOUTS } from './board-pinouts';
import { BREADBOARD_PARTS } from './breadboard-parts';
import type { BoardKey, BreadboardLayout, PinRef, PlacedComponent, Wire } from './breadboard-contracts';

export type BenchPoint = { x: number; y: number };
export type BreadboardHole = BenchPoint & { id: string; net: string };
export const BENCH_SIZE = { width: 1400, height: 740 };
export const BREADBOARD_BODY = { x: 500, y: 160, width: 830, height: 430 };
export const WIRE_COLORS = ['#d75043', '#3b82bb', '#e7ab37', '#309475', '#7e62b1', '#344254'] as const;
const LETTERS = 'abcdefghij';
export const BREADBOARD_HOLES: BreadboardHole[] = Array.from({ length: 30 }, (_, index) => {
  const number = index + 1;
  const x = 565 + index * 24;
  return [
    ...Array.from(LETTERS, (letter, column) => ({ id: `${letter}${number}`, x, y: column < 5 ? 276 + column * 22 : 414 + (column - 5) * 22, net: `${column < 5 ? 'ae' : 'fj'}${number}` })),
    ...(['top+', 'top-', 'bottom+', 'bottom-'] as const).map((rail, row) => ({ id: `${rail}:${number}`, x, y: [205, 229, 542, 566][row], net: rail })),
  ];
}).flat();
const HOLES = new Map(BREADBOARD_HOLES.map(hole => [hole.id, hole]));
const PARTS = new Map(BREADBOARD_PARTS.map(part => [part.id, part]));

export function holePoint(id: string): BreadboardHole | undefined { return HOLES.get(id); }
export function holeNet(id: string): string | null { return HOLES.get(id)?.net ?? null; }
export function pinRefKey(ref: PinRef): string {
  return JSON.stringify(ref.kind === 'component' ? [ref.kind, ref.instanceId, ref.pinId] : [ref.kind, ref.pinId]);
}
export function describeRef(ref: PinRef, layout: BreadboardLayout, boardKey: BoardKey): string {
  if (ref.kind === 'breadboard') return `Hole ${ref.pinId}`;
  if (ref.kind === 'board') {
    const pin = BOARD_PINOUTS[boardKey].headers.flatMap(header => header.pins).find(pin => pin.id === ref.pinId);
    return `Uno ${pin?.kind === 'ground' ? `GND (${ref.pinId})` : ref.pinId}`.replace('Uno ', boardKey === 'arduino-uno' ? 'Uno ' : 'Board ');
  }
  const part = layout.components.find(part => part.instanceId === ref.instanceId);
  const definition = part && PARTS.get(part.componentId);
  return `${definition?.name ?? 'Part'} ${ref.instanceId} · ${definition?.pins.find(pin => pin.id === ref.pinId)?.label ?? ref.pinId}`;
}

/** Virtual copper connections only: component bodies remain separate graph edges. */
export function physicalConnections(layout: BreadboardLayout, boardKey?: BoardKey): Wire[] {
  const connections = [...layout.wires];
  const roots = new Map<string, string>();
  for (const hole of BREADBOARD_HOLES) {
    const root = roots.get(hole.net);
    if (!root) roots.set(hole.net, hole.id);
    else connections.push({ id: `strip:${hole.id}`, a: { kind: 'breadboard', pinId: root }, b: { kind: 'breadboard', pinId: hole.id }, status: 'ok' });
  }
  for (const component of layout.components) for (const [pinId, holeId] of Object.entries(component.holes ?? {})) {
    if (HOLES.has(holeId) && PARTS.get(component.componentId)?.pins.some(pin => pin.id === pinId)) {
      connections.push({ id: `lead:${component.instanceId}:${pinId}`, a: { kind: 'component', instanceId: component.instanceId, pinId }, b: { kind: 'breadboard', pinId: holeId }, status: 'ok' });
    }
  }
  if (boardKey === 'arduino-uno') for (const [a, b] of [['SDA', 'A4'], ['SCL', 'A5'], ['IOREF', '5V']]) {
    connections.push({ id: `board-copper:${a}`, a: { kind: 'board', pinId: a }, b: { kind: 'board', pinId: b }, status: 'ok' });
  }
  return connections;
}

export function placementIssues(layout: BreadboardLayout): string[] {
  const occupied = new Map<string, string>();
  const issues: string[] = [];
  const occupy = (hole: string, owner: string) => {
    if (!HOLES.has(hole)) { issues.push(`Unknown breadboard hole ${hole}.`); return; }
    if (occupied.has(hole)) issues.push(`Hole ${hole} is occupied twice. Use another socket in its connected group.`);
    else occupied.set(hole, owner);
  };
  for (const part of layout.components) for (const [pin, hole] of Object.entries(part.holes ?? {})) {
    if (!PARTS.get(part.componentId)?.pins.some(candidate => candidate.id === pin)) issues.push(`Unknown lead ${pin} on ${part.instanceId}.`);
    occupy(hole, `${part.instanceId}:${pin}`);
  }
  for (const wire of layout.wires) for (const ref of [wire.a, wire.b]) if (ref.kind === 'breadboard') occupy(ref.pinId, wire.id);
  return [...new Set(issues)];
}

/** Legacy terminal wiring is kept exactly; new seats use otherwise isolated strips. */
export function toPhysicalLayout(layout: BreadboardLayout): BreadboardLayout {
  if (layout.version === 2) return layout;
  const usedNets = new Set<string>();
  for (const part of layout.components) for (const hole of Object.values(part.holes ?? {})) { const net = holeNet(hole); if (net) usedNets.add(net); }
  for (const wire of layout.wires) for (const ref of [wire.a, wire.b]) if (ref.kind === 'breadboard') { const net = holeNet(ref.pinId); if (net) usedNets.add(net); }
  const seats = BREADBOARD_HOLES.filter(hole => (hole.id.startsWith('e') || hole.id.startsWith('j')) && !usedNets.has(hole.net));
  let strip = 0;
  const components = layout.components.map((part, index) => {
    const pins = PARTS.get(part.componentId)?.pins ?? [];
    const holes: Record<string, string> = {};
    if (part.holes) return { ...part, holes: { ...part.holes } };
    if ((part.componentId === 'led' || part.componentId === 'resistor') && strip + pins.length <= seats.length) {
      for (const pin of pins) holes[pin.id] = seats[strip++].id;
    }
    return { ...part, x: 530 + index % 5 * 150, y: 630 + Math.floor(index / 5) * 60, holes };
  });
  const migrateRef = (ref: PinRef): PinRef => ref.kind === 'board' && ref.pinId === 'A-AREF' ? { kind: 'board', pinId: 'D-AREF' } : { ...ref };
  return { version: 2, components, wires: layout.wires.map(wire => ({ ...structuredClone(wire), a: migrateRef(wire.a), b: migrateRef(wire.b) })) };
}

export function decodePhysicalLayout(raw: unknown, boardKey: BoardKey): BreadboardLayout | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.components) || !Array.isArray(value.wires) || value.components.length > 32 || value.wires.length > 128 || (value.version !== undefined && value.version !== 2)) return null;
  const components: PlacedComponent[] = [];
  const ids = new Set<string>();
  const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 10_000;
  const identifier = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 100;
  for (const item of value.components) {
    if (!item || typeof item !== 'object' || !identifier(item.instanceId) || ids.has(item.instanceId) || !PARTS.has(item.componentId) || !finite(item.x) || !finite(item.y)) return null;
    if (item.resistanceOhms !== undefined && (typeof item.resistanceOhms !== 'number' || !Number.isFinite(item.resistanceOhms) || item.resistanceOhms <= 0)) return null;
    const part: PlacedComponent = { instanceId: item.instanceId, componentId: item.componentId, x: item.x, y: item.y };
    if (item.resistanceOhms !== undefined) part.resistanceOhms = item.resistanceOhms;
    if (item.holes !== undefined) {
      if (!item.holes || typeof item.holes !== 'object' || Array.isArray(item.holes)) return null;
      part.holes = {};
      for (const [pin, hole] of Object.entries(item.holes)) {
        if (!PARTS.get(item.componentId)?.pins.some(candidate => candidate.id === pin) || typeof hole !== 'string' || !HOLES.has(hole)) return null;
        part.holes[pin] = hole;
      }
    }
    ids.add(part.instanceId);
    components.push(part);
  }
  const boardPins = new Set(BOARD_PINOUTS[boardKey].headers.flatMap(header => header.pins.map(pin => pin.id)));
  const endpoint = (raw: unknown): PinRef | null => {
    if (!raw || typeof raw !== 'object') return null;
    const ref = raw as Record<string, unknown>;
    if (!identifier(ref.pinId)) return null;
    if (ref.kind === 'board') {
      const pinId = ref.pinId === 'A-AREF' ? 'D-AREF' : ref.pinId;
      return boardPins.has(pinId) ? { kind: 'board', pinId } : null;
    }
    if (ref.kind === 'breadboard') return HOLES.has(ref.pinId) ? { kind: 'breadboard', pinId: ref.pinId } : null;
    if (ref.kind !== 'component' || !identifier(ref.instanceId)) return null;
    const part = components.find(part => part.instanceId === ref.instanceId);
    return part && PARTS.get(part.componentId)?.pins.some(pin => pin.id === ref.pinId) ? { kind: 'component', instanceId: ref.instanceId, pinId: ref.pinId } : null;
  };
  const wires: Wire[] = [];
  const wireIds = new Set<string>();
  for (const item of value.wires) {
    if (!item || typeof item !== 'object' || !identifier(item.id) || wireIds.has(item.id) || (item.status !== 'ok' && item.status !== 'overvoltage')) return null;
    const a = endpoint(item.a), b = endpoint(item.b);
    if (!a || !b) return null;
    const wire: Wire = { id: item.id, a, b, status: item.status };
    if (item.color !== undefined) { if (!WIRE_COLORS.some(color => color === item.color)) return null; wire.color = item.color; }
    if (item.bends !== undefined) {
      if (!Array.isArray(item.bends) || item.bends.length > 16 || item.bends.some((point: BenchPoint) => !point || !finite(point.x) || !finite(point.y))) return null;
      wire.bends = item.bends.map((point: BenchPoint) => ({ x: point.x, y: point.y }));
    }
    wires.push(wire); wireIds.add(wire.id);
  }
  // Invalid electrical choices are retained for teaching; malformed data is not.
  return toPhysicalLayout({ ...(value.version === 2 ? { version: 2 as const } : {}), components, wires });
}

/** Copper-net identity shared by the physical view and schematic. */
export function physicalNets(layout: BreadboardLayout, boardKey: BoardKey): Map<string, string> {
  const parent = new Map<string, string>();
  const root = (key: string): string => {
    if (!parent.has(key)) parent.set(key, key);
    let result = key;
    while (parent.get(result) !== result) result = parent.get(result)!;
    while (parent.get(key) !== result) { const next = parent.get(key)!; parent.set(key, result); key = next; }
    return result;
  };
  const join = (a: PinRef, b: PinRef) => { parent.set(root(pinRefKey(a)), root(pinRefKey(b))); };
  for (const connection of physicalConnections(layout, boardKey)) join(connection.a, connection.b);
  const grounds = BOARD_PINOUTS[boardKey].headers.flatMap(header => header.pins).filter(pin => pin.kind === 'ground');
  for (const ground of grounds.slice(1)) join({ kind: 'board', pinId: grounds[0].id }, { kind: 'board', pinId: ground.id });
  for (const part of layout.components) for (const pin of PARTS.get(part.componentId)?.pins ?? []) root(pinRefKey({ kind: 'component', instanceId: part.instanceId, pinId: pin.id }));
  for (const key of parent.keys()) parent.set(key, root(key));
  return parent;
}

/** Shows protected forward paths, not measured brightness or damage. */
export function physicalLedStates(layout: BreadboardLayout, boardKey: BoardKey, pins: number[]): Map<string, boolean> {
  const result = new Map<string, boolean>();
  const nets = physicalNets(layout, boardKey);
  const netOf = (ref: PinRef) => nets.get(pinRefKey(ref)) ?? pinRefKey(ref);
  const resistors = new Map<string, Set<string>>();
  for (const part of layout.components.filter(part => part.componentId === 'resistor' && typeof part.resistanceOhms === 'number' && Number.isFinite(part.resistanceOhms) && part.resistanceOhms > 0)) {
    const a = netOf({ kind: 'component', instanceId: part.instanceId, pinId: 'A' });
    const b = netOf({ kind: 'component', instanceId: part.instanceId, pinId: 'B' });
    if (a === b) continue;
    if (!resistors.has(a)) resistors.set(a, new Set());
    if (!resistors.has(b)) resistors.set(b, new Set());
    resistors.get(a)!.add(b); resistors.get(b)!.add(a);
  }
  const reachable = (start: string) => {
    const seen = new Set([start]); const queue = [start];
    for (let index = 0; index < queue.length; index++) for (const neighbor of resistors.get(queue[index]) ?? []) if (!seen.has(neighbor)) { seen.add(neighbor); queue.push(neighbor); }
    return seen;
  };
  const grounds = new Set(BOARD_PINOUTS[boardKey].headers.flatMap(header => header.pins).filter(pin => pin.kind === 'ground').map(pin => netOf({ kind: 'board', pinId: pin.id })));
  const high = new Set(Object.entries(LIVE_PIN_INDEX[boardKey]).filter(([, index]) => pins[index] === 1).map(([pinId]) => netOf({ kind: 'board', pinId })));
  for (const pin of BOARD_PINOUTS[boardKey].headers.flatMap(header => header.pins)) if (pin.voltage !== undefined) high.add(netOf({ kind: 'board', pinId: pin.id }));
  const unsafe = placementIssues(layout).length > 0;
  for (const part of layout.components.filter(part => part.componentId === 'led')) {
    const a = netOf({ kind: 'component', instanceId: part.instanceId, pinId: 'ANODE' });
    const k = netOf({ kind: 'component', instanceId: part.instanceId, pinId: 'CATHODE' });
    const anode = reachable(a), cathode = reachable(k);
    const bypassed = [...anode].some(net => cathode.has(net));
    const powered = [...anode].some(net => high.has(net) && !grounds.has(net));
    const grounded = [...cathode].some(net => grounds.has(net));
    const protectedPath = [...anode].some(net => high.has(net) && net !== a) || [...cathode].some(net => grounds.has(net) && net !== k);
    const unprotectedPath = high.has(a) && grounds.has(k);
    result.set(part.instanceId, !unsafe && !bypassed && !unprotectedPath && !high.has(k) && powered && grounded && protectedPath);
  }
  return result;
}

export function connectionWarnings(layout: BreadboardLayout, boardKey: BoardKey): string[] {
  const nets = physicalNets(layout, boardKey);
  const netOf = (ref: PinRef) => nets.get(pinRefKey(ref)) ?? pinRefKey(ref);
  const supplies = new Map<string, number>();
  const grounds = new Set<string>();
  const warnings = new Set<string>();
  for (const pin of BOARD_PINOUTS[boardKey].headers.flatMap(header => header.pins)) {
    const net = netOf({ kind: 'board', pinId: pin.id });
    if (pin.kind === 'ground') grounds.add(net);
    if (pin.voltage !== undefined) {
      const previous = supplies.get(net);
      if (previous !== undefined && previous !== pin.voltage) warnings.add('Different supply voltages share a copper net. Disconnect the rails before using real hardware.');
      supplies.set(net, Math.max(previous ?? 0, pin.voltage));
    }
  }
  for (const net of grounds) if (supplies.has(net)) warnings.add('A supply rail is wired directly to GND. Remove this short before using real hardware.');
  for (const part of layout.components) for (const pin of PARTS.get(part.componentId)?.pins ?? []) {
    const supply = supplies.get(netOf({ kind: 'component', instanceId: part.instanceId, pinId: pin.id }));
    if (supply !== undefined && pin.maxVoltage !== undefined && supply > pin.maxVoltage) warnings.add(`${PARTS.get(part.componentId)!.name} ${part.instanceId}: ${pin.label} is rated for ${pin.maxVoltage} V, but this net is connected to ${supply} V. Real hardware could be damaged.`);
  }
  return [...warnings];
}
