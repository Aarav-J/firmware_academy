import { useState } from 'react';
import { BOARD_PINOUTS } from '../board-pinouts';
import type { BoardWiring } from './Breadboard';
import './uno.css';

// Pin id/label pairs come straight from board-pinouts.ts (the wiring source
// of truth) so the board graphic can never drift out of sync with it. The
// Digital pins follow the Uno R3's ten-pin and eight-pin header order.
// Power and analog groups are selected by identity, not catalogue position.
const DIGITAL_PINS = [...BOARD_PINOUTS['arduino-uno'].headers[0].pins].reverse();
const POWER_ANALOG_PINS = BOARD_PINOUTS['arduino-uno'].headers[1].pins;
const DIG_LEFT = DIGITAL_PINS.slice(0, 10);
const DIG_RIGHT = DIGITAL_PINS.slice(10);
const ANA_POWER = POWER_ANALOG_PINS.filter(pin => !/^A[0-5]$/.test(pin.id)).reverse();
const ANA_ANALOG = POWER_ANALOG_PINS.filter(pin => /^A[0-5]$/.test(pin.id));

type Props = { pins: number[]; loaded: boolean; onButton: (pressed: boolean) => void; wiring?: BoardWiring };

function PinCol({ id, label, wiring, highlight }: { id: string; label: string; wiring?: BoardWiring; highlight?: boolean }) {
  const p = wiring?.pin(id);
  if (!p) return <span title={`Pin ${label}`} className={`uno-pin${highlight ? ' uno-pin-hi' : ''}`}><i aria-hidden="true" /><span>{label}</span></span>;
  return (
    <button type="button" ref={p.ref} onClick={p.onClick} title={`Pin ${label}`} className={`uno-pin${highlight ? ' uno-pin-hi' : ''} ${p.className}`}>
      <i aria-hidden="true" /><span>{label}</span>
    </button>
  );
}

function PinColBottom({ id, label, wiring }: { id: string; label: string; wiring?: BoardWiring }) {
  const p = wiring?.pin(id);
  if (!p) return <span title={`Pin ${label}`} className="uno-pin uno-pin-bottom"><span>{label}</span><i aria-hidden="true" /></span>;
  return (
    <button type="button" ref={p.ref} onClick={p.onClick} title={`Pin ${label}`} className={`uno-pin uno-pin-bottom ${p.className}`}>
      <span>{label}</span><i aria-hidden="true" />
    </button>
  );
}

export function UnoBoard({ pins, loaded, onButton, wiring }: Props) {
  const [pressed, setPressed] = useState(false);

  function setButton(value: boolean) {
    setPressed(value);
    onButton(value);
  }

  const led13 = !!pins[13];

  return (
    <div className="board-stage">
      <div className="uno-board" aria-label="Arduino Uno virtual board">

        {/* USB-B connector — sticks out from left edge */}
        <div className="uno-usb-b" aria-hidden="true"><span /></div>

        {/* DC power barrel jack — lower-left */}
        <div className="uno-barrel" aria-hidden="true" />

        {/* Digital pin header — top edge, two 8-pin groups */}
        <div className="uno-digital-header" aria-hidden="false">
          <div className="uno-pin-group">
            {DIG_LEFT.map(p => <PinCol key={p.id} id={p.id} label={p.label} wiring={wiring} highlight={p.id === 'D2'} />)}
          </div>
          <div className="uno-pin-gap" />
          <div className="uno-pin-group">
            {DIG_RIGHT.map(p => <PinCol key={p.id} id={p.id} label={p.label} wiring={wiring} highlight={p.id === 'D13'} />)}
          </div>
        </div>

        {/* Board core */}
        <div className="uno-core" aria-hidden="true">

          {/* ATmega16U2 USB-to-serial chip near USB */}
          <div className="uno-usb-chip"><span>16U2</span></div>

          {/* Status LEDs: ON, L (D13), TX, RX */}
          <div className="uno-sled-col">
            <span className="uno-sled uno-sled-on" />
            <span className={`uno-sled uno-sled-l${led13 ? ' lit' : ''}`} />
            <span className="uno-sled uno-sled-tx" />
            <span className="uno-sled uno-sled-rx" />
          </div>
          <div className="uno-sled-labels">
            <span>ON</span><span>L</span><span>TX</span><span>RX</span>
          </div>

          {/* ATmega328P main chip */}
          <div className="uno-atmega">
            <span>ATmega328P</span>
            <small>8-bit AVR · 16 MHz</small>
          </div>

          {/* Crystal oscillator */}
          <div className="uno-crystal" />

          {/* Reset button (tact switch) */}
          <div className="uno-reset-btn" />

          {/* Board brand */}
          <div className="uno-brand">
            <span className="uno-brand-name">Arduino</span>
            <strong>Uno</strong>
            <span className="uno-brand-rev">R3</span>
          </div>

          {/* Silkscreen: UART and LED notes */}
          <div className="uno-silkscreen">
            UART0 · RX=D0 · TX=D1 · LED=D13 (PB5)
          </div>
        </div>

        {/* Analog / power pin header — bottom edge */}
        <div className="uno-analog-header" aria-hidden="false">
          <div className="uno-pin-group">
            {ANA_POWER.map(p => <PinColBottom key={p.id} id={p.id} label={p.label} wiring={wiring} />)}
          </div>
          <div className="uno-pin-gap" />
          <div className="uno-pin-group">
            {ANA_ANALOG.map(p => <PinColBottom key={p.id} id={p.id} label={p.label} wiring={wiring} />)}
          </div>
        </div>

      </div>

      {/* ── Board instruments ──────────────────────────────── */}
      <div className="board-instruments">
        <div className="instrument-reading">
          <span className="instrument-label">LED 13 (L)</span>
          <div>
            <span className={`led-indicator${led13 ? ' lit' : ''}`} />
            <output aria-label="LED 13 state">{led13 ? 'HIGH' : 'LOW'}</output>
          </div>
          <small>PB5 · D13 · active-high</small>
        </div>

        <div className="external-button">
          <span className="instrument-label">External button</span>
          <button
            className={`push-button${pressed ? ' pressed' : ''}`}
            disabled={!loaded}
            aria-label="Hold pin 2 button"
            aria-pressed={pressed}
            onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); setButton(true); }}
            onPointerUp={() => setButton(false)}
            onPointerCancel={() => setButton(false)}
            onLostPointerCapture={() => setButton(false)}
            onKeyDown={e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); setButton(true); } }}
            onKeyUp={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setButton(false); } }}
            onBlur={() => setButton(false)}
          ><span />{pressed ? 'Pressed' : 'Hold to press'}</button>
          <small>D2 → GND · INPUT_PULLUP</small>
        </div>
      </div>
    </div>
  );
}
