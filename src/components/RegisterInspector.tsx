import { useId, useMemo, useState } from 'react';
import type { RegisterSnapshot } from '../workbench-contracts';
import './stm32.css';

export interface RegisterInspectorProps {
  snapshot: RegisterSnapshot | null;
  busy: boolean;
  enabled: boolean;
  onRefresh: () => void;
  onStep: () => void;
  error?: string;
}

const generalRegisters = Array.from({ length: 13 }, (_, index) => `R${index}`);
const controlRegisters = ['SP', 'LR', 'PC', 'xPSR'];
const modeNames = ['Input', 'Output', 'Alternate function', 'Analog'];

function normalizeCpu(snapshot: RegisterSnapshot | null) {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(snapshot?.cpu ?? {})) {
    const upper = name.toUpperCase();
    const canonical = upper === 'R13' ? 'SP' : upper === 'R14' ? 'LR' : upper === 'R15' ? 'PC' : upper === 'PSR' ? 'XPSR' : upper;
    result[canonical] = value;
  }
  return result;
}

function parseRegister(value: string) {
  if (!/^0x[\da-f]{1,8}$/i.test(value)) return null;
  return Number.parseInt(value.slice(2), 16);
}

export function RegisterInspector({ snapshot, busy, enabled, onRefresh, onStep, error }: RegisterInspectorProps) {
  const id = useId();
  const [history, setHistory] = useState<{ current: RegisterSnapshot | null; previous: RegisterSnapshot | null }>({ current: snapshot, previous: null });
  if (snapshot !== history.current) {
    setHistory({
      current: snapshot,
      previous: snapshot && history.current && snapshot.timeUs >= history.current.timeUs ? history.current : null,
    });
  }
  const cpu = useMemo(() => normalizeCpu(snapshot), [snapshot]);
  const previousCpu = useMemo(() => normalizeCpu(history.previous), [history.previous]);
  const previousPeripherals = useMemo(() => new Map(history.previous?.peripherals.map(register => [`${register.name}:${register.address.toLowerCase()}`, register.value.toLowerCase()])), [history.previous]);
  const controlsDisabled = !enabled || busy;

  return (
    <section className="stm32-inspector" aria-labelledby={`${id}-heading`} aria-busy={busy}>
      <div className="stm32-inspector-heading">
        <div>
          <h2 id={`${id}-heading`}>Registers &amp; instructions</h2>
          <p id={`${id}-help`}>Read-only snapshots. Pause execution to refresh or step one CPU instruction.</p>
        </div>
        <div className="stm32-debug-controls" aria-describedby={`${id}-help`}>
          <button type="button" disabled={controlsDisabled} onClick={onRefresh}>Refresh</button>
          <button type="button" disabled={controlsDisabled} onClick={onStep}>Step instruction</button>
        </div>
      </div>
      <p className="stm32-inspector-status" role="status">
        {busy ? 'Reading target state…' : !enabled ? 'Debugger controls are available in a paused session.' : snapshot ? 'Paused. Ready to inspect or step.' : 'Paused. Refresh to read the target registers.'}
        {snapshot && <span>Snapshot at <code>{snapshot.timeUs.toLocaleString()} µs</code>{!enabled ? ' (last captured state)' : ''}.</span>}
      </p>
      {error && <p className="stm32-inspector-error" role="alert">{error} Pause the session and use Refresh to retry.</p>}
      {!snapshot ? (
        <div className="stm32-register-empty">
          <h3>{busy ? 'Waiting for register snapshot' : 'No register snapshot yet'}</h3>
          <p>{busy ? 'CPU registers, peripheral values and disassembly will appear when Renode responds.' : 'Build and start STM32 firmware, then pause and select Refresh. Values are read from the emulated target, not estimated.'}</p>
        </div>
      ) : (
        <>
          <div className="stm32-register-section">
            <div className="stm32-register-section-heading"><h3>CPU</h3><span>Changed values are marked with *</span></div>
            <div className="stm32-cpu-groups">
              {[{ label: 'General-purpose registers', registers: generalRegisters }, { label: 'Stack, link and execution state', registers: controlRegisters }].map(group => (
                <div className="stm32-cpu-group" key={group.label}>
                  <h4>{group.label}</h4>
                  <dl className="stm32-cpu-registers">
                    {group.registers.map(name => {
                      const value = cpu[name.toUpperCase()];
                      const previous = previousCpu[name.toUpperCase()];
                      const changed = value !== undefined && previous !== undefined && value.toLowerCase() !== previous.toLowerCase();
                      return (
                        <div key={name} className={changed ? 'stm32-register-changed' : undefined}>
                          <dt>{name}</dt>
                          <dd title={changed ? `Previous: ${previous}` : undefined}>
                            <code>{value ?? 'Unavailable'}</code>
                            {changed && <span className="stm32-change-marker" aria-label="Changed since previous snapshot">*</span>}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                </div>
              ))}
            </div>
          </div>
          <div className="stm32-register-section">
            <h3>Peripheral registers</h3>
            <p className="stm32-register-help">Server-allowlisted addresses only. Binary is the captured 32-bit register value, grouped from bit 31 to bit 0.</p>
            {snapshot.peripherals.length === 0 ? <p className="stm32-register-help">No peripheral values were returned in this snapshot.</p> : (
              <div className="stm32-register-table-scroll" tabIndex={0} role="region" aria-label="Peripheral register values, horizontally scrollable">
                <table className="stm32-register-table">
                  <caption className="stm32-sr-only">Captured peripheral names, addresses, hexadecimal and binary values</caption>
                  <thead><tr><th scope="col">Register / fields</th><th scope="col">Address</th><th scope="col">Hex</th><th scope="col">Binary [31:0]</th></tr></thead>
                  <tbody>
                    {snapshot.peripherals.map(register => {
                      const numeric = parseRegister(register.value);
                      const previous = previousPeripherals.get(`${register.name}:${register.address.toLowerCase()}`);
                      const changed = previous !== undefined && previous !== register.value.toLowerCase();
                      const address = parseRegister(register.address);
                      const odr = register.name === 'GPIOD_ODR' && address === 0x40020c14;
                      const moder = register.name === 'GPIOD_MODER' && address === 0x40020c00;
                      const binary = numeric === null ? null : numeric.toString(2).padStart(32, '0').match(/.{4}/g)?.join(' ');
                      return (
                        <tr key={`${register.name}:${register.address}`} className={changed ? 'stm32-register-changed' : undefined}>
                          <th scope="row"><code>{register.name}</code>
                            {numeric !== null && odr && <span className="stm32-decoded-fields">PD12 [12]: {(numeric >>> 12) & 1}<br />PD13 [13]: {(numeric >>> 13) & 1}</span>}
                            {numeric !== null && moder && <span className="stm32-decoded-fields">PD12 [25:24]: {((numeric >>> 24) & 3).toString(2).padStart(2, '0')} ({modeNames[(numeric >>> 24) & 3]})<br />PD13 [27:26]: {((numeric >>> 26) & 3).toString(2).padStart(2, '0')} ({modeNames[(numeric >>> 26) & 3]})</span>}
                          </th>
                          <td><code>{register.address}</code></td>
                          <td title={changed ? `Previous: ${previous}` : undefined}><code>{register.value}</code>{changed && <span className="stm32-change-marker" aria-label="Changed since previous snapshot">*</span>}</td>
                          <td><code>{binary ?? 'Unavailable'}</code></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="stm32-register-section">
            <h3>Disassembly</h3>
            <p className="stm32-register-help">Instructions reported by Renode. Step advances one machine instruction, not one source line.</p>
            <pre className="stm32-disassembly" tabIndex={0} aria-label="Renode disassembly">{snapshot.disassembly || 'No disassembly was returned in this snapshot.'}</pre>
          </div>
        </>
      )}
    </section>
  );
}
