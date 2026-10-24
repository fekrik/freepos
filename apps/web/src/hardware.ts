import { formatCents } from '@freshpos/shared';
import type { ReceiptData } from './components/ReceiptModal';

export type ReceiptMode = 'prompt' | 'auto' | 'none';

const RECEIPT_MODE_KEY = 'freshpos.hardware.receipt_mode';

export function getReceiptMode(): ReceiptMode {
  try {
    const val = localStorage.getItem(RECEIPT_MODE_KEY);
    if (val === 'prompt' || val === 'auto' || val === 'none') return val;
  } catch {}
  return 'prompt';
}

export function setReceiptMode(mode: ReceiptMode): void {
  try {
    localStorage.setItem(RECEIPT_MODE_KEY, mode);
  } catch {}
}

// ============================================================================
// 1. ESC/POS Thermal Receipt Printer & RJ12 Cash Drawer Driver
// ============================================================================

class EscPosHardwareManager {
  private usbDevice: any | null = null;
  private usbEndpointOut: number = 1;
  private serialPort: any | null = null;
  private deviceName: string | null = null;
  private lastPulseAt: string | null = null;

  getStatus() {
    return {
      connected: Boolean(this.usbDevice || this.serialPort),
      transport: this.usbDevice ? 'WebUSB' : this.serialPort ? 'WebSerial' : null,
      deviceName: this.deviceName,
      lastPulseAt: this.lastPulseAt,
      webUsbSupported: typeof navigator !== 'undefined' && 'usb' in navigator,
      webSerialSupported: typeof navigator !== 'undefined' && 'serial' in navigator,
    };
  }

  async connectUsbPrinter(): Promise<string> {
    const nav = navigator as any;
    if (!nav.usb) {
      throw new Error('WebUSB is not supported in this browser (use Chrome or Edge).');
    }
    const device = await nav.usb.requestDevice({ filters: [] });
    await device.open();
    if (device.configuration === null) {
      await device.selectConfiguration(1);
    }
    const iface = device.configuration.interfaces[0];
    await device.claimInterface(iface.interfaceNumber);
    const outEp = iface.alternate.endpoints.find((e: any) => e.direction === 'out');
    this.usbEndpointOut = outEp ? outEp.endpointNumber : 1;
    this.usbDevice = device;
    this.deviceName = device.productName || 'USB Thermal Receipt Printer';
    return this.deviceName!;
  }

  async connectSerialPrinter(baudRate = 9600): Promise<string> {
    const nav = navigator as any;
    if (!nav.serial) {
      throw new Error('Web Serial is not supported in this browser (use Chrome or Edge).');
    }
    const port = await nav.serial.requestPort();
    await port.open({ baudRate });
    this.serialPort = port;
    this.deviceName = `Serial ESC/POS Printer (${baudRate} baud)`;
    return this.deviceName;
  }

  async disconnectPrinter(): Promise<void> {
    try {
      if (this.usbDevice) {
        await this.usbDevice.close();
      }
      if (this.serialPort) {
        await this.serialPort.close();
      }
    } catch {}
    this.usbDevice = null;
    this.serialPort = null;
    this.deviceName = null;
  }

  async sendBytes(bytes: Uint8Array): Promise<boolean> {
    if (this.usbDevice) {
      await this.usbDevice.transferOut(this.usbEndpointOut, bytes);
      return true;
    }
    if (this.serialPort && this.serialPort.writable) {
      const writer = this.serialPort.writable.getWriter();
      try {
        await writer.write(bytes);
      } finally {
        writer.releaseLock();
      }
      return true;
    }
    return false;
  }

  /**
   * Sends the standard ESC/POS `ESC p m t1 t2` cash drawer kick pulse
   * over the RJ12 connector on the back of the receipt printer, plus a short
   * audible confirmation chime on the register.
   */
  async kickCashDrawer(): Promise<{ hardwareSent: boolean; commandHex: string }> {
    // ESC p 0 25 250 (Pin 2, 50ms ON, 500ms OFF)
    const kickBytes = new Uint8Array([0x1b, 0x70, 0x00, 0x19, 0xfa]);
    this.lastPulseAt = new Date().toLocaleTimeString();

    let hardwareSent = false;
    try {
      hardwareSent = await this.sendBytes(kickBytes);
    } catch (e) {
      console.warn('ESC/POS drawer kick hardware error:', e);
    }

    // Play register drawer bell sound via Web Audio API
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(1046.5, ctx.currentTime); // C6 bell
      osc.frequency.setValueAtTime(1318.5, ctx.currentTime + 0.06); // E6 chime
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.32);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.32);
    } catch {}

    return {
      hardwareSent,
      commandHex: '1B 70 00 19 FA',
    };
  }

  /**
   * Encodes a ReceiptData object into 80mm (42-column) ESC/POS byte stream
   * with bold headers, itemized lines, and GS V partial paper cut.
   */
  buildEscPosReceipt(receipt: ReceiptData, kickDrawer = false): Uint8Array {
    const encoder = new TextEncoder();
    const chunks: number[] = [];
    const push = (...bytes: number[]) => chunks.push(...bytes);
    const text = (str: string) => chunks.push(...encoder.encode(str));
    const line = (str = '') => text(str + '\n');
    const padRow = (left: string, right: string, width = 42) => {
      const space = Math.max(1, width - left.length - right.length);
      return left.slice(0, width - right.length - 1) + ' '.repeat(space) + right;
    };

    // Initialize printer (ESC @)
    push(0x1b, 0x40);

    // Optional cash drawer kick pulse at start of receipt
    if (kickDrawer) {
      push(0x1b, 0x70, 0x00, 0x19, 0xfa);
    }

    // Center align (ESC a 1) + Bold ON (ESC E 1)
    push(0x1b, 0x61, 0x01, 0x1b, 0x45, 0x01);
    line(receipt.store.name.toUpperCase());
    push(0x1b, 0x45, 0x00); // Bold OFF
    if (receipt.store.address) line(receipt.store.address);
    if (receipt.store.fnsNumber) line(`USDA SNAP FNS #${receipt.store.fnsNumber}`);
    line(`Receipt: ${receipt.saleNumber}`);
    line(new Date(receipt.completedAt).toLocaleString());
    line(`${receipt.registerName} - Cashier: ${receipt.cashierName}`);
    line('-'.repeat(42));

    // Left align (ESC a 0)
    push(0x1b, 0x61, 0x00);

    for (const l of receipt.lines) {
      const flags = `${l.snapEligible ? 'F' : ''}${l.taxRateBps > 0 ? 'T' : ''}`;
      const rightStr = `${formatCents(l.lineTotal)}${flags ? ' ' + flags : ''}`;
      line(padRow(l.name, rightStr));
      const qtyDetail =
        l.soldBy === 'weight'
          ? `  ${(l.quantity / 1000).toFixed(3)} lb @ ${formatCents(l.unitPrice)}/lb`
          : `  ${l.quantity} @ ${formatCents(l.unitPrice)}`;
      line(qtyDetail);
    }

    line('-'.repeat(42));
    line(padRow('SUBTOTAL', formatCents(receipt.totals.subtotal)));
    if (receipt.totals.deposits > 0) {
      line(padRow('DEPOSITS', formatCents(receipt.totals.deposits)));
    }
    line(padRow('TAX', formatCents(receipt.totals.tax)));

    // Bold ON for Total
    push(0x1b, 0x45, 0x01);
    line(padRow('TOTAL', formatCents(receipt.totals.total)));
    push(0x1b, 0x45, 0x00);

    line('-'.repeat(42));
    for (const p of receipt.payments) {
      const label = `${p.tenderType.toUpperCase()}${p.last4 ? ` *${p.last4}` : ''}`;
      line(padRow(label, formatCents(p.amountCents)));
      if (p.changeCents && p.changeCents > 0) {
        line(padRow('CHANGE DUE', formatCents(p.changeCents)));
      }
    }

    // Center footer
    push(0x1b, 0x61, 0x01);
    line('');
    line('THANK YOU FOR SHOPPING FRESH!');
    line('\n\n\n');

    // Partial paper cut (GS V 66 0)
    push(0x1d, 0x56, 0x42, 0x00);

    return new Uint8Array(chunks);
  }

  async printReceipt(receipt: ReceiptData, kickDrawer = false): Promise<{ usedHardware: boolean }> {
    const payload = this.buildEscPosReceipt(receipt, kickDrawer);
    if (this.usbDevice || this.serialPort) {
      try {
        const sent = await this.sendBytes(payload);
        if (sent) return { usedHardware: true };
      } catch (e) {
        console.warn('Hardware print failed, falling back to browser print:', e);
      }
    }
    window.print();
    return { usedHardware: false };
  }
}

export const printerHardware = new EscPosHardwareManager();

// ============================================================================
// 2. RS-232 / USB Deli & Produce Scale Reader (Web Serial + Live Simulation)
// ============================================================================

class ScaleHardwareManager {
  private serialPort: any | null = null;
  private reader: any | null = null;
  private currentWeightLbs: number = 0;
  private listeners = new Set<(lbs: number) => void>();

  getStatus() {
    return {
      connected: Boolean(this.serialPort),
      currentWeightLbs: this.currentWeightLbs,
      webSerialSupported: typeof navigator !== 'undefined' && 'serial' in navigator,
    };
  }

  subscribe(cb: (lbs: number) => void): () => void {
    this.listeners.add(cb);
    if (this.currentWeightLbs > 0) cb(this.currentWeightLbs);
    return () => this.listeners.delete(cb);
  }

  private emit(lbs: number) {
    this.currentWeightLbs = lbs;
    for (const cb of this.listeners) cb(lbs);
  }

  /**
   * Connects to a standard NCI / Toledo / CAS RS-232 or USB Virtual COM scale
   * and parses ASCII weight frames (e.g. "001.45 LB" or "1.825 lb").
   */
  async connectSerialScale(baudRate = 9600): Promise<void> {
    const nav = navigator as any;
    if (!nav.serial) {
      throw new Error('Web Serial API not supported in this browser (use Chrome or Edge).');
    }
    const port = await nav.serial.requestPort();
    await port.open({ baudRate });
    this.serialPort = port;
    this.readLoop();
  }

  private async readLoop() {
    if (!this.serialPort?.readable) return;
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      this.reader = this.serialPort.readable.getReader();
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split(/[\r\n]+/);
          buffer = lines.pop() || '';
          for (const line of lines) {
            const match = line.match(/(\d+\.\d{1,3})\s*(lb|kg|oz)?/i);
            if (match) {
              let val = parseFloat(match[1]);
              const unit = (match[2] || 'lb').toLowerCase();
              if (unit === 'kg') val *= 2.20462;
              if (unit === 'oz') val /= 16;
              if (val > 0) this.emit(Number(val.toFixed(3)));
            }
          }
        }
      }
    } catch (e) {
      console.warn('Scale serial read loop ended:', e);
    }
  }

  async disconnectScale(): Promise<void> {
    try {
      if (this.reader) await this.reader.cancel();
      if (this.serialPort) await this.serialPort.close();
    } catch {}
    this.reader = null;
    this.serialPort = null;
  }

  /**
   * Simulates placing an item on the counter scale with realistic stabilization
   * for testing without physical RS-232 hardware attached.
   */
  simulateScaleRead(targetLbs?: number): number {
    const finalLbs = targetLbs ?? Number((0.65 + Math.random() * 2.1).toFixed(3));
    this.emit(finalLbs);
    return finalLbs;
  }
}

export const scaleHardware = new ScaleHardwareManager();
