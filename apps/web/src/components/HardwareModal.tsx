import React, { useEffect, useState } from 'react';
import { api } from '../api';
import {
  getReceiptMode,
  printerHardware,
  scaleHardware,
  setReceiptMode,
  type ReceiptMode,
} from '../hardware';

interface Props {
  onClose: () => void;
  onNotify: (msg: string, err?: boolean) => void;
}

export function HardwareModal({ onClose, onNotify }: Props) {
  const [printerStatus, setPrinterStatus] = useState(printerHardware.getStatus());
  const [scaleStatus, setScaleStatus] = useState(scaleHardware.getStatus());
  const [mode, setMode] = useState<ReceiptMode>(getReceiptMode());
  const [liveWeight, setLiveWeight] = useState<number>(scaleStatus.currentWeightLbs);

  // Stripe Terminal Reader pairing state
  const [terminalInfo, setTerminalInfo] = useState<any | null>(null);
  const [regCode, setRegCode] = useState('');
  const [readerLabel, setReaderLabel] = useState('Lane 1 - WisePOS E');
  const [pairing, setPairing] = useState(false);

  useEffect(() => {
    api('/terminal/status')
      .then(setTerminalInfo)
      .catch(() => {});

    const unsub = scaleHardware.subscribe((lbs) => {
      setLiveWeight(lbs);
      setScaleStatus(scaleHardware.getStatus());
    });
    return unsub;
  }, []);

  function handleModeChange(next: ReceiptMode) {
    setMode(next);
    setReceiptMode(next);
    onNotify(
      next === 'auto'
        ? 'Receipt mode: Auto-Print on checkout'
        : next === 'none'
        ? 'Receipt mode: No Receipt (Fast Express Lane)'
        : 'Receipt mode: Prompt after checkout',
    );
  }

  async function handleConnectUsbPrinter() {
    try {
      const name = await printerHardware.connectUsbPrinter();
      setPrinterStatus(printerHardware.getStatus());
      onNotify(`Connected to ${name} via WebUSB`);
    } catch (e) {
      onNotify((e as Error).message, true);
    }
  }

  async function handleConnectSerialPrinter() {
    try {
      const name = await printerHardware.connectSerialPrinter();
      setPrinterStatus(printerHardware.getStatus());
      onNotify(`Connected to ${name}`);
    } catch (e) {
      onNotify((e as Error).message, true);
    }
  }

  async function handleTestKickDrawer() {
    const res = await printerHardware.kickCashDrawer();
    setPrinterStatus(printerHardware.getStatus());
    onNotify(
      res.hardwareSent
        ? `Cash drawer kick pulse (${res.commandHex}) sent to RJ12 port!`
        : `Cash drawer pulse (${res.commandHex}) triggered (simulated audio chime).`,
    );
  }

  async function handleConnectScale() {
    try {
      await scaleHardware.connectSerialScale();
      setScaleStatus(scaleHardware.getStatus());
      onNotify('Connected to RS-232 / USB counter scale');
    } catch (e) {
      onNotify((e as Error).message, true);
    }
  }

  async function handlePairReader(e: React.FormEvent) {
    e.preventDefault();
    if (!regCode.trim()) return;
    setPairing(true);
    try {
      const res = await api<any>('/terminal/register-reader', {
        method: 'POST',
        json: {
          registrationCode: regCode.trim(),
          label: readerLabel.trim() || 'Lane 1 - WisePOS E',
        },
      });
      setTerminalInfo((prev: any) => ({ ...prev, reader: res.reader, mode: res.mode }));
      setRegCode('');
      onNotify(`Paired reader: ${res.reader.label} (${res.reader.id})`);
    } catch (err) {
      onNotify((err as Error).message, true);
    } finally {
      setPairing(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="glass modal animate-in"
        style={{ width: 'min(660px, 95vw)', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0 }}>🔌 Lane Hardware & Peripherals</h2>
            <div className="muted" style={{ fontSize: '.82rem', marginTop: '.2rem' }}>
              Configure 80mm ESC/POS thermal printer, RJ12 cash drawer, RS-232 scale & Stripe Terminal reader.
            </div>
          </div>
          <button className="btn" style={{ padding: '.3rem .65rem' }} onClick={onClose}>
            ✕
          </button>
        </div>

        {/* 1. Receipt Mode Toggle (Spec 4b) */}
        <section style={{ background: 'var(--surface)', padding: '1rem', borderRadius: 8, border: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 700, fontSize: '.95rem', marginBottom: '.4rem' }}>
            🧾 Receipt Printing Mode (Spec 4b)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '.5rem' }}>
            <button
              type="button"
              className={`btn ${mode === 'prompt' ? 'btn-primary' : ''}`}
              onClick={() => handleModeChange('prompt')}
            >
              📋 Prompt / Preview
            </button>
            <button
              type="button"
              className={`btn ${mode === 'auto' ? 'btn-primary' : ''}`}
              onClick={() => handleModeChange('auto')}
            >
              🖨️ Auto-Print (80mm)
            </button>
            <button
              type="button"
              className={`btn ${mode === 'none' ? 'btn-primary' : ''}`}
              onClick={() => handleModeChange('none')}
            >
              ⚡ Fast / No Receipt
            </button>
          </div>
        </section>

        {/* 2. ESC/POS Thermal Receipt Printer & RJ12 Cash Drawer */}
        <section style={{ background: 'var(--surface)', padding: '1rem', borderRadius: 8, border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.5rem' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '.95rem' }}>
                🖨️ 80mm ESC/POS Thermal Printer & RJ12 Cash Drawer
              </div>
              <div className="muted" style={{ fontSize: '.8rem' }}>
                {printerStatus.connected
                  ? `Connected: ${printerStatus.deviceName} (${printerStatus.transport})`
                  : 'Using browser print fallback (pair USB/Serial ESC/POS printer for direct cut & drawer kick)'}
              </div>
            </div>
            <span className={`badge ${printerStatus.connected ? 'badge-snap' : 'badge-muted'}`}>
              {printerStatus.connected ? '● HARDWARE ONLINE' : 'FALLBACK MODE'}
            </span>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', marginTop: '.6rem' }}>
            <button type="button" className="btn btn-sm" onClick={handleConnectUsbPrinter}>
              🔌 Pair USB Printer (WebUSB)
            </button>
            <button type="button" className="btn btn-sm" onClick={handleConnectSerialPrinter}>
              🔌 Pair Serial Printer (COM)
            </button>
            <button
              type="button"
              className="btn btn-sm"
              style={{ borderColor: 'var(--brand)', color: 'var(--brand)' }}
              onClick={handleTestKickDrawer}
            >
              🔓 Test Drawer Kick Pulse (ESC p)
            </button>
          </div>
          {printerStatus.lastPulseAt && (
            <div className="mono muted" style={{ fontSize: '.75rem', marginTop: '.4rem' }}>
              Last RJ12 drawer kick pulse (`1B 70 00 19 FA`) sent at {printerStatus.lastPulseAt}
            </div>
          )}
        </section>

        {/* 3. RS-232 / USB Counter Scale */}
        <section style={{ background: 'var(--surface)', padding: '1rem', borderRadius: 8, border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.5rem' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '.95rem' }}>
                ⚖️ Produce & Deli Scanner/Scale (RS-232 / Web Serial)
              </div>
              <div className="muted" style={{ fontSize: '.8rem' }}>
                Streams live weight into the PLU weigh modal (NCI / Toledo / CAS protocol).
              </div>
            </div>
            <span className="mono" style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--brand)' }}>
              {liveWeight.toFixed(3)} lb
            </span>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', marginTop: '.6rem' }}>
            <button type="button" className="btn btn-sm" onClick={handleConnectScale}>
              🔌 Connect Serial Scale (9600 baud)
            </button>
            <button
              type="button"
              className="btn btn-sm"
              style={{ borderColor: 'var(--brand)', color: 'var(--brand)' }}
              onClick={() => {
                const w = scaleHardware.simulateScaleRead();
                onNotify(`Simulated live scale reading: ${w.toFixed(3)} lb`);
              }}
            >
              ⚖️ Simulate Scale Reading ({liveWeight > 0 ? `${liveWeight.toFixed(3)} lb` : 'Random'})
            </button>
          </div>
        </section>

        {/* 4. Stripe Terminal WisePOS E / S700 Reader Pairing */}
        <section style={{ background: 'var(--surface)', padding: '1rem', borderRadius: 8, border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.5rem' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '.95rem' }}>
                💳 Stripe Terminal Reader Pairing (WisePOS E / S700)
              </div>
              <div className="muted" style={{ fontSize: '.8rem' }}>
                Active Reader: <b>{terminalInfo?.reader?.label || 'Simulated WisePOS E'}</b> ({terminalInfo?.reader?.id || 'simulated'})
              </div>
            </div>
            <span className={`badge ${terminalInfo?.configured ? 'badge-snap' : 'badge-age'}`}>
              {terminalInfo?.configured ? 'STRIPE LIVE/TEST' : 'SIMULATED'}
            </span>
          </div>

          <form onSubmit={handlePairReader} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '.5rem', marginTop: '.6rem' }}>
            <input
              className="input mono"
              placeholder="Registration code (e.g. simulated-wpos-1)"
              value={regCode}
              onChange={(e) => setRegCode(e.target.value)}
            />
            <input
              className="input"
              placeholder="Lane label (e.g. Lane 1 - WisePOS E)"
              value={readerLabel}
              onChange={(e) => setReaderLabel(e.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={pairing || !regCode.trim()}>
              {pairing ? 'Pairing...' : 'Pair Reader'}
            </button>
          </form>
          <div className="muted" style={{ fontSize: '.75rem', marginTop: '.4rem' }}>
            Tip: On a physical WisePOS E, swipe right → Settings → enter admin PIN <code>07139</code> → Generate pairing code. For Stripe test mode, enter <code>simulated-wpos-1</code>.
          </div>
        </section>
      </div>
    </div>
  );
}
