export type SerialState = 'disconnected' | 'requesting' | 'connecting' | 'connected' | 'disconnecting';
export type LineEnding = 'none' | 'lf' | 'crlf' | 'cr';

interface BrowserSerialPort extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  getInfo(): { usbVendorId?: number; usbProductId?: number };
}

interface BrowserSerial {
  requestPort(): Promise<BrowserSerialPort>;
}

export interface SerialCallbacks {
  onState: (state: SerialState, description: string) => void;
  onData: (text: string) => void;
  onError: (message: string) => void;
}

export function serialSupported(): boolean {
  return typeof window !== 'undefined' && typeof navigator !== 'undefined' && window.isSecureContext && 'serial' in navigator;
}

export function hardwareError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'SecurityError') {
      return 'Serial access was blocked. Open this app on localhost or HTTPS in desktop Chrome or Edge, and allow serial access.';
    }
    if (error.name === 'NetworkError') {
      return 'The serial port could not be used. Check the USB cable, reconnect the device, and close other apps using this port.';
    }
    return error.message || error.name;
  }
  return String(error);
}

export function createUf2Download(bytes: Uint8Array): { url: string; filename: string; revoke: () => void } {
  // Own the Blob's buffer so later emulator transfers cannot detach its contents.
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  return { url, filename: 'firmware.uf2', revoke: () => URL.revokeObjectURL(url) };
}

/** One selected port, one read lock, and at most one write lock. No React dependency. */
export class SerialBridge {
  private port: BrowserSerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private readTask: Promise<void> | null = null;
  private writeTask: Promise<void> | null = null;
  private closeTask: Promise<void> | null = null;
  private disposed = false;
  private state: SerialState = 'disconnected';

  constructor(private readonly callbacks: SerialCallbacks) {}

  private reportState(state: SerialState, description: string): void {
    this.state = state;
    if (!this.disposed) this.callbacks.onState(state, description);
  }

  private reportError(error: unknown): void {
    if (!this.disposed) this.callbacks.onError(hardwareError(error));
  }

  async connect(baudRate: number): Promise<boolean> {
    if (this.disposed) return false;
    if (this.state !== 'disconnected') throw new Error('Disconnect the current serial port first.');
    if (!serialSupported()) throw new Error('Web Serial requires desktop Chrome or Edge on localhost or HTTPS.');
    if (!Number.isSafeInteger(baudRate) || baudRate <= 0) throw new Error('Choose a valid baud rate.');

    this.reportState('requesting', 'Choose a serial port in the browser dialog.');
    let selected: BrowserSerialPort | null = null;
    try {
      const serial = (navigator as Navigator & { serial: BrowserSerial }).serial;
      selected = await serial.requestPort();
      if (this.disposed) return false;
      this.reportState('connecting', 'Opening the selected serial port…');
      await selected.open({ baudRate });
      if (this.disposed) {
        await selected.close();
        return false;
      }
      if (!selected.readable || !selected.writable) {
        await selected.close();
        throw new Error('The selected port has no readable and writable serial streams. Reconnect the device and try again.');
      }
      this.port = selected;
      selected.addEventListener('disconnect', this.onDisconnect);
      this.reportState('connected', `Serial port open at ${baudRate.toLocaleString()} baud, 8N1.`);
      this.readTask = this.read(selected);
      return true;
    } catch (error) {
      if (this.disposed) return false;
      this.reportState('disconnected', 'No serial port connected.');
      if (!selected && error instanceof DOMException && error.name === 'NotFoundError') {
        this.reportState('disconnected', 'Port selection canceled. No connection was made.');
        return false;
      }
      throw error;
    }
  }

  private readonly onDisconnect = (): void => {
    if (this.state === 'disconnecting' || this.disposed) return;
    this.reportError(new Error('The serial device was disconnected. Reconnect its USB cable, then select Connect.'));
    void this.disconnect();
  };

  private async read(port: BrowserSerialPort): Promise<void> {
    const decoder = new TextDecoder();
    let readFailed = false;
    try {
      const reader = port.readable!.getReader();
      this.reader = reader;
      try {
        while (this.state === 'connected' && !this.disposed) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            const text = decoder.decode(value, { stream: true });
            if (text && !this.disposed) this.callbacks.onData(text);
          }
        }
        const last = decoder.decode();
        if (last && !this.disposed) this.callbacks.onData(last);
      } finally {
        reader.releaseLock();
        if (this.reader === reader) this.reader = null;
      }
    } catch (error) {
      readFailed = true;
      if (this.state === 'connected' && !this.disposed) this.reportError(error);
    } finally {
      if (this.state === 'connected' && !this.disposed) {
        // Schedule closure after this read task settles; disconnect waits for it.
        if (!readFailed) this.reportError(new Error('The serial input stream ended. Disconnecting the port; reconnect to resume.'));
        queueMicrotask(() => { void this.disconnect(); });
      }
    }
  }

  async send(text: string, ending: LineEnding): Promise<void> {
    if (this.disposed || this.state !== 'connected' || !this.port?.writable) {
      throw new Error('Connect a serial port before sending.');
    }
    if (this.writeTask) throw new Error('A serial write is already in progress.');
    const suffix = { none: '', lf: '\n', crlf: '\r\n', cr: '\r' }[ending];
    const writer = this.port.writable.getWriter();
    this.writer = writer;
    const task = writer.write(new TextEncoder().encode(text + suffix));
    this.writeTask = task;
    try {
      await task;
    } finally {
      writer.releaseLock();
      if (this.writer === writer) this.writer = null;
      if (this.writeTask === task) this.writeTask = null;
    }
  }

  disconnect(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    if (!this.port) return Promise.resolve();
    this.reportState('disconnecting', 'Closing serial port…');
    const port = this.port;
    port.removeEventListener('disconnect', this.onDisconnect);
    const close = async (): Promise<void> => {
      // Cancel/abort before closing: Web Serial cannot close locked streams.
      await Promise.allSettled([
        this.reader?.cancel(),
        this.writer?.abort(new Error('Serial connection closed.')),
      ]);
      await Promise.allSettled([this.readTask, this.writeTask]);
      try {
        await port.close();
      } catch (error) {
        this.reportError(error);
      } finally {
        this.port = null;
        this.readTask = null;
        this.closeTask = null;
        this.reportState('disconnected', 'Serial port closed.');
      }
    };
    this.closeTask = close();
    return this.closeTask;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.disconnect();
  }
}
