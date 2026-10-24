import React, { useState } from 'react';
import { api } from '../api';

interface TimeClockModalProps {
  tenant: string;
  storeId: string;
  defaultEmployeeNo?: string;
  onClose: () => void;
  onSuccess?: (msg: string) => void;
}

interface PunchResponse {
  action: 'clock_in' | 'clock_out';
  employeeId: string;
  employeeName: string;
  clockIn: string;
  clockOut?: string;
  hoursWorked?: number;
  message: string;
}

export function TimeClockModal({
  tenant,
  storeId,
  defaultEmployeeNo = '',
  onClose,
  onSuccess,
}: TimeClockModalProps) {
  const [employeeNo, setEmployeeNo] = useState(defaultEmployeeNo);
  const [pin, setPin] = useState('');
  const [note, setNote] = useState('');
  const [step, setStep] = useState<'input' | 'result'>('input');
  const [result, setResult] = useState<PunchResponse | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const activeField = defaultEmployeeNo ? 'pin' : employeeNo ? 'pin' : 'emp';

  function handleKeypad(digit: string) {
    if (activeField === 'emp') {
      if (digit === '⌫') setEmployeeNo((v) => v.slice(0, -1));
      else if (digit === 'C') setEmployeeNo('');
      else setEmployeeNo((v) => (v + digit).slice(0, 8));
    } else {
      if (digit === '⌫') setPin((v) => v.slice(0, -1));
      else if (digit === 'C') setPin('');
      else setPin((v) => (v + digit).slice(0, 8));
    }
  }

  async function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!employeeNo || !pin) {
      setErr('Please enter both Employee # and PIN');
      return;
    }

    setBusy(true);
    setErr('');

    try {
      const res = await api<PunchResponse>('/time-clock/punch', {
        method: 'POST',
        json: {
          tenant,
          storeId,
          employeeNo,
          pin,
          note: note.trim() || undefined,
        },
      });

      setResult(res);
      setStep('result');
      if (onSuccess) {
        onSuccess(res.message);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="glass modal"
        style={{ width: 'min(440px, 94vw)', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.35rem' }}>⏱️ Employee Time Clock</h2>
            <div className="muted" style={{ fontSize: '.85rem', marginTop: '.2rem' }}>
              Clock in and clock out with your employee PIN
            </div>
          </div>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            ✕
          </button>
        </div>

        {step === 'input' ? (
          <>
            <div style={{ display: 'grid', gap: '.8rem' }}>
              {!defaultEmployeeNo && (
                <div>
                  <label style={{ fontSize: '.85rem', color: 'var(--muted)', display: 'block', marginBottom: '.3rem' }}>
                    Employee Number
                  </label>
                  <input
                    className="input mono"
                    placeholder="e.g. 101"
                    value={employeeNo}
                    onChange={(e) => setEmployeeNo(e.target.value)}
                    autoFocus
                  />
                </div>
              )}

              <div>
                <label style={{ fontSize: '.85rem', color: 'var(--muted)', display: 'block', marginBottom: '.3rem' }}>
                  {defaultEmployeeNo ? `PIN for Employee #${employeeNo}` : 'Enter PIN'}
                </label>
                <div
                  className="input mono"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1.5rem',
                    letterSpacing: '.4rem',
                    height: '48px',
                  }}
                >
                  {pin ? '•'.repeat(pin.length) : <span className="muted" style={{ fontSize: '.9rem', letterSpacing: 'normal' }}>Enter PIN</span>}
                </div>
              </div>

              <div>
                <label style={{ fontSize: '.85rem', color: 'var(--muted)', display: 'block', marginBottom: '.3rem' }}>
                  Optional Shift Note
                </label>
                <input
                  className="input"
                  placeholder="e.g. Morning Shift, Covering Lunch..."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  style={{ fontSize: '.9rem', padding: '.5rem .8rem' }}
                />
              </div>
            </div>

            {/* Touch Keypad */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '.4rem' }}>
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((k) => (
                <button
                  key={k}
                  type="button"
                  className="btn"
                  style={{
                    padding: '.7rem 0',
                    fontSize: '1.25rem',
                    fontWeight: 700,
                    color: k === 'C' ? 'var(--warn)' : k === '⌫' ? 'var(--danger)' : 'var(--text)',
                  }}
                  onClick={() => handleKeypad(k)}
                >
                  {k}
                </button>
              ))}
            </div>

            {err && <div className="error" style={{ textAlign: 'center' }}>{err}</div>}

            <div style={{ display: 'flex', gap: '.6rem', justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: '.8rem' }}>
              <button type="button" className="btn" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ padding: '.65rem 1.4rem', fontWeight: 700 }}
                onClick={() => handleSubmit()}
                disabled={busy || !pin || (!defaultEmployeeNo && !employeeNo)}
              >
                {busy ? 'Verifying...' : 'Punch Clock ✓'}
              </button>
            </div>
          </>
        ) : (
          /* RESULT SCREEN */
          <div style={{ textAlign: 'center', padding: '1rem 0', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div
              style={{
                width: 68,
                height: 68,
                borderRadius: '50%',
                background: result?.action === 'clock_in' ? 'hsla(152, 68%, 46%, 0.2)' : 'hsla(212, 90%, 64%, 0.2)',
                border: result?.action === 'clock_in' ? '2px solid var(--brand)' : '2px solid var(--snap)',
                color: result?.action === 'clock_in' ? 'var(--brand)' : 'var(--snap)',
                display: 'grid',
                placeItems: 'center',
                fontSize: '2rem',
                margin: '0 auto',
              }}
            >
              {result?.action === 'clock_in' ? '✓' : '👋'}
            </div>

            <div>
              <h3 style={{ fontSize: '1.5rem', margin: '0 0 .4rem 0', fontWeight: 800 }}>
                {result?.action === 'clock_in' ? 'Clocked In' : 'Clocked Out'}
              </h3>
              <p className="muted" style={{ fontSize: '1rem', margin: 0 }}>
                {result?.message}
              </p>
            </div>

            <div style={{ background: 'var(--surface)', padding: '1rem', borderRadius: 12, border: '1px solid var(--border)', textAlign: 'left', display: 'grid', gap: '.4rem', fontSize: '.9rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="muted">Employee</span>
                <span style={{ fontWeight: 600 }}>{result?.employeeName}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="muted">Timestamp</span>
                <span className="mono">{new Date().toLocaleString()}</span>
              </div>
              {result?.hoursWorked !== undefined && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--brand)', fontWeight: 700, borderTop: '1px solid var(--border)', paddingTop: '.4rem', marginTop: '.2rem' }}>
                  <span>Total Shift Hours</span>
                  <span className="mono">{result.hoursWorked} hrs</span>
                </div>
              )}
            </div>

            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%', padding: '.8rem 0', fontWeight: 700 }}
              onClick={onClose}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
