import { useMemo } from 'react';
import { BREADBOARD_PARTS } from '../breadboard-parts';
import { BOARD_PINOUTS } from '../board-pinouts';
import { describeRef, holeNet, physicalNets, pinRefKey } from '../physical-breadboard';
import type { BoardKey, BreadboardLayout, PinRef } from '../breadboard-contracts';

export function BenchSchematic({ layout, boardKey, selectedPart, selectedWire, onSelectPart, onSelectWire }: {
  layout: BreadboardLayout; boardKey: BoardKey; selectedPart?: string; selectedWire?: string;
  onSelectPart: (id: string) => void; onSelectWire: (id: string) => void;
}) {
  const graph = useMemo(() => {
    const nets = physicalNets(layout, boardKey);
    const nodes = new Map<string, { labels: Set<string>; refs: PinRef[] }>();
    const add = (ref: PinRef) => {
      const key = nets.get(pinRefKey(ref)) ?? pinRefKey(ref);
      const node = nodes.get(key) ?? { labels: new Set<string>(), refs: [] };
      if (ref.kind === 'board') node.labels.add(describeRef(ref, layout, boardKey));
      if (ref.kind === 'breadboard') node.labels.add(holeNet(ref.pinId)?.replace(/^ae/, 'a–e / ').replace(/^fj/, 'f–j / ') ?? ref.pinId);
      if (ref.kind === 'component') node.labels.add(`${ref.instanceId} · ${ref.pinId === 'ANODE' ? 'A / anode' : ref.pinId === 'CATHODE' ? 'K / cathode' : ref.pinId}`);
      node.refs.push(ref); nodes.set(key, node); return key;
    };
    for (const wire of layout.wires) { add(wire.a); add(wire.b); }
    const edges = layout.components.flatMap(part => {
      const definition = BREADBOARD_PARTS.find(definition => definition.id === part.componentId);
      const keys = (definition?.pins ?? []).map(pin => {
        const ref: PinRef = { kind: 'component', instanceId: part.instanceId, pinId: pin.id };
        const key = add(ref);
        if (part.holes?.[pin.id]) add({ kind: 'breadboard', pinId: part.holes[pin.id] });
        return key;
      });
      return definition && keys.length ? [{ part, definition, keys }] : [];
    });
    // Ground pins share the board's ground plane even when a different socket is used.
    for (const pin of BOARD_PINOUTS[boardKey].headers.flatMap(header => header.pins).filter(pin => pin.kind === 'ground')) {
      const key = nets.get(pinRefKey({ kind: 'board', pinId: pin.id }));
      if (key && nodes.has(key)) nodes.get(key)!.labels.add('GND');
    }
    const ordered: string[] = [];
    const seen = new Set<string>();
    const visit = (key: string) => {
      if (seen.has(key)) return;
      seen.add(key); ordered.push(key);
      for (const edge of edges) if (edge.keys.includes(key)) for (const neighbor of edge.keys) visit(neighbor);
    };
    const source = [...nodes].find(([, node]) => [...node.labels].some(label => /Uno D\d|Board P[ABD]\d/.test(label)));
    if (source) visit(source[0]);
    for (const key of nodes.keys()) visit(key);
    return { nodes, ordered, edges, nets };
  }, [layout, boardKey]);
  const columns = Math.min(5, Math.max(1, graph.ordered.length));
  const height = Math.max(370, Math.ceil(graph.ordered.length / columns) * 220 + 120);
  let moduleHeight = 0;
  const modules = graph.edges.filter(edge => edge.keys.length > 2).map(edge => {
    const top = height + moduleHeight;
    moduleHeight += 110 + edge.keys.length * 36;
    return { ...edge, top };
  });
  const point = (key: string) => {
    const index = graph.ordered.indexOf(key);
    return { x: 130 + (index % columns) * (1100 / Math.max(1, columns - 1)), y: 150 + Math.floor(index / columns) * 220 };
  };
  const wireNets = new Set(layout.wires.filter(wire => wire.id === selectedWire).flatMap(wire => [graph.nets.get(pinRefKey(wire.a)), graph.nets.get(pinRefKey(wire.b))]));
  return <div className="bench-schematic">
    <div className="bench-schematic-heading"><strong>What is actually connected?</strong><span>Each dot is one copper net. Parts connect nets; gaps stay disconnected.</span></div>
    {!graph.ordered.length ? <p>Add a component or jumper to see its connections here.</p> : <svg viewBox={`0 0 1400 ${height + moduleHeight}`} role="group" aria-label="Electrical nets and actual component connections">
      {graph.edges.filter(edge => edge.keys.length <= 2).map(({ part, definition, keys }) => {
        const a = point(keys[0]), b = point(keys[1] ?? keys[0]);
        const same = keys[0] === keys[1];
        const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
        return <g key={part.instanceId} className={`bench-schematic-part${selectedPart === part.instanceId ? ' is-selected' : ''}`} onClick={() => onSelectPart(part.instanceId)} role="button" tabIndex={0} aria-label={`Inspect ${definition.name} ${part.instanceId}`} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectPart(part.instanceId); } }}>
          <path d={same ? `M${a.x} ${a.y} C${a.x - 100} ${a.y - 130} ${a.x + 100} ${a.y - 130} ${a.x} ${a.y}` : `M${a.x} ${a.y} L${b.x} ${b.y}`} className="bench-schematic-edge" />
          <rect x={x - 64} y={y - (same ? 110 : 24)} width="128" height="48" rx="4" className="bench-schematic-symbol" />
          <text x={x} y={y - (same ? 80 : -5)} textAnchor="middle">{part.componentId === 'resistor' ? (part.resistanceOhms === undefined ? 'Set Ω' : `${part.resistanceOhms} Ω`) : part.componentId === 'led' ? (a.x <= b.x ? 'A ▷| K' : 'K |◁ A') : definition.name}</text>
          <text x={x} y={y + (same ? -119 : -38)} textAnchor="middle" className="bench-schematic-label">{part.instanceId}{same ? ' · bypassed by copper' : ''}</text>
        </g>;
      })}
      {graph.ordered.map((key, index) => { const p = point(key); const node = graph.nodes.get(key)!; return <g key={key} className={wireNets.has(key) ? 'bench-schematic-net is-selected' : 'bench-schematic-net'}>
        <circle cx={p.x} cy={p.y} r="8" />
        <text x={p.x} y={p.y + 35} textAnchor="middle" className="bench-schematic-label">Net {index + 1}</text>
        {[...node.labels].slice(0, 6).map((label, row) => <text key={label} x={p.x} y={p.y + 60 + row * 23} textAnchor="middle">{label}</text>)}
        {!node.labels.size && <text x={p.x} y={p.y + 60} textAnchor="middle">Unconnected terminal</text>}
      </g>; })}
      {modules.map(({ part, definition, keys, top }) => <g key={part.instanceId} className={`bench-schematic-part bench-schematic-module${selectedPart === part.instanceId ? ' is-selected' : ''}`} data-component-id={part.instanceId} role="button" tabIndex={0} aria-label={`Inspect ${definition.name} ${part.instanceId}`} onClick={() => onSelectPart(part.instanceId)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectPart(part.instanceId); } }}>
        <rect x="130" y={top + 12} width="260" height={70 + keys.length * 36} rx="5" className="bench-schematic-symbol" />
        <text x="148" y={top + 40}>{definition.name}</text>
        <text x="148" y={top + 62} className="bench-schematic-label">{part.instanceId.length > 28 ? `${part.instanceId.slice(0, 28)}…` : part.instanceId}</text>
        {keys.map((key, index) => {
          const y = top + 90 + index * 36;
          return <g key={definition.pins[index].id}>
            <text x="374" y={y + 5} textAnchor="end">{definition.pins[index].label}</text>
            <path d={`M390 ${y} H620`} data-terminal={definition.pins[index].id} data-net-number={graph.ordered.indexOf(key) + 1} className="bench-schematic-edge" />
            <circle cx="620" cy={y} r="5" fill="currentColor" />
            <text x="640" y={y + 5}>Net {graph.ordered.indexOf(key) + 1}</text>
          </g>;
        })}
      </g>)}
    </svg>}
    <div className="bench-schematic-wires" aria-label="Jumper connections">{layout.wires.map((wire, index) => <button key={wire.id} type="button" aria-pressed={selectedWire === wire.id} onClick={() => onSelectWire(wire.id)}><span style={{ backgroundColor: wire.color ?? '#309475' }} />Jumper {index + 1}: {describeRef(wire.a, layout, boardKey)} → {describeRef(wire.b, layout, boardKey)}</button>)}</div>
    <p className="bench-schematic-note">Repeated net labels name the same electrical connection. This is connectivity, not a circuit solver; no arrows or animation imply measured current.</p>
  </div>;
}
