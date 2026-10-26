import type { RegisterSnapshot, RenodeCommand, RenodeFrame, RenodeSessionInfo } from './workbench-contracts';

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, options);
  const result = await response.json() as T & { error?: string; diagnostics?: string };
  if (!response.ok) throw new Error(result.diagnostics || result.error || `Request failed (HTTP ${response.status}).`);
  return result;
}

/** Owns one server session and one event stream. Browser never submits Monitor text. */
export class BrowserRenodeSession {
  private stream: EventSource | null = null;
  private disposed = false;
  constructor(readonly info: RenodeSessionInfo) {}

  subscribe(onFrame: (frame: RenodeFrame) => void, onError: (message: string) => void) {
    this.stream?.close();
    const stream = new EventSource(this.url('events'));
    this.stream = stream;
    stream.onmessage = event => {
      if (this.disposed) return;
      try { onFrame(JSON.parse(event.data) as RenodeFrame); }
      catch { stream.close(); onError('Invalid Renode telemetry. Build again to start a new session.'); }
    };
    stream.onerror = () => {
      if (this.disposed) return;
      stream.close();
      onError('Renode connection closed. Build again to reconnect; no simulated data is being substituted.');
    };
  }

  async command(command: RenodeCommand) {
    if (this.disposed) throw new Error('The Renode session has closed.');
    return apiRequest<RenodeFrame | { ok: boolean }>(`/api/renode/sessions/${this.info.sessionId}/command`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: this.info.token, command }), signal: AbortSignal.timeout(20_000),
    });
  }

  async registers(): Promise<RegisterSnapshot> {
    if (this.disposed) throw new Error('The Renode session has closed.');
    return apiRequest<RegisterSnapshot>(this.url('registers'), { signal: AbortSignal.timeout(15_000) });
  }

  dispose(keepalive = false) {
    if (this.disposed) return;
    this.disposed = true;
    this.stream?.close();
    this.stream = null;
    void fetch(this.url(''), { method: 'DELETE', keepalive }).catch(() => {});
  }

  private url(suffix: string) {
    return `/api/renode/sessions/${this.info.sessionId}${suffix ? `/${suffix}` : ''}?token=${encodeURIComponent(this.info.token)}`;
  }
}
