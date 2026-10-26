import type { TraceEvent } from './contracts';

export function retainPinTrace(previous: TraceEvent[], incoming: TraceEvent[], timeUs: number): TraceEvent[] {
  const all = previous.concat(incoming.filter(event => event.type === 'pin'));
  const cutoff = timeUs - 5_000_000;
  const firstRecent = all.findIndex(event => event.timeUs >= cutoff);
  const start = Math.max(firstRecent < 0 ? all.length : firstRecent, all.length - 7968);
  const baseline = new Map<number, TraceEvent>();
  for (let index = 0; index < start; index++) {
    const event = all[index];
    if (event.type === 'pin') baseline.set(event.pin, event);
  }
  return [...baseline.values()].sort((a, b) => a.timeUs - b.timeUs).concat(all.slice(start));
}

export function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

export function appendSerial(previous: string, incoming: string, limit = 24_000): string {
  return (previous + incoming).slice(-limit);
}

export function pinTransitions(events: TraceEvent[], pin: number) {
  return events.filter((event): event is Extract<TraceEvent, { type: 'pin' }> =>
    event.type === 'pin' && event.pin === pin,
  ).filter((event, index, filtered) => index === 0 || event.level !== filtered[index - 1].level);
}

export function measurePin(events: TraceEvent[], pin: number): { frequency: number; duty: number } | null {
  const transitions = pinTransitions(events, pin);
  const rises = transitions.filter(event => event.level === 1);
  if (rises.length < 2) return null;
  const start = rises[0].timeUs;
  const end = rises[rises.length - 1].timeUs;
  if (end <= start) return null;
  let highTime = 0;
  let highStart = start;
  for (const event of transitions) {
    if (event.timeUs < start || event.timeUs > end) continue;
    if (event.level === 1) highStart = event.timeUs;
    else highTime += event.timeUs - highStart;
  }
  return {
    frequency: (rises.length - 1) * 1_000_000 / (end - start),
    duty: highTime / (end - start) * 100,
  };
}

export function digitalPath(events: TraceEvent[], pin: number, start: number, end: number, width: number, high: number, low: number): string {
  if (end <= start) return '';
  const transitions = pinTransitions(events, pin);
  let level: number | null = null;
  for (const event of transitions) {
    if (event.timeUs > start) break;
    level = event.level;
  }
  let path = level === null ? '' : `M 0 ${level ? high : low}`;
  for (const event of transitions) {
    if (event.timeUs <= start || event.timeUs > end) continue;
    const x = (event.timeUs - start) / (end - start) * width;
    path += path ? ` H ${x.toFixed(2)} V ${event.level ? high : low}` : `M ${x.toFixed(2)} ${event.level ? high : low}`;
  }
  return path ? `${path} H ${width}` : '';
}
