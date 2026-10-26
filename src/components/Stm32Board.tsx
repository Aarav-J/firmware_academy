import { useEffect, useId, useRef, useState } from 'react';
import { BOARD_PINOUTS } from '../board-pinouts';
import type { BoardWiring } from './Breadboard';
import './stm32.css';

export interface Stm32BoardProps {
  pins: number[];
  enabled: boolean;
  onButton: (pressed: boolean) => void;
  state: string;
  timeUs: number;
  wiring: BoardWiring;
}

type ButtonInput = { type: 'pointer'; id: number } | { type: 'key'; key: string };

function pinLevel(pins: number[], pin: number) {
  return pins[pin] === 1 ? 'HIGH' : pins[pin] === 0 ? 'LOW' : 'Unknown';
}

// Expansion-header columns come straight from board-pinouts.ts (the wiring
// source of truth), so this graphic can never drift out of sync with it —
// every GPIOA/B/D pin is here, not a curated subset.
const PA_PINS = BOARD_PINOUTS['stm32f4-discovery'].headers[0].pins;
const PB_PINS = BOARD_PINOUTS['stm32f4-discovery'].headers[1].pins;
const PD_PINS = BOARD_PINOUTS['stm32f4-discovery'].headers[2].pins;

function HeaderColumn({ name, pins, wiring }: { name: string; pins: { id: string; label: string }[]; wiring: BoardWiring }) {
  return (
    <div className="stm32-header" aria-label={`Expansion header ${name}`}>
      <span className="stm32-header-label">{name}</span>
      {pins.map(pin => {
        const p = wiring.pin(pin.id);
        return (
          <button key={pin.id} type="button" ref={p.ref} onClick={p.onClick} title={`Pin ${pin.label}`} className={`stm32-header-pin ${p.className}`}>
            <i aria-hidden="true" /><span>{pin.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Stm32Board({ pins, enabled, onButton, state, timeUs, wiring }: Stm32BoardProps) {
  const id = useId();
  const [pressed, setPressed] = useState(false);
  const input = useRef<ButtonInput | null>(null);
  const callback = useRef(onButton);
  const pd12 = pinLevel(pins, 12);
  const pd13 = pinLevel(pins, 13);
  const pa0 = pinLevel(pins, 0);

  useEffect(() => { callback.current = onButton; }, [onButton]);

  function release() {
    if (!input.current) return;
    input.current = null;
    setPressed(false);
    callback.current(false);
  }

  useEffect(() => {
    if (!enabled && input.current) {
      input.current = null;
      setPressed(false);
      callback.current(false);
    }
  }, [enabled]);

  useEffect(() => {
    function cancel() {
      if (!input.current) return;
      input.current = null;
      setPressed(false);
      callback.current(false);
    }
    function visibility() {
      if (document.hidden) cancel();
    }
    function pointerRelease(event: PointerEvent) {
      if (input.current?.type === 'pointer' && input.current.id === event.pointerId) cancel();
    }
    function keyRelease(event: KeyboardEvent) {
      if (event.key === 'Escape' || (input.current?.type === 'key' && input.current.key === event.key)) cancel();
    }
    window.addEventListener('blur', cancel);
    window.addEventListener('pointerup', pointerRelease);
    window.addEventListener('pointercancel', pointerRelease);
    window.addEventListener('keyup', keyRelease);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('blur', cancel);
      window.removeEventListener('pointerup', pointerRelease);
      window.removeEventListener('pointercancel', pointerRelease);
      window.removeEventListener('keyup', keyRelease);
      document.removeEventListener('visibilitychange', visibility);
      if (input.current) {
        input.current = null;
        callback.current(false);
      }
    };
  }, []);

  return (
    <section className="stm32-board-panel" aria-labelledby={`${id}-heading`}>
      <div className="stm32-board-heading">
        <div>
          <h2 id={`${id}-heading`}>STM32F4 Discovery</h2>
          <p>Renode virtual board</p>
        </div>
        <span className={`stm32-state ${state === 'running' ? 'is-running' : ''} ${state === 'error' ? 'is-error' : ''}`}>
          {state || 'Not started'}
        </span>
      </div>
      <div className="stm32-board-stage">
        <HeaderColumn name="PA" pins={PA_PINS} wiring={wiring} />
        <div className="stm32-pcb" role="img" aria-label={`STM32F4 Discovery board layout. PD12 blink LED ${pd12}; PD13 button LED ${pd13}. ST-LINK area is a layout reference, not a hardware connection.`}>
          <div className="stm32-stlink">
            <span className="stm32-usb" aria-hidden="true" />
            <strong>ST-LINK</strong>
            <small>Onboard debug interface</small>
          </div>
          <div className="stm32-target">
            <span className="stm32-board-brand">STM32F4<br /><strong>DISCOVERY</strong></span>
            <div className="stm32-chip"><strong>STM32F407</strong><span>Cortex-M4</span></div>
            <div className="stm32-pcb-leds" aria-hidden="true">
              <span><i className={`stm32-led stm32-led-green ${pd12 === 'HIGH' ? 'is-high' : ''}`} />PD12</span>
              <span><i className={`stm32-led stm32-led-orange ${pd13 === 'HIGH' ? 'is-high' : ''}`} />PD13</span>
            </div>
            <span className="stm32-pcb-button" aria-hidden="true" />
            <small>B1 USER / PA0</small>
          </div>
        </div>
        <HeaderColumn name="PD" pins={PD_PINS} wiring={wiring} />
        <HeaderColumn name="PB" pins={PB_PINS} wiring={wiring} />
        <div className="stm32-instruments">
          <div className="stm32-reading">
            <h3>Blink LED</h3>
            <div><span aria-hidden="true" className={`stm32-led stm32-led-green ${pd12 === 'HIGH' ? 'is-high' : ''}`} /><output aria-label="PD12 blink LED level">{pd12}</output></div>
            <p><code>PD12</code> / LD4, green</p>
          </div>
          <div className="stm32-reading">
            <h3>Button LED</h3>
            <div><span aria-hidden="true" className={`stm32-led stm32-led-orange ${pd13 === 'HIGH' ? 'is-high' : ''}`} /><output aria-label="PD13 button LED level">{pd13}</output></div>
            <p><code>PD13</code> / LD3, orange</p>
          </div>
          <div className="stm32-reading">
            <h3>User button</h3>
            <button
              type="button"
              className={`stm32-hold-button ${pressed ? 'is-pressed' : ''}`}
              disabled={!enabled}
              aria-label="Hold PA0 user button"
              aria-pressed={pressed}
              aria-describedby={`${id}-button-help`}
              onPointerDown={event => {
                if (!enabled || event.button !== 0 || !event.isPrimary || input.current) return;
                input.current = { type: 'pointer', id: event.pointerId };
                event.currentTarget.setPointerCapture(event.pointerId);
                setPressed(true);
                callback.current(true);
              }}
              onPointerUp={event => { if (input.current?.type === 'pointer' && input.current.id === event.pointerId) release(); }}
              onPointerCancel={event => { if (input.current?.type === 'pointer' && input.current.id === event.pointerId) release(); }}
              onLostPointerCapture={event => { if (input.current?.type === 'pointer' && input.current.id === event.pointerId) release(); }}
              onKeyDown={event => {
                if (event.key === 'Escape') { release(); return; }
                if (event.key !== ' ' && event.key !== 'Enter') return;
                event.preventDefault();
                if (!enabled || event.repeat || input.current) return;
                input.current = { type: 'key', key: event.key };
                setPressed(true);
                callback.current(true);
              }}
              onKeyUp={event => {
                if (event.key !== ' ' && event.key !== 'Enter') return;
                event.preventDefault();
                if (input.current?.type === 'key' && input.current.key === event.key) release();
              }}
              onBlur={release}
              onContextMenu={event => event.preventDefault()}
            ><span aria-hidden="true" />{pressed ? 'Release to stop' : 'Hold to press'}</button>
            <p><code>PA0</code> / active-high</p>
            <p id={`${id}-button-help`}>Hold pointer, Space or Enter. Release sets PA0 low.</p>
            <output className="stm32-input-level" aria-label="PA0 observed input level">Observed: {pa0}</output>
          </div>
        </div>
      </div>
      <div className="stm32-board-caption">
        <span>{enabled ? 'Pin levels from Renode' : 'Start a session to control PA0. Display shows the last received levels.'}</span>
        <output aria-label="Renode virtual time">{Number.isFinite(timeUs) ? timeUs.toLocaleString() : 'Unknown'} µs</output>
      </div>
      <p className="stm32-board-note">ST-LINK is shown for board context only. This view runs firmware in Renode; it does not indicate connected physical hardware.</p>
    </section>
  );
}
