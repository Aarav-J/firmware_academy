import { BasePeripheral, type RP2040 } from 'rp2040js';

/** PL011 DMACR register and request gating missing from upstream RPUART. */
export class UARTControlPeripheral extends BasePeripheral {
  private dmaControl = 0;
  private readonly uart;

  constructor(mcu: RP2040, port: number) {
    super(mcu, `UART${port}`);
    this.uart = mcu.uart[port];
  }

  override readUint32(offset: number): number {
    if (offset === 0x48) return this.dmaControl;
    const value = this.uart.readUint32(offset);
    if (offset === 0) this.updateRequests();
    return value;
  }

  override writeUint32(offset: number, value: number) {
    if (offset === 0 && (!this.uart.enabled || !this.uart.txEnabled)) return;
    if (offset === 0x48) {
      this.dmaControl = value & 7;
      this.updateRequests();
    } else {
      // Preserve upstream rawWriteValue semantics for UARTICR as well.
      this.uart.writeUint32Atomic(offset, value, 0);
      if (offset === 0x30) this.updateRequests();
    }
  }

  override writeUint32Atomic(offset: number, value: number, atomicType: number) {
    if (offset === 0 && (!this.uart.enabled || !this.uart.txEnabled)) return;
    if (offset === 0x48) super.writeUint32Atomic(offset, value, atomicType);
    else {
      this.uart.writeUint32Atomic(offset, value, atomicType);
      if (offset === 0x30) this.updateRequests();
    }
  }

  private updateRequests() {
    const dma = this.rp2040.dma;
    if (this.uart.enabled && this.uart.txEnabled && (this.dmaControl & 2)) dma.setDREQ(this.uart.dreq.tx);
    else dma.clearDREQ(this.uart.dreq.tx);
    if (this.uart.enabled && this.uart.rxEnabled && (this.dmaControl & 1) && !(this.uart.flags & 0x10)) {
      dma.setDREQ(this.uart.dreq.rx);
    } else dma.clearDREQ(this.uart.dreq.rx);
  }
}
