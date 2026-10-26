import { useState } from 'react';

const leftPins = ['GP0', 'GP1', 'GND', 'GP2', 'GP3', 'GP4', 'GP5', 'GND', 'GP6', 'GP7', 'GP8', 'GP9', 'GND', 'GP10', 'GP11', 'GP12', 'GP13', 'GND', 'GP14', 'GP15'];
const rightPins = ['VBUS', 'VSYS', 'GND', '3V3 EN', '3V3 OUT', 'ADC REF', 'GP28', 'GND', 'GP27', 'GP26', 'RUN', 'GP22', 'GND', 'GP21', 'GP20', 'GP19', 'GP18', 'GND', 'GP17', 'GP16'];

type Props = { pins: number[]; loaded: boolean; onButton: (pressed: boolean) => void };

export function PicoBoard({ pins, loaded, onButton }: Props) {
  const [pressed, setPressed] = useState(false);
  function setButton(value: boolean) {
    setPressed(value);
    onButton(value);
  }
  return (
    <div className="board-stage">
      <div className="pico-board" aria-label="Raspberry Pi Pico virtual board">
        <div className="usb-socket" aria-hidden="true"><span /></div>
        <div className="board-pins left-pins">
          {leftPins.map((pin, index) => <div className={`board-pin ${pin === 'GP14' ? 'connected-pin' : ''}`} key={index}><i aria-hidden="true" /><span>{pin}</span></div>)}
        </div>
        <div className="board-core">
          <div className="board-topline"><span className={`onboard-led ${pins[25] ? 'lit' : ''}`} /><span>LED</span></div>
          <div className="board-brand">Raspberry Pi<br /><strong>Pico</strong></div>
          <div className="rp-chip"><span>RP2040</span><small>Dual Cortex-M0+</small></div>
          <div className="board-components" aria-hidden="true"><i /><i /><i /><i /><i /></div>
          <span className="board-silkscreen">GP25 · ONBOARD LED</span>
        </div>
        <div className="board-pins right-pins">
          {rightPins.map((pin, index) => <div className="board-pin" key={index}><span>{pin}</span><i aria-hidden="true" /></div>)}
        </div>
        <div className="debug-pads" aria-hidden="true"><i /><i /><i /></div>
      </div>
      <div className="board-instruments">
        <div className="instrument-reading">
          <span className="instrument-label">Onboard LED</span>
          <div><span className={`led-indicator ${pins[25] ? 'lit' : ''}`} /><output aria-label="LED state">{pins[25] ? 'HIGH' : 'LOW'}</output></div>
          <small>GP25 · digital output</small>
        </div>
        <div className="external-button">
          <span className="instrument-label">External button</span>
          <button
            className={`push-button ${pressed ? 'pressed' : ''}`}
            disabled={!loaded}
            aria-label="Hold GP14 button"
            aria-pressed={pressed}
            onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); setButton(true); }}
            onPointerUp={() => setButton(false)}
            onPointerCancel={() => setButton(false)}
            onLostPointerCapture={() => setButton(false)}
            onKeyDown={event => { if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) { event.preventDefault(); setButton(true); } }}
            onKeyUp={event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); setButton(false); } }}
            onBlur={() => setButton(false)}
          ><span />{pressed ? 'Pressed' : 'Hold to press'}</button>
          <small>GP14 → GND · active-low</small>
        </div>
      </div>
    </div>
  );
}
