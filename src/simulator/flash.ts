import { BasePeripheral, FIFO, type Peripheral, type RP2040 } from 'rp2040js';

const READ_COMMANDS = [0, 0xff, 0x05, 0x35, 0x4b, 0x9f, 0x03, 0x0b];
const JEDEC_ID = [0xef, 0x40, 0x15];

/** Read-side Winbond-compatible SPI flash for ROM startup/unique-ID transactions. */
export class FlashSSIPeripheral extends BasePeripheral {
  private readonly receive = new FIFO(16);
  private errorFlags = 0;
  private interruptMask = 0x3f;
  private slaveEnable = 0;
  private txThreshold = 0;
  private rxThreshold = 0;
  private command = -1;
  private position = 0;
  private address = 0;
  private selected: boolean | null = null;
  // Identity of this virtual flash, not an identifier claimed from real hardware.
  private readonly uniqueId = new Uint8Array([0x52, 0x50, 0x32, 0x30, 0x34, 0x30, 0x4a, 0x53]);

  constructor(mcu: RP2040, private readonly original: Peripheral) {
    super(mcu, 'SSI');
  }

  chipSelect(high: boolean | null) {
    const selected = high === null ? null : !high;
    if (selected !== this.selected) {
      this.command = -1;
      this.position = 0;
      this.address = 0;
    }
    this.selected = selected;
  }

  override readUint32(offset: number): number {
    switch (offset) {
      case 0x10: return this.slaveEnable;
      case 0x18: return this.txThreshold;
      case 0x1c: return this.rxThreshold;
      case 0x20: return 0; // Synchronous transfers finish before the APB access completes.
      case 0x24: return this.receive.itemCount;
      case 0x28: return 0x6 | (this.receive.empty ? 0 : 0x8) | (this.receive.full ? 0x10 : 0);
      case 0x2c: return this.interruptMask;
      case 0x30: return this.readUint32(0x34) & this.interruptMask;
      case 0x34: return this.errorFlags | 1 | (this.receive.itemCount > this.rxThreshold ? 0x10 : 0);
      case 0x38:
      case 0x3c:
      case 0x40:
      case 0x44: {
        const bit = offset === 0x38 ? 2 : offset === 0x3c ? 8 : offset === 0x40 ? 4 : 0x20;
        const pending = this.errorFlags & bit ? 1 : 0;
        this.errorFlags &= ~bit;
        return pending;
      }
      case 0x48: {
        const pending = this.errorFlags ? 1 : 0;
        this.errorFlags = 0;
        return pending;
      }
      case 0x60:
        if (this.receive.empty) {
          this.errorFlags |= 4;
          return 0;
        }
        return this.receive.pull();
      default: return this.original.readUint32(offset);
    }
  }

  override writeUint32(offset: number, value: number) {
    switch (offset) {
      case 0x08:
        this.original.writeUint32(offset, value & 1);
        if (!(value & 1)) {
          this.receive.reset();
          this.errorFlags = 0;
          this.command = -1;
          this.position = 0;
          this.address = 0;
        }
        return;
      case 0x10: this.slaveEnable = value & 1; return;
      case 0x18: this.txThreshold = value & 0xff; return;
      case 0x1c: this.rxThreshold = value & 0xff; return;
      case 0x2c:
        // Interrupt-driven flash transactions are outside this synchronous read model.
        if (value) throw new Error('SSI interrupt-driven flash transfers are not supported.');
        this.interruptMask = 0;
        return;
      case 0x60: {
        if (!(this.original.readUint32(0x08) & 1)) return;
        const control = this.original.readUint32(0x00);
        if (((control >>> 8) & 3) === 3) {
          // Boot2 sends command/address then receives one EEPROM-mode frame.
          if (this.position++ === 0) return;
          const address = value >>> 8;
          const frame = this.rp2040.flashView.getUint32(address & 0x1ffffc, false);
          this.pushReceive(frame);
          return;
        }
        let response = 0xff;
        if (this.selected !== false && (this.selected === true || this.slaveEnable)) {
          const byte = value & 0xff;
          if (this.command < 0) {
            this.command = byte;
            this.position = 0;
            this.address = 0;
            if (!READ_COMMANDS.includes(byte)) {
              throw new Error(`Unsupported flash SPI command 0x${byte.toString(16)}; flash writes/erase are not emulated.`);
            }
          } else {
            this.position++;
            switch (this.command) {
              case 0x05: response = 0; break; // Ready, write-protect latch clear.
              case 0x35: response = 2; break; // Quad enable is set on this virtual device.
              case 0x4b:
                if (this.position >= 5) response = this.uniqueId[(this.position - 5) % 8];
                break;
              case 0x9f:
                response = JEDEC_ID[(this.position - 1) % 3];
                break;
              case 0x03:
              case 0x0b:
                if (this.position <= 3) this.address = (this.address << 8) | byte;
                else if (this.command === 0x03 || this.position > 4) {
                  response = this.rp2040.flash[this.address++ & 0x1fffff];
                }
                break;
            }
          }
        }
        this.pushReceive(response);
        return;
      }
      default: this.original.writeUint32(offset, value);
    }
  }

  private pushReceive(value: number) {
    if (this.receive.full) this.errorFlags |= 8;
    else this.receive.push(value);
  }
}

/** XIP memory is coherent and uncached in rp2040js; flush therefore completes synchronously. */
export class XIPControlPeripheral extends BasePeripheral {
  private control = 3;

  override readUint32(offset: number): number {
    switch (offset) {
      case 0: return this.control;
      case 4: return 0;
      case 8: return 3; // FLUSH_READY and streaming FIFO EMPTY.
      default: return super.readUint32(offset);
    }
  }

  override writeUint32(offset: number, value: number) {
    switch (offset) {
      case 0: this.control = value & 0xb; return;
      case 4: return; // No cache exists to retain stale data or pending flush work.
      default: super.writeUint32(offset, value);
    }
  }
}
