import type { ExternalProjectId } from './workbench-contracts';

/** A board's silicon-level pin function. Two pins can only be wired when their kinds match. */
export type PinKind =
  | 'power'
  | 'ground'
  | 'i2c-sda'
  | 'i2c-scl'
  | 'spi-sck'
  | 'spi-mosi'
  | 'spi-miso'
  | 'spi-cs'
  | 'uart-tx'
  | 'uart-rx'
  | 'analog'
  | 'digital';

export type Voltage = 3.3 | 5;

export type BoardPin = {
  id: string;
  label: string;
  kind: PinKind;
  /** Present only for `power` pins: the rail voltage the board actually supplies on this pin. */
  voltage?: Voltage;
};

export type BoardHeader = { name: string; pins: BoardPin[] };

export type BoardKey = 'arduino-uno' | 'stm32f4-discovery';

export type BoardPinout = {
  key: BoardKey;
  name: string;
  logicVoltage: Voltage;
  headers: BoardHeader[];
};

export type ComponentPin = {
  id: string;
  label: string;
  kind: PinKind;
  /** Present only for `power` pins: the maximum voltage the part tolerates on this pin. */
  maxVoltage?: Voltage;
};

export type ComponentCategory = 'i2c' | 'spi' | 'analog' | 'digital';

export type ComponentDef = {
  id: string;
  name: string;
  category: ComponentCategory;
  description: string;
  pins: ComponentPin[];
  /** Pin id pairs that are electrically continuous within the part (e.g. a resistor's two legs), so live state can pass through them. */
  internalLinks?: [string, string][];
};

export type PinRef = { kind: 'board'; pinId: string } | { kind: 'component'; instanceId: string; pinId: string } | { kind: 'breadboard'; pinId: string };

export type PlacedComponent = { instanceId: string; componentId: string; x: number; y: number; resistanceOhms?: number; holes?: Record<string, string> };

export type WireStatus = 'ok' | 'overvoltage';

export type Wire = { id: string; a: PinRef; b: PinRef; status: WireStatus; color?: string; bends?: { x: number; y: number }[] };

export type BreadboardLayout = { version?: 2; components: PlacedComponent[]; wires: Wire[] };

export function boardKeyFor(profileId: ExternalProjectId): BoardKey {
  return profileId === 'arduino-uno' ? 'arduino-uno' : 'stm32f4-discovery';
}

export function samePinRef(a: PinRef, b: PinRef): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'board' && b.kind === 'board') return a.pinId === b.pinId;
  if (a.kind === 'breadboard' && b.kind === 'breadboard') return a.pinId === b.pinId;
  if (a.kind === 'component' && b.kind === 'component') return a.instanceId === b.instanceId && a.pinId === b.pinId;
  return false;
}

/** Pin kinds that are allowed to meet on a wire. Everything else is a wiring mistake and is rejected. */
const COMPATIBLE_KINDS: Partial<Record<PinKind, PinKind>> = {
  power: 'power',
  ground: 'ground',
  'i2c-sda': 'i2c-sda',
  'i2c-scl': 'i2c-scl',
  'spi-sck': 'spi-sck',
  'spi-mosi': 'spi-mosi',
  'spi-miso': 'spi-miso',
  'spi-cs': 'spi-cs',
  'uart-tx': 'uart-rx',
  'uart-rx': 'uart-tx',
  analog: 'analog',
  digital: 'digital',
};

// A GPIO-multiplexed pin (SPI/I2C/UART/analog) is still a plain digital pin
// underneath — that's how pin alternate functions actually work, so a
// generic digital signal (e.g. a bare LED) may land on any of them.
const GPIO_CAPABLE = new Set<PinKind>(['digital', 'spi-sck', 'spi-mosi', 'spi-miso', 'spi-cs', 'i2c-sda', 'i2c-scl', 'uart-tx', 'uart-rx', 'analog']);

export function kindsCompatible(a: PinKind, b: PinKind): boolean {
  if (a === 'digital' && GPIO_CAPABLE.has(b)) return true;
  if (b === 'digital' && GPIO_CAPABLE.has(a)) return true;
  return COMPATIBLE_KINDS[a] === b || COMPATIBLE_KINDS[b] === a;
}
