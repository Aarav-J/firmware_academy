import type { TraceEvent } from '../contracts';
import { digitalPath, measurePin } from '../trace';

type Channel = { pin: number; label: string; description: string };
const PICO_CHANNELS: Channel[] = [
  { pin: 25, label: 'GP25', description: 'LED' },
  { pin: 14, label: 'GP14', description: 'Button' },
];

type Props = {
  events: TraceEvent[];
  timeUs: number;
  channels?: Channel[];
  /** When given, channels are derived from every distinct pin actually seen in `events` instead of a fixed list — move the blink to any pin the engine tracks and it shows up here automatically. */
  pinLabel?: (pin: number) => string;
};

function deriveChannels(events: TraceEvent[], pinLabel: (pin: number) => string): Channel[] {
  const seen = new Set<number>();
  for (const event of events) if (event.type === 'pin') seen.add(event.pin);
  return [...seen].sort((a, b) => a - b).map(pin => ({ pin, label: pinLabel(pin), description: '' }));
}

export function LogicAnalyzer({ events, timeUs, channels, pinLabel }: Props) {
  const resolvedChannels = pinLabel ? deriveChannels(events, pinLabel) : channels ?? PICO_CHANNELS;
  const windowUs = 2_000_000;
  const end = Math.max(windowUs, timeUs);
  const start = end - windowUs;

  if (!resolvedChannels.length) {
    return (
      <section className="analyzer" aria-label="GPIO logic analyzer">
        <div className="panel-heading"><h3>Logic analyzer</h3><span>Last 2 seconds · simulation time</span></div>
        <p className="analyzer-empty">No pin activity yet. Any pin the firmware drives — pinMode/digitalWrite on Arduino, GPIO writes on STM32 — shows up here automatically once it toggles.</p>
      </section>
    );
  }

  const measurement = measurePin(events, resolvedChannels[0].pin);
  return (
    <section className="analyzer" aria-label="GPIO logic analyzer">
      <div className="panel-heading"><h3>Logic analyzer</h3><span>Last 2 seconds · simulation time</span></div>
      <div className="analyzer-scale"><span>GPIO</span><div>{[0, 1, 2, 3, 4].map(index => <span key={index}>{((start + index * windowUs / 4) / 1_000_000).toFixed(1)}s</span>)}</div></div>
      {resolvedChannels.map(({ pin, label, description }, index) => (
        <div className="signal-row" key={pin}>
          <div className="signal-label"><strong>{label}</strong>{description && <small>{description}</small>}</div>
          <svg viewBox="0 0 640 42" preserveAspectRatio="none" role="img" aria-label={`${label} digital signal`}>
            {[0, 160, 320, 480, 640].map(x => <line key={x} x1={x} x2={x} y1="0" y2="42" className="signal-grid" />)}
            <path d={digitalPath(events, pin, start, end, 640, 9, 33)} className={`signal-path ${index ? 'secondary-signal' : ''}`} />
          </svg>
        </div>
      ))}
      <div className="analyzer-footer">
        <span>{resolvedChannels[0].label}</span>
        <span>{measurement ? `${measurement.frequency.toFixed(2)} Hz` : 'Frequency: waiting for 2 rising edges'}</span>
        {measurement && <span>{measurement.duty.toFixed(1)}% duty</span>}
        <span className="trace-note">Measured from GPIO transitions</span>
      </div>
    </section>
  );
}
