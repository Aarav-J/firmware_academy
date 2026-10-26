import { BasePeripheral, type RP2040 } from 'rp2040js';

/**
 * IO_QSPI control bank omitted by rp2040js. Its existing QSPI GPIOPin objects
 * already implement the STATUS and CTRL fields used by the SDK's boot2.
 * Flash transfers remain handled by rp2040js SSI/XIP, not bit-banged pad signals.
 * Register layout/masks: Pico SDK hardware/regs/io_qspi.h (RP2040 datasheet 2.19).
 */
export class QSPIControlPeripheral extends BasePeripheral {
  constructor(mcu: RP2040, private readonly onChipSelect: (high: boolean | null) => void) {
    super(mcu, 'IO_QSPI_BASE');
  }

  override readUint32(offset: number): number {
    if (offset >= 0 && offset < 0x30 && offset % 4 === 0) {
      const pin = this.rp2040.qspi[offset >>> 3];
      return offset & 4 ? pin.ctrl : pin.status;
    }
    return super.readUint32(offset);
  }

  override writeUint32(offset: number, value: number) {
    if (offset >= 0 && offset < 0x30 && offset % 4 === 0) {
      if (offset & 4) {
        const pin = this.rp2040.qspi[offset >>> 3];
        pin.ctrl = value & 0x3003331f;
        pin.checkForUpdates();
        pin.refreshInput();
        if ((offset >>> 3) === 1) {
          this.onChipSelect(pin.outputOverride === 3 ? true : pin.outputOverride === 2 ? false : null);
        }
      }
      // The paired STATUS registers are read-only.
      return;
    }
    super.writeUint32(offset, value);
  }
}
