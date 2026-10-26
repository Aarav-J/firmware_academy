import type { SimulatorCommand, SimulatorMessage } from './contracts';
import { RP2040Simulation } from './simulator/engine';
import { parseUF2 } from './simulator/uf2';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SimulatorCommand>) => void) | null;
  postMessage(message: SimulatorMessage): void;
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(timer: number): void;
  location: Location;
};

let simulation: RP2040Simulation | null = null;
let originalFlash: Uint8Array | null = null;
let bootrom: Uint32Array | null = null;
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
  scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
}

function executeChunk() {
  timer = null;
  if (!running || !simulation) return;
  try {
    const now = performance.now();
    const targetUs = simulationAnchor + (now - wallAnchor) * 1000;
    // Do not race through a long sleep or monopolize this worker with a busy loop.
    simulation.step(Math.min(simulation.timeUs + 8000, Math.max(simulation.timeUs, targetUs)));
    const after = performance.now();
    if (after - lastFrame >= 33) {
      scope.postMessage(simulation.frame());
      lastFrame = after;
    }
    if (targetUs - simulation.timeUs > 250_000) {
      // Slow hosts run slower than real time; never falsify simulation timestamps.
      wallAnchor = after;
      simulationAnchor = simulation.timeUs;
    }
    timer = scope.setTimeout(executeChunk, targetUs - simulation.timeUs > 1000 ? 0 : 4);
  } catch (error) {
    fail(error);
  }
}

async function load(uf2: ArrayBuffer) {
  const currentGeneration = ++generation;
  stop();
  // Invalid loads must not leave a previous firmware instance looking like the new one.
  simulation = null;
  originalFlash = null;
  try {
    const flash = parseUF2(uf2);
    if (!bootrom) {
      const url = new URL(`${import.meta.env.BASE_URL}rp2040-bootrom.bin`, scope.location.origin);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Unable to load RP2040 boot ROM: HTTP ${response.status}.`);
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== 16384) throw new Error('Invalid RP2040 boot ROM asset: expected 16384 bytes.');
      const view = new DataView(bytes);
      const words = new Uint32Array(bytes.byteLength / 4);
      for (let index = 0; index < words.length; index++) words[index] = view.getUint32(index * 4, true);
      bootrom = words;
    }
    if (currentGeneration !== generation) return;
    simulation = new RP2040Simulation(flash, bootrom);
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
        void load(data.uf2);
        break;
      case 'run':
        if (!simulation) throw new Error('Load a valid RP2040 UF2 before running the simulator.');
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
        if (!originalFlash || !bootrom) throw new Error('Load valid firmware before resetting the simulator.');
        // RP2040.reset() does not reset every peripheral or alarm; rebuild the chip.
        simulation = new RP2040Simulation(originalFlash, bootrom);
        scope.postMessage(simulation.frame());
        scope.postMessage({ type: 'state', state: 'ready', timeUs: 0 });
        break;
      case 'button':
        if (!simulation) throw new Error('No firmware is loaded.');
        if (typeof data.pressed !== 'boolean') throw new Error('Button state must be a boolean.');
        simulation.setButton(data.pressed);
        if (!running) scope.postMessage(simulation.frame());
        break;
      default:
        throw new Error('Unknown simulator command.');
    }
  } catch (error) {
    fail(error);
  }
};
