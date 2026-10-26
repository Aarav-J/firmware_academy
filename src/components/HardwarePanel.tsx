import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  createUf2Download,
  hardwareError,
  SerialBridge,
  serialSupported,
  type LineEnding,
  type SerialState,
} from '../hardware';
import './hardware.css';

export interface HardwarePanelProps {
  uf2: Uint8Array | null;
  artifactStale: boolean;
  serialOnly?: boolean;
}

const MONITOR_LIMIT = 65_536;
const BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

export function HardwarePanel({ uf2, artifactStale, serialOnly = false }: HardwarePanelProps) {
  const [download, setDownload] = useState<{
    bytes: Uint8Array;
    url: string;
    filename: string;
  } | null>(null);
  const [serialState, setSerialState] = useState<SerialState>('disconnected');
  const [serialDescription, setSerialDescription] = useState('No serial port connected.');
  const [error, setError] = useState('');
  const [baudRate, setBaudRate] = useState(115200);
  const [monitor, setMonitor] = useState('');
  const [follow, setFollow] = useState(true);
  const [message, setMessage] = useState('');
  const [lineEnding, setLineEnding] = useState<LineEnding>('lf');
  const [sending, setSending] = useState(false);
  const bridge = useRef<SerialBridge | null>(null);
  const monitorElement = useRef<HTMLPreElement>(null);
  const pending = useRef('');
  const frame = useRef<number | null>(null);
  const mounted = useRef(false);
  const supported = serialSupported();
  const connected = serialState === 'connected';
  const busy = serialState !== 'disconnected' && serialState !== 'connected';
  const availableDownload = !artifactStale && uf2 && download?.bytes === uf2 ? download : null;

  useEffect(() => {
    if (!uf2 || artifactStale) {
      setDownload(null);
      return;
    }
    const file = createUf2Download(uf2);
    setDownload({ bytes: uf2, url: file.url, filename: file.filename });
    return file.revoke;
  }, [uf2, artifactStale]);

  useEffect(() => {
    mounted.current = true;
    const connection = new SerialBridge({
      onState: (state, description) => {
        setSerialState(state);
        setSerialDescription(description);
      },
      onError: setError,
      onData: (text) => {
        pending.current = (pending.current + text).slice(-MONITOR_LIMIT);
        if (frame.current !== null) return;
        frame.current = requestAnimationFrame(() => {
          const received = pending.current;
          pending.current = '';
          frame.current = null;
          setMonitor((previous) => (previous + received).slice(-MONITOR_LIMIT));
        });
      },
    });
    bridge.current = connection;
    return () => {
      mounted.current = false;
      bridge.current = null;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      pending.current = '';
      void connection.dispose();
    };
  }, []);

  useEffect(() => {
    if (follow && monitorElement.current) {
      monitorElement.current.scrollTop = monitorElement.current.scrollHeight;
    }
  }, [monitor, follow]);

  async function toggleConnection() {
    setError('');
    try {
      if (connected) await bridge.current?.disconnect();
      else await bridge.current?.connect(baudRate);
    } catch (cause) {
      if (mounted.current) setError(hardwareError(cause));
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!connected || sending || (!message && lineEnding === 'none')) return;
    setSending(true);
    setError('');
    try {
      await bridge.current?.send(message, lineEnding);
      if (mounted.current) setMessage('');
    } catch (cause) {
      if (mounted.current) setError(hardwareError(cause));
    } finally {
      if (mounted.current) setSending(false);
    }
  }

  return (
    <div className="hw-panel">
      {!serialOnly && <section className="hw-flash" aria-labelledby="hw-flash-title">
        <div className="hw-section-heading">
          <div>
            <h3 id="hw-flash-title">Flash a Pico</h3>
            <p>UF2 mass-storage transfer · RP2040</p>
          </div>
          <a
            className="hw-download"
            href={availableDownload?.url}
            download={availableDownload?.filename}
            aria-disabled={!availableDownload}
            tabIndex={availableDownload ? 0 : -1}
            onClick={(event) => { if (!availableDownload) event.preventDefault(); }}
          >
            Download UF2
          </a>
        </div>
        <p className="hw-artifact-note" role="status">
          {artifactStale
            ? 'Source changed. Compile again before downloading firmware.'
            : uf2
              ? `${uf2.byteLength.toLocaleString()} bytes · the same compiled UF2 used by the simulator.`
              : 'Compile your source to generate firmware.uf2.'}
        </p>
        <ol className="hw-flash-steps">
          <li>Disconnect the Pico. Hold <strong>BOOTSEL</strong>, plug in a USB data cable, then release BOOTSEL.</li>
          <li>Open the <strong>RPI-RP2</strong> drive that appears on your computer.</li>
          <li>Download <code>firmware.uf2</code> above, then copy it onto <strong>RPI-RP2</strong>. The drive normally ejects as the Pico reboots.</li>
        </ol>
        <p className="hw-help">This downloads a file; it does not flash over WebUSB or verify the board. The browser cannot confirm a successful flash.</p>
        <details className="hw-recovery">
          <summary>Board not appearing or firmware not running?</summary>
          <p>Try a known USB data cable and another USB port. Enter BOOTSEL again to recover and copy a fresh RP2040 UF2. Close the serial connection before flashing. BOOTSEL is the board’s bootloader button, not the simulated GPIO14 button.</p>
        </details>
      </section>}

      <section className="hw-serial" aria-labelledby="hw-serial-title">
        <div className="hw-section-heading">
          <div>
            <h3 id="hw-serial-title">Serial monitor</h3>
            <p>Real device I/O · separate from simulator output</p>
          </div>
          <span className={`hw-connection-state${connected ? ' is-connected' : ''}`}>
            {connected ? 'Port open' : busy ? 'Connecting / closing' : 'Disconnected'}
          </span>
        </div>
        {serialOnly ? <p className="hw-help">Connect the STM32's USART2 using a 3.3 V USB–UART adapter: PA2 (TX) to adapter RX, PA3 (RX) to adapter TX, and common GND. The ST-Link debug connector is not automatically a UART connection.</p> : <><p className="hw-help">For this project’s <strong>UART0</strong>, use a <strong>3.3 V USB–UART adapter</strong>: Pico GPIO0 (TX) → adapter RX, GPIO1 (RX) → adapter TX, and common GND. Never use 5 V logic.</p><p className="hw-help">The Pico’s own USB port appears as serial only when firmware implements <strong>USB CDC</strong>. GPIO UART does not automatically appear over USB; the BOOTSEL drive is not a serial port.</p></>}
        {!supported && (
          <p className="hw-warning" role="status">Web Serial is unavailable here. Use desktop Chrome or Edge on localhost or HTTPS, or use an external serial terminal. Firmware download remains available.</p>
        )}
        <div className="hw-serial-toolbar">
          <label className="hw-field">
            <span>Baud rate</span>
            <select value={baudRate} disabled={!supported || serialState !== 'disconnected'} onChange={(event) => setBaudRate(Number(event.target.value))}>
              {BAUD_RATES.map((rate) => <option key={rate} value={rate}>{rate}</option>)}
            </select>
          </label>
          <button type="button" className="hw-connect" disabled={!supported || busy} onClick={() => { void toggleConnection(); }}>
            {connected ? 'Disconnect' : serialState === 'requesting' ? 'Choose a port…' : serialState === 'connecting' ? 'Opening…' : serialState === 'disconnecting' ? 'Closing…' : 'Connect serial'}
          </button>
          <label className="hw-follow"><input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} /> Follow output</label>
          <button type="button" className="hw-clear" onClick={() => { pending.current = ''; setMonitor(''); }}>Clear</button>
        </div>
        <p className="hw-port-description" role="status">{serialDescription}</p>
        {error && <p className="hw-error" role="alert">{error}</p>}
        <pre className="hw-monitor" ref={monitorElement} tabIndex={0} aria-label="Received serial data, newest 65,536 characters" aria-live="off">{monitor || <span className="hw-monitor-empty">{connected ? 'Waiting for incoming serial data…' : 'Connect a serial port to receive live device output.'}</span>}</pre>
        <div className="hw-monitor-caption"><span>UTF-8 · newest 65,536 characters</span><span>8 data bits · no parity · 1 stop bit</span></div>
        <form className="hw-send" onSubmit={(event) => { void sendMessage(event); }}>
          <label className="hw-message-field">
            <span className="hw-sr-only">Text to send to the device</span>
            <input value={message} onChange={(event) => setMessage(event.target.value)} disabled={!connected || sending} placeholder="Send text to device" autoComplete="off" spellCheck={false} />
          </label>
          <label className="hw-ending-field">
            <span className="hw-sr-only">Line ending</span>
            <select value={lineEnding} onChange={(event) => setLineEnding(event.target.value as LineEnding)} disabled={sending} aria-label="Line ending">
              <option value="lf">LF (\n)</option>
              <option value="crlf">CRLF (\r\n)</option>
              <option value="cr">CR (\r)</option>
              <option value="none">No ending</option>
            </select>
          </label>
          <button type="submit" disabled={!connected || sending || (!message && lineEnding === 'none')}>{sending ? 'Sending…' : 'Send'}</button>
        </form>
        <p className="hw-help">Port busy or no output? Close other serial terminals, check the selected device and baud rate, and reconnect after a reset. Receiving nothing does not prove the firmware is running.</p>
      </section>
    </div>
  );
}
