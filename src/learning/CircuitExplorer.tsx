import { useId, useState } from 'react';
import type { ConceptId } from './types';
import './circuit-activity.css';

type CircuitConcept = Extract<ConceptId, 'closed-circuit' | 'led-polarity' | 'resistor-current' | 'external-output'>;

const RESISTANCES = [100, 220, 330, 470, 1000];

function CircuitModel({ concept }: { concept: CircuitConcept }) {
  const diagramId = useId();
  const [closed, setClosed] = useState(concept !== 'closed-circuit');
  const [forward, setForward] = useState(concept !== 'led-polarity');
  const [resistance, setResistance] = useState(330);
  const [high, setHigh] = useState(false);
  const sourceHigh = concept !== 'external-output' || high;
  const estimatedMa = 3000 / resistance;
  const safe = estimatedMa >= 2 && estimatedMa <= 10;
  const lit = sourceHigh && closed && forward && safe;
  const description = !sourceHigh
    ? 'D8 is LOW: there is no driving voltage across this LED circuit.'
    : !closed
      ? 'The return path is open. There is no complete route back to GND, so no current flows.'
      : !forward
        ? 'The LED is reversed. Its cathode faces the source, so this model blocks current.'
        : !safe
          ? `The estimated ${estimatedMa.toFixed(2)} mA is outside our 2–10 mA teaching range. This is not an accepted circuit.`
          : 'The path is closed, the LED faces forward, and the resistor limits the estimated current to the teaching range.';

  return (
    <section className="ce-explorer" aria-label="Interactive circuit model">
      <div className="ce-model-label"><strong>Conceptual circuit model</strong><span>No firmware or live pin measurement</span></div>
      <div className="ce-controls">
        {(concept === 'closed-circuit' || concept === 'external-output') && (
          <button type="button" className="ce-button" aria-pressed={closed} onClick={() => setClosed(value => !value)}>
            {closed ? 'Open return path' : 'Close return path'}
          </button>
        )}
        {(concept === 'led-polarity' || concept === 'external-output') && (
          <button type="button" className="ce-button" aria-pressed={!forward} onClick={() => setForward(value => !value)}>
            Flip LED · {forward ? 'forward' : 'reversed'}
          </button>
        )}
        {concept === 'resistor-current' && (
          <label className="ce-select-label">Series resistance
            <select value={resistance} onChange={event => setResistance(Number(event.target.value))}>
              {RESISTANCES.map(value => <option key={value} value={value}>{value} Ω</option>)}
            </select>
          </label>
        )}
        {concept === 'external-output' && (
          <button type="button" className="ce-button ce-source-button" role="switch" aria-checked={high} aria-label="D8 HIGH" onClick={() => setHigh(value => !value)}>
            D8: {high ? 'HIGH (5 V model)' : 'LOW (0 V model)'}
          </button>
        )}
      </div>
      <figure className={`ce-schematic${lit ? ' ce-schematic-on' : ''}`}>
        <svg viewBox="0 0 600 280" role="img" aria-labelledby={`${diagramId}-title ${diagramId}-description`}>
          <title id={`${diagramId}-title`}>{lit ? 'LED on' : 'LED off'}: {closed ? 'closed' : 'open'} circuit, {forward ? 'forward' : 'reversed'} LED</title>
          <desc id={`${diagramId}-description`}>A {sourceHigh ? '5' : '0'} volt source connects through a {resistance} ohm resistor and LED to ground. {description}</desc>
          <g className="ce-trace">
            <path d="M64 96H170M260 96H345M386 96H536V214H324M276 214H64V126" />
            <rect x="170" y="82" width="90" height="28" rx="2" />
          </g>
          <g className="ce-source">
            <circle cx="64" cy="112" r="16" />
            <path d="M58 108H70M64 102V114M58 119H70" />
          </g>
          <g className={`ce-diode${forward ? '' : ' ce-diode-reversed'}`}>
            <path className="ce-diode-body" d="M349 80L377 96L349 112Z" />
            <path d="M380 79V113M347 96H349M380 96H386" />
          </g>
          <g className="ce-led-emission" aria-hidden="true">
            <path d="M368 69L384 53M376 53H384V61M384 80L400 64M392 64H400V72" />
          </g>
          <g className="ce-return-switch">
            <circle cx="276" cy="214" r="4" /><circle cx="324" cy="214" r="4" />
            <path d={closed ? 'M280 214H320' : 'M280 214L317 192'} />
          </g>
          <g className="ce-ground"><path d="M64 214V236M48 236H80M53 243H75M59 250H69" /></g>
          <g className="ce-diagram-labels">
            <text x="64" y="57" textAnchor="middle">{concept === 'external-output' ? `D8 ${high ? 'HIGH' : 'LOW'}` : '5 V source'}</text>
            <text x="215" y="59" textAnchor="middle">{resistance} Ω</text>
            <text x="343" y="143" textAnchor="middle">{forward ? 'A (+)' : 'K (−)'}</text>
            <text x="390" y="143" textAnchor="middle">{forward ? 'K (−)' : 'A (+)'}</text>
            <text x="458" y="104">LED</text>
            <text x="300" y="263" textAnchor="middle">{closed ? 'Return connected' : 'Return missing'}</text>
            <text x="103" y="244">GND</text>
          </g>
        </svg>
        <figcaption>Highlighted traces show current only when the entire model circuit is valid. Lines represent electrical connections, not physical distance.</figcaption>
      </figure>
      <div className="ce-observation" aria-live="polite" aria-atomic="true">
        <span className={`ce-led-state${lit ? ' ce-led-state-on' : ''}`} aria-hidden="true" />
        <div><strong>Model LED {lit ? 'on' : 'off'}</strong><p>{description}</p></div>
      </div>
      {concept === 'resistor-current' && (
        <div className="ce-current-reading" aria-live="polite">
          <div><span>Estimated forward current</span><strong>{estimatedMa.toFixed(2)} <small>mA</small></strong></div>
          <p><code>I = (5 − 2) / {resistance}</code> amperes. Multiply by 1,000 for mA. The model assumes a 5 V source and a 2 V LED drop.</p>
          <p className={safe ? 'ce-range-pass' : 'ce-range-warning'}>{safe ? 'Within' : 'Outside'} the 2–10 mA teaching range.{!safe && ' The model deliberately leaves the LED off; a real LED may still glow at excessive current. Brightness is not a safety check. Choose a larger resistance.'}</p>
        </div>
      )}
      <p className="ce-footnote">{concept === 'led-polarity'
        ? 'A is the anode (+); K is the cathode (−). The cathode bar identifies the side that returns toward GND. Turn power off before changing real wiring.'
        : concept === 'external-output'
          ? 'D8 is an external output, not the built-in LED on D13. HIGH alone is not enough: the external LED also needs correct polarity, a series resistor, and a return to GND.'
          : concept === 'closed-circuit'
            ? 'A wire reaching the LED is only half the route. Current needs a complete path from the source through the components and back to the source’s ground.'
            : 'This is an estimate, not a current measurement or a complete analog simulation. Actual LED voltage and board output voltage vary.'}</p>
    </section>
  );
}

export function CircuitExplorer({ concept }: { concept: ConceptId }) {
  switch (concept) {
    case 'closed-circuit':
    case 'led-polarity':
    case 'resistor-current':
    case 'external-output':
      return <CircuitModel key={concept} concept={concept} />;
    default:
      return null;
  }
}
