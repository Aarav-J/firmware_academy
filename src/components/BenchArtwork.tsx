import { BOARD_PINOUTS } from '../board-pinouts';
import { BREADBOARD_PARTS } from '../breadboard-parts';
import { holePoint } from '../physical-breadboard';
import type { BenchPoint } from '../physical-breadboard';
import type { BoardKey, PlacedComponent } from '../breadboard-contracts';

const DIGITAL = ['SCL', 'SDA', 'D-AREF', 'D-GND', 'D13', 'D12', 'D11', 'D10', 'D9', 'D8', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'TX', 'RX'];
const POWER = ['VIN', 'P-GND1', 'P-GND2', '5V', '3V3'];
export function boardPinPoint(boardKey: BoardKey, pinId: string): BenchPoint | undefined {
  if (boardKey === 'arduino-uno') {
    const digital = DIGITAL.indexOf(pinId);
    if (digital >= 0) return { x: 64 + digital * 18 + (digital > 9 ? 10 : 0), y: 210 };
    const power = POWER.indexOf(pinId);
    if (power >= 0) return { x: 190 - power * 18, y: 470 };
    if (pinId === 'IOREF') return { x: 82, y: 470 };
    if (/^A[0-5]$/.test(pinId)) return { x: 272 + Number(pinId[1]) * 20, y: 470 };
    // RESET is reference-only: wire-controlled resetting is not emulated.
    return undefined;
  }
  const headers = BOARD_PINOUTS[boardKey].headers;
  const header = headers.findIndex(header => header.pins.some(pin => pin.id === pinId));
  const pin = headers[header]?.pins.findIndex(pin => pin.id === pinId) ?? -1;
  return header >= 0 && pin >= 0 ? { x: 83 + header * 86, y: 195 + pin * 22 } : undefined;
}

export function componentPinPoint(part: PlacedComponent, pinId: string): BenchPoint | undefined {
  const seat = part.holes?.[pinId];
  if (seat) return holePoint(seat);
  const pins = BREADBOARD_PARTS.find(definition => definition.id === part.componentId)?.pins ?? [];
  const index = pins.findIndex(pin => pin.id === pinId);
  return index < 0 ? undefined : { x: part.x + index * 26, y: part.y + 48 };
}
export function componentCenter(part: PlacedComponent): BenchPoint {
  const points = (BREADBOARD_PARTS.find(definition => definition.id === part.componentId)?.pins ?? []).map(pin => componentPinPoint(part, pin.id)).filter((point): point is BenchPoint => !!point);
  if (!points.length) return { x: part.x, y: part.y };
  return { x: points.reduce((sum, point) => sum + point.x, 0) / points.length, y: points.reduce((sum, point) => sum + point.y, 0) / points.length - 30 };
}

export function BenchBoard({ boardKey, pins }: { boardKey: BoardKey; pins: number[] }) {
  if (boardKey !== 'arduino-uno') return <g className="bench-board-art">
    <rect x="55" y="140" width="355" height="435" rx="14" fill="#195658" stroke="#104345" strokeWidth="3" />
    <text x="72" y="114" className="bench-object-title">STM32F4 Discovery</text>
    <text x="72" y="610" className="bench-object-caption">Logical port explorer · not physical header positions</text>
    {BOARD_PINOUTS[boardKey].headers.map((header, index) => <g key={header.name}>
      <text x={83 + index * 86} y="168" textAnchor="middle" fill="#e2f2ed" fontSize="15">{header.name}</text>
      <rect x={71 + index * 86} y="182" width="24" height={header.pins.length * 22 + 4} rx="4" fill="#202b2c" />
      {header.pins.map(pin => { const point = boardPinPoint(boardKey, pin.id)!; return <text key={pin.id} x={point.x + 16} y={point.y + 4} fill="#e2f2ed" fontSize="12">{pin.label}</text>; })}
    </g>)}
  </g>;
  return <g className="bench-board-art">
    <text x="60" y="143" className="bench-object-title">Arduino Uno</text>
    <text x="60" y="165" className="bench-object-caption">Digital output · 5 V logic</text>
    <path d="M60 214 Q60 200 74 200 H395 L410 214 V454 L395 480 H74 Q60 480 60 466 Z" fill="#147e83" stroke="#0d666d" strokeWidth="3" />
    {[{ x: 80, y: 224 }, { x: 388, y: 224 }, { x: 80, y: 454 }, { x: 388, y: 454 }].map((point, index) => <g key={index}><circle {...{ cx: point.x, cy: point.y }} r="8" fill="#d3b56e" /><circle cx={point.x} cy={point.y} r="4" fill="#e1e5df" /></g>)}
    <rect x="45" y="245" width="60" height="61" rx="5" fill="#bac3c5" stroke="#879497" strokeWidth="3" /><rect x="43" y="253" width="32" height="45" fill="#65777b" /><rect x="48" y="261" width="16" height="28" fill="#263c40" />
    <rect x="48" y="405" width="55" height="38" rx="5" fill="#202d30" /><circle cx="62" cy="424" r="10" fill="#101c20" stroke="#738185" strokeWidth="3" />
    <rect x="242" y="332" width="124" height="40" rx="3" fill="#263436" stroke="#122628" strokeWidth="2" />
    {Array.from({ length: 14 }, (_, index) => <g key={index}><rect x={248 + index * 8} y="324" width="3" height="8" fill="#b9c0b8" /><rect x={248 + index * 8} y="372" width="3" height="8" fill="#b9c0b8" /></g>)}
    <text x="304" y="355" textAnchor="middle" fill="#d0d6d0" fontSize="11">ATmega328P</text>
    <rect x="127" y="274" width="38" height="37" rx="4" fill="#263436" /><rect x="176" y="310" width="30" height="12" rx="5" fill="#b9c8c7" />
    <text x="124" y="378" fontSize="37" fill="#edf6eb" fontWeight="600" letterSpacing="-1">UNO</text>
    <text x="125" y="400" fontSize="12" fill="#ddede5">Arduino-compatible R3 layout</text>
    <rect x="55" y="200" width="184" height="21" rx="3" fill="#243639" /><rect x="245" y="200" width="148" height="21" rx="3" fill="#243639" />
    <rect x="55" y="460" width="150" height="21" rx="3" fill="#243639" /><rect x="263" y="460" width="120" height="21" rx="3" fill="#243639" />
    {DIGITAL.map(id => { const point = boardPinPoint(boardKey, id)!; return <text key={id} x={point.x} y="191" transform={`rotate(-50 ${point.x} 191)`} fill="var(--bench-label)" fontSize="13" textAnchor="start">{id === 'D-AREF' ? 'AREF' : id === 'D-GND' ? 'GND' : id}</text>; })}
    {[...POWER, 'IOREF', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5'].map(id => { const point = boardPinPoint(boardKey, id)!; return <text key={id} x={point.x} y="500" transform={`rotate(40 ${point.x} 500)`} fill="var(--bench-label)" fontSize="13">{id.startsWith('P-GND') ? 'GND' : id}</text>; })}
    <g><title>RESET reference only. Use Reset simulation to reset the emulated board.</title><rect x="95" y="465" width="10" height="10" rx="1" fill="#c9b66d" /><text x="100" y="500" transform="rotate(40 100 500)" fill="var(--bench-label)" fontSize="13">RESET*</text></g>
    <g><title>NC is not connected to the Uno circuitry.</title><rect x="59" y="465" width="10" height="10" rx="1" fill="#8d9990" /><text x="64" y="500" transform="rotate(40 64 500)" fill="var(--bench-label)" fontSize="13">NC</text></g>
    <rect x="212" y="254" width="11" height="7" rx="2" fill={pins[13] ? '#f7d75a' : '#315c54'} /><text x="229" y="261" fill="#ecf6e9" fontSize="11">L · D13</text>
    <circle cx="185" cy="280" r="5" fill="#dce8de" /><text x="197" y="284" fill="#ecf6e9" fontSize="11">ON</text>
  </g>;
}

const BAND_COLORS = ['#242b2b', '#744d35', '#c84236', '#dc8a30', '#dfc344', '#548552', '#4b6d9e', '#8c619e', '#89908e', '#e3e3dc'];
function resistorBands(value: number): string[] {
  if (!Number.isFinite(value) || value <= 0) return ['#242b2b', '#242b2b', '#242b2b'];
  const exponent = Math.floor(Math.log10(value)) - 1;
  const digits = Math.round(value / 10 ** exponent);
  return [BAND_COLORS[Math.floor(digits / 10) % 10], BAND_COLORS[digits % 10], exponent === -1 ? '#c1a15c' : BAND_COLORS[Math.max(0, Math.min(9, exponent))]];
}

export function BenchPart({ part, lit, selected, onSelect }: { part: PlacedComponent; lit: boolean; selected: boolean; onSelect: () => void }) {
  const definition = BREADBOARD_PARTS.find(definition => definition.id === part.componentId);
  if (!definition) return null;
  const center = componentCenter(part);
  const points = definition.pins.map(pin => componentPinPoint(part, pin.id)!);
  const ledAngle = part.componentId === 'led' ? Math.atan2(points[1].y - points[0].y, points[1].x - points[0].x) : 0;
  return <g className={`bench-part-art${selected ? ' is-selected' : ''}${lit ? ' is-lit' : ''}`} data-part-id={part.instanceId} onClick={event => { event.stopPropagation(); onSelect(); }}>
    <title>{definition.name} {part.instanceId}{part.componentId === 'resistor' ? ` · ${part.resistanceOhms === undefined ? 'resistance not set' : `${part.resistanceOhms} Ω`}` : ''}. Select to inspect or move its leads.</title>
    {selected && <rect x={center.x - 64} y={center.y - 37} width="128" height="77" rx="12" fill="none" stroke="#287eac" strokeWidth="2" strokeDasharray="5 4" />}
    {part.componentId === 'resistor' ? <>
      {points.map((point, index) => <path key={index} d={`M${point.x} ${point.y} V${center.y} H${center.x + (index ? 38 : -38)}`} fill="none" stroke="#8d989a" strokeWidth="4" strokeLinecap="round" />)}
      <rect x={center.x - 40} y={center.y - 12} width="80" height="24" rx="10" fill="#e1c490" stroke="#a78e64" strokeWidth="2" />
      {part.resistanceOhms !== undefined && [...resistorBands(part.resistanceOhms), '#b69747'].map((color, index) => <rect key={index} x={center.x - 27 + index * 17} y={center.y - 12} width="7" height="24" rx="1" fill={color} />)}
      <text x={center.x} y={center.y - 23} textAnchor="middle" className="bench-part-label">{part.resistanceOhms === undefined ? 'Set resistance' : `${part.resistanceOhms} Ω`} · {part.instanceId}</text>
    </> : part.componentId === 'led' ? <>
      {points.map((point, index) => {
        const offset = index ? 9 : -9;
        const tip = { x: center.x + offset * Math.cos(ledAngle) - 13 * Math.sin(ledAngle), y: center.y + offset * Math.sin(ledAngle) + 13 * Math.cos(ledAngle) };
        return <path key={index} d={`M${point.x} ${point.y} L${tip.x} ${tip.y}`} fill="none" stroke="#8d989a" strokeWidth="3" strokeLinecap="round" />;
      })}
      <g transform={`rotate(${ledAngle * 180 / Math.PI} ${center.x} ${center.y})`}>
      <path d={`M${center.x - 19} ${center.y + 10} V${center.y - 7} A19 19 0 0 1 ${center.x + 19} ${center.y - 7} V${center.y + 10} Z`} fill={lit ? '#fb624b' : '#b73935'} stroke="#7a2c2b" strokeWidth="2" />
      <path d={`M${center.x + 19} ${center.y - 3} V${center.y + 10}`} stroke="#532d2d" strokeWidth="4" />
      <rect x={center.x - 23} y={center.y + 10} width="46" height="6" rx="2" fill={lit ? '#f47b63' : '#cb5147'} stroke="#7a2c2b" />
      <path d={`M${center.x - 9} ${center.y - 6} Q${center.x - 9} ${center.y - 18} ${center.x + 2} ${center.y - 18}`} stroke={lit ? '#ffddc6' : '#dc8c80'} strokeWidth="4" fill="none" strokeLinecap="round" />
      </g>
      <text x={center.x} y={center.y - 38} textAnchor="middle" className="bench-part-label">LED · {part.instanceId}</text>
      {points.map((point, index) => <text key={index} x={point.x} y={point.y + 21} textAnchor="middle" className="bench-lead-label">{index === 0 ? 'A +' : 'K −'}</text>)}
    </> : <>
      <rect x={center.x - 70} y={center.y - 43} width="140" height="72" rx="5" fill="#245b59" stroke="#183d3b" strokeWidth="2" />
      <rect x={center.x - 25} y={center.y - 27} width="50" height="26" rx="2" fill="#223237" />
      {part.componentId === 'oled-display' && <rect x={center.x - 57} y={center.y - 35} width="114" height="42" fill="#17252c" stroke="#6b9294" />}
      <text x={center.x} y={center.y - 55} textAnchor="middle" className="bench-part-label">{definition.name}</text>
      {points.map((point, index) => <g key={index}><path d={`M${point.x} ${point.y} V${center.y + 23}`} stroke="#a4b4b4" strokeWidth="3" /><text x={point.x} y={point.y + 19} textAnchor="middle" className="bench-lead-label">{definition.pins[index].label}</text></g>)}
    </>}
  </g>;
}
