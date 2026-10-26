import type { Readable, Writable } from 'node:stream';

/** The only monitor transport is parent-owned pipes: no raw monitor TCP port. */
export class RenodeMonitor {
  private text = '';
  private waiting: { resolve: (value: string) => void; reject: (error: Error) => void; timer: NodeJS.Timeout } | undefined;
  private failure: Error | undefined;
  private ready: Promise<string>;

  private constructor(private input: Writable, output: Readable) {
    this.ready = this.response();
    output.on('data', chunk => this.receive(chunk));
    output.on('error', error => this.fail(error));
    output.on('close', () => this.fail(new Error('Renode monitor disconnected')));
    input.on('error', error => this.fail(error));
  }

  static async connect(input: Writable, output: Readable) {
    const monitor = new RenodeMonitor(input, output);
    await monitor.ready;
    return monitor;
  }

  private response() {
    if (this.failure) return Promise.reject<string>(this.failure);
    if (this.waiting) throw new Error('Concurrent Renode monitor command rejected');
    const pending = Promise.withResolvers<string>();
    const timer = setTimeout(() => this.fail(new Error('Renode command timed out')), 30_000);
    timer.unref();
    this.waiting = { ...pending, timer };
    return pending.promise;
  }

  private receive(chunk: Buffer) {
    this.text += chunk.toString('utf8');
    if (this.text.length > 1_048_576) { this.fail(new Error('Renode monitor output exceeded its bound')); return; }
    // Anchor on a new line, not parentheses inside an echoed Python expression.
    if (/(?:^|[\r\n])\([^\r\n]*\) $/.test(this.text) && this.waiting) {
      const value = this.text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
      this.text = '';
      const pending = this.waiting;
      this.waiting = undefined;
      clearTimeout(pending.timer);
      pending.resolve(value);
    }
  }

  private fail(error: Error) {
    this.failure = error;
    if (this.waiting) {
      clearTimeout(this.waiting.timer);
      this.waiting.reject(error);
      this.waiting = undefined;
    }
    this.input.destroy();
  }

  async command(command: string) {
    const response = this.response();
    this.input.write(`${command}\n`);
    const output = await response;
    if (/There was an error|Could not execute command|No such command|Error while|Traceback \(/i.test(output)) throw new Error(output.slice(-4000));
    return output;
  }

  close() { this.fail(new Error('Renode session closed')); }
}
