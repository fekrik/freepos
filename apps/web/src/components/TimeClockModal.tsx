import React, { useEffect, useState } from 'react';
import { api } from '../api';

interface TimeClockModalProps {
  tenant?: string;
  storeId?: string;
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

interface StatusResponse {
  isClockedIn: boolean;
  employeeName?: string;
  durationMinutes?: number;
  clockInTime?: string | null;
}

export function TimeClockModal({
  tenant = 'demo',
  storeId = '',
  defaultEmployeeNo = '',
  onClose,
  onSuccess,
}: TimeClockModalProps) {
  const [employeeNo, setEmployeeNo] = useState(defaultEmployeeNo);
  const [pin, setPin] = useState('');
  const [note, setNote] = useState('');
  const [activeField, setActiveField] = useState<'emp' | 'pin'>(defaultEmployeeNo ? 'pin' : 'emp');
  const [step, setStep] = useState<'input' | 'result'>('input');
  const [result, setResult] = useState<PunchResponse | null>(null);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // Sync defaultEmployeeNo if it arrives or changes
  useEffect(() => {
    if (defaultEmployeeNo) {
      setEmployeeNo(defaultEmployeeNo);
      setActiveField('pin');
    }
  }, [defaultEmployeeNo]);

  // Check shift status for current employee number
  useEffect(() => {
    const trimmed = employeeNo.trim();
    if (trimmed.length >= 3) {
      setStatusLoading(true);
      api<StatusResponse>(`/time-clock/status?employeeNo=${encodeURIComponent(trimmed)}&tenant=${encodeURIComponent(tenant || 'demo')}`)
        .then((res) => setStatus(res))
        .catch(() => setStatus(null))
        .finally(() => setStatusLoading(false));
    } else {
      setStatus(null);
    }
  }, [employeeNo, tenant]);

  function handleKeypad(digit: string) {
    setErr('');
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

  // Keyboard navigation support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (step !== 'input') return;
      if (e.target instanceof HTMLInputElement && e.target.type === 'text') return;

      if (e.key >= '0' && e.key <= '9') {
        handleKeypad(e.key);
      } else if (e.key === 'Backspace') {
        handleKeypad('⌫');
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeField === 'emp' && employeeNo) {
          setActiveField('pin');
        } else if (activeField === 'pin' && pin) {
          handleSubmit();
        }
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [step, activeField, employeeNo, pin]);

  async function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!employeeNo) {
      setErr('Please enter your Employee Number');
      setActiveField('emp');
      return;
    }
    if (!pin) {
      setErr('Please enter your PIN');
      setActiveField('pin');
      return;
    }

    setBusy(true);
    setErr('');

    try {
      const res = await api<PunchResponse>('/time-clock/punch', {
        method: 'POST',
        json: {
          tenant: tenant || 'demo',
          storeId: storeId || undefined,
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

  const isClockedIn = status?.isClockedIn;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="glass modal"
        style={{ width: 'min(440px, 94vw)', display: 'flex', flexDirection: 'column', gap: '1.15rem' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.35rem' }}>
                {status ? (isClockedIn ? '🚪 Clock Out' : '🟢 Clock In') : '⏱️ Employee Time Clock'}
              </h2>
              {status && (
                <span
                  className="badge"
                  style={{
                    background: isClockedIn ? 'hsla(152, 68%, 46%, 0.18)' : 'hsla(212, 90%, 64%, 0.18)',
                    color: isClockedIn ? 'var(--brand)' : 'var(--snap)',
                    fontWeight: 700,
                  }}
                >
                  {isClockedIn ? 'Currently On Shift' : 'Off Shift'}
                </span>
              )}
            </div>
            <div className="muted" style={{ fontSize: '.85rem', marginTop: '.2rem' }}>
              {status?.employeeName ? `${status.employeeName} · ` : ''}Enter your PIN to {isClockedIn ? 'clock out' : 'clock in'}
            </div>
          </div>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            ✕
          </button>
        </div>

        {step === 'input' ? (
          <>
            {/* Live Shift Status Banner */}
            {status && (
              <div
                style={{
                  background: isClockedIn ? 'hsla(152, 68%, 46%, 0.1)' : 'hsla(212, 90%, 64%, 0.08)',
                  border: `1px solid ${isClockedIn ? 'var(--brand)' : 'var(--border)'}`,
                  borderRadius: 10,
                  padding: '.65rem .85rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: '.9rem', color: isClockedIn ? 'var(--brand)' : 'var(--text)' }}>
                    {isClockedIn ? '🟢 Active Shift in Progress' : '⚪ Currently Clocked Out'}
                  </div>
                  <div className="muted" style={{ fontSize: '.8rem', marginTop: '.1rem' }}>
                    {isClockedIn
                      ? `Clocked in at ${status.clockInTime} (${status.durationMinutes} min ago)`
                      : 'Punching will start a new shift recording'}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: '.8rem',
                    fontWeight: 800,
                    padding: '.25rem .6rem',
                    borderRadius: 6,
                    background: isClockedIn ? 'hsla(38, 92%, 50%, 0.18)' : 'hsla(152, 68%, 46%, 0.18)',
                    color: isClockedIn ? 'var(--warn)' : 'var(--brand)',
                  }}
                >
                  {isClockedIn ? 'ACTION: CLOCK OUT 🚪' : 'ACTION: CLOCK IN 🟢'}
                </span>
              </div>
            )}

            <div style={{ display: 'grid', gap: '.75rem' }}>
              {/* Field 1: Employee Number */}
              <div
                style={{
                  padding: '.55rem .8rem',
                  borderRadius: 10,
                  border: `2px solid ${activeField === 'emp' ? 'var(--brand)' : 'var(--border)'}`,
                  background: activeField === 'emp' ? 'hsla(152, 68%, 46%, 0.06)' : 'var(--surface)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onClick={() => setActiveField('emp')}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.2rem' }}>
                  <span style={{ fontSize: '.8rem', color: activeField === 'emp' ? 'var(--brand)' : 'var(--muted)', fontWeight: 600 }}>
                    1. EMPLOYEE NUMBER
                  </span>
                  {activeField === 'emp' && (
                    <span style={{ fontSize: '.75rem', color: 'var(--brand)', fontWeight: 700 }}>● Active Field</span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span className="mono" style={{ fontSize: '1.35rem', fontWeight: 700, letterSpacing: '.1rem' }}>
                    {employeeNo || <span className="muted" style={{ fontSize: '1rem', fontWeight: 400 }}>Tap or type (e.g. 3000)</span>}
                  </span>
                  {employeeNo && activeField === 'emp' && (
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      style={{ fontSize: '.75rem', padding: '.25rem .6rem' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveField('pin');
                      }}
                    >
                      Next ➔
                    </button>
                  )}
                </div>
              </div>

              {/* Field 2: Employee PIN */}
              <div
                style={{
                  padding: '.55rem .8rem',
                  borderRadius: 10,
                  border: `2px solid ${activeField === 'pin' ? 'var(--brand)' : 'var(--border)'}`,
                  background: activeField === 'pin' ? 'hsla(152, 68%, 46%, 0.06)' : 'var(--surface)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onClick={() => setActiveField('pin')}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.2rem' }}>
                  <span style={{ fontSize: '.8rem', color: activeField === 'pin' ? 'var(--brand)' : 'var(--muted)', fontWeight: 600 }}>
                    2. PIN CODE
                  </span>
                  {activeField === 'pin' && (
                    <span style={{ fontSize: '.75rem', color: 'var(--brand)', fontWeight: 700 }}>● Active Field</span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '34px' }}>
                  {pin ? (
                    <span className="mono" style={{ fontSize: '1.6rem', letterSpacing: '.4rem', color: 'var(--brand)' }}>
                      {'•'.repeat(pin.length)}
                    </span>
                  ) : (
                    <span className="muted" style={{ fontSize: '.95rem' }}>
                      Enter 4-digit PIN
                    </span>
                  )}
                </div>
              </div>

              {/* Optional Shift Note */}
              <div>
                <input
                  className="input"
                  placeholder="Optional shift note (e.g. Lunch break, Covering register...)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  style={{ fontSize: '.85rem', padding: '.45rem .8rem' }}
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
                    padding: '.65rem 0',
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

            {err && (
              <div className="error" style={{ textAlign: 'center', padding: '.4rem', background: 'hsla(0, 72%, 51%, 0.1)', borderRadius: 6 }}>
                ⚠️ {err}
              </div>
            )}

            <div style={{ display: 'flex', gap: '.6rem', justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: '.8rem' }}>
              <button type="button" className="btn" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                className={`btn ${isClockedIn ? 'btn-warn' : 'btn-primary'}`}
                style={{ padding: '.65rem 1.4rem', fontWeight: 700 }}
                onClick={() => handleSubmit()}
                disabled={busy || !pin || !employeeNo}
              >
                {busy
                  ? 'Verifying...'
                  : isClockedIn
                  ? '🚪 Confirm Clock Out'
                  : '🟢 Confirm Clock In'}
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
