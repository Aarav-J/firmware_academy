/**
 * AVR (Arduino Uno / ATmega328P) simulator worker.
 *
 * Implements the same SimulatorCommand / SimulatorMessage wire protocol as
 * simulator.worker.ts (RP2040), so the host-side WorkerBridge can treat both
 * workers identically.
 *
 * `load` command: the `uf2` ArrayBuffer field carries raw Intel HEX text bytes
 * (UTF-8).  The name is kept from the shared protocol; no UF2 is involved.
 *
 * Timing model:
 *   Wall-clock driven; ~16 MHz pace.  The worker advances the simulation in
 *   ~8 ms chunks at roughly real-time speed.  Frame messages are posted at
 *   ~30 fps (every 33 ms of wall time) regardless of simulation rate.
 */

import type { SimulatorCommand, SimulatorMessage } from '../contracts';
import { ATmega328PSimulation, parseIntelHex } from './avr-engine';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SimulatorCommand>) => void) | null;
  postMessage(message: SimulatorMessage): void;
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(timer: number): void;
  location: Location;
};

let simulation: ATmega328PSimulation | null = null;
let originalFlash: Uint8Array | null = null;
let running = false;
let timer: number | null = null;
let generation = 0;
let wallAnchor = 0;
let simulationAnchor = 0;
let lastFrame = 0;

function stop() {
  running = false;
  if (timer !== null) {
    scope.clearTimeout(timer);
    timer = null;
  }
}

function fail(error: unknown) {
  stop();
  if (simulation) {
    scope.postMessage(simulation.frame());
    scope.postMessage({ type: 'state', state: 'paused', timeUs: simulation.timeUs });
  }
  scope.postMessage({
    type: 'error',
    message: error instanceof Error ? error.message : String(error),
  });
}

function executeChunk() {
  timer = null;
  if (!running || !simulation) return;
  try {
    const now = performance.now();
    const targetUs = simulationAnchor + (now - wallAnchor) * 1000;
    // Cap step to 8 ms of simulated time; prevents racing through long idles.
    simulation.step(Math.min(simulation.timeUs + 8000, Math.max(simulation.timeUs, targetUs)));
    const after = performance.now();
    if (after - lastFrame >= 33) {
      scope.postMessage(simulation.frame());
      lastFrame = after;
    }
    if (targetUs - simulation.timeUs > 250_000) {
      // Host is too slow to keep up; re-anchor rather than falsify timestamps.
      wallAnchor = after;
      simulationAnchor = simulation.timeUs;
    }
    timer = scope.setTimeout(executeChunk, targetUs - simulation.timeUs > 1000 ? 0 : 4);
  } catch (error) {
    fail(error);
  }
}

function load(hexBuffer: ArrayBuffer) {
  const currentGeneration = ++generation;
  stop();
  simulation = null;
  originalFlash = null;
  try {
    const flash = parseIntelHex(new TextDecoder().decode(hexBuffer));
    if (currentGeneration !== generation) return;
    simulation = new ATmega328PSimulation(flash);
    originalFlash = flash;
    scope.postMessage(simulation.frame());
    scope.postMessage({ type: 'state', state: 'ready', timeUs: 0 });
  } catch (error) {
    if (currentGeneration === generation) fail(error);
  }
}

scope.onmessage = ({ data }) => {
  try {
    switch (data.type) {
      case 'load':
        load(data.uf2);
        break;

      case 'run':
        if (!simulation) throw new Error('Load a valid Arduino sketch before running the simulator.');
        if (running) return;
        running = true;
        wallAnchor = performance.now();
        simulationAnchor = simulation.timeUs;
        lastFrame = wallAnchor;
        scope.postMessage({ type: 'state', state: 'running', timeUs: simulation.timeUs });
        timer = scope.setTimeout(executeChunk, 0);
        break;

      case 'pause':
        stop();
        if (!simulation) throw new Error('No firmware is loaded.');
        scope.postMessage(simulation.frame());
        scope.postMessage({ type: 'state', state: 'paused', timeUs: simulation.timeUs });
        break;

      case 'reset':
        ++generation;
        stop();
        if (!originalFlash) throw new Error('Load valid firmware before resetting the simulator.');
        // Rebuild the chip from scratch; avr8js has no reset() that clears all
        // peripheral state, so we reconstruct the simulation object.
        simulation = new ATmega328PSimulation(originalFlash);
        scope.postMessage(simulation.frame());
        scope.postMessage({ type: 'state', state: 'ready', timeUs: 0 });
        break;

      case 'button':
        if (!simulation) throw new Error('No firmware is loaded.');
        if (typeof data.pressed !== 'boolean') throw new Error('Button state must be a boolean.');
        simulation.setButton(data.pressed);
        if (!running) scope.postMessage(simulation.frame());
        break;

      case 'analog':
        if (!simulation) throw new Error('No firmware is loaded.');
        if (typeof data.pin !== 'number' || typeof data.voltage !== 'number' || !Number.isFinite(data.voltage)) throw new Error('Analog input needs a pin and a finite voltage.');
        simulation.setAnalogInput(data.pin, data.voltage);
        if (!running) scope.postMessage(simulation.frame());
        break;

      case 'serial':
        if (!simulation) throw new Error('No firmware is loaded.');
        if (typeof data.byte !== 'number' || data.byte < 0 || data.byte > 255) throw new Error('Serial injection needs a byte 0-255.');
        simulation.usart.writeByte(data.byte);
        if (!running) scope.postMessage(simulation.frame());
        break;

      default:
        throw new Error('Unknown simulator command.');
    }
  } catch (error) {
    fail(error);
  }
};
