import React, { useState } from 'react';
import { api } from '../api';
import { formatCents, type Cents } from '@freshpos/shared';
import type { ZReportData } from './ZReportModal';
import { printerHardware } from '../hardware';

export interface ShiftInfo {
  id: string;
  openedAt: string;
  openingFloatCents: number;
  register?: { name: string };
  drawerMovements?: Array<{
    id: string;
    type: string;
    amountCents: number;
    reason: string;
    createdAt: string;
  }>;
}

interface Props {
  currentShift: ShiftInfo | null;
  onClose: () => void;
  onShiftClosed: (zReport: ZReportData) => void;
  onShiftUpdated: () => void;
}

type Tab = 'actions' | 'drop' | 'payout' | 'close';

export function ShiftModal({ currentShift, onClose, onShiftClosed, onShiftUpdated }: Props) {
  const [tab, setTab] = useState<Tab>('actions');
  const [noSaleReason, setNoSaleReason] = useState('Change for customer');
  const [dropAmount, setDropAmount] = useState('');
  const [dropReason, setDropReason] = useState('Excess cash drop to safe');
  const [payoutAmount, setPayoutAmount] = useState('');
  const [payoutPayee, setPayoutPayee] = useState('');
  const [payoutReason, setPayoutReason] = useState('Store supplies / Petty cash');
  const [closingCash, setClosingCash] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  async function handleNoSale() {
    setError('');
    setSubmitting(true);
    try {
      await api('/shifts/drawer-movement', {
        method: 'POST',
        json: {
          type: 'no_sale',
          amountCents: 0,
          reason: noSaleReason,
        },
      });
      await printerHardware.kickCashDrawer();
      setSuccessMsg('Cash drawer kicked open (ESC p pulse sent & No-Sale audited).');
      onShiftUpdated();
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCashDrop(e: React.FormEvent) {
    e.preventDefault();
    const dollars = parseFloat(dropAmount);
    if (!(dollars > 0)) {
      setError('Please enter a valid drop amount.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await api('/shifts/drawer-movement', {
        method: 'POST',
        json: {
          type: 'cash_drop',
          amountCents: Math.round(dollars * 100),
          reason: dropReason,
        },
      });
      setSuccessMsg(`Cash drop of $${dollars.toFixed(2)} recorded to store safe.`);
      setDropAmount('');
      setTab('actions');
      onShiftUpdated();
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePaidOut(e: React.FormEvent) {
    e.preventDefault();
    const dollars = parseFloat(payoutAmount);
    if (!(dollars > 0)) {
      setError('Please enter a valid payout amount.');
      return;
    }
    if (!payoutPayee.trim()) {
      setError('Please enter payee / recipient.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      await api('/shifts/drawer-movement', {
        method: 'POST',
        json: {
          type: 'paid_out',
          amountCents: Math.round(dollars * 100),
          payee: payoutPayee.trim(),
          reason: payoutReason,
        },
      });
      setSuccessMsg(`Paid-out of $${dollars.toFixed(2)} to ${payoutPayee} recorded.`);
      setPayoutAmount('');
      setPayoutPayee('');
      setTab('actions');
      onShiftUpdated();
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCloseShift(e: React.FormEvent) {
    e.preventDefault();
    const dollars = parseFloat(closingCash);
    if (isNaN(dollars) || dollars < 0) {
      setError('Please enter counted cash in drawer.');
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const res = await api<{ zReport: ZReportData }>('/shifts/close', {
        method: 'POST',
        json: {
          closingCashCents: Math.round(dollars * 100),
        },
      });
      onShiftClosed(res.zReport);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="glass modal animate-in" style={{ width: 'min(500px, 95vw)', padding: '1.5rem' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', margin: 0 }}>💵 Cash Drawer & Shift Management</h2>
            <div className="muted" style={{ fontSize: '.8rem', marginTop: '.2rem' }}>
              Till Float: {formatCents(currentShift?.openingFloatCents || 20000)} · Status: <span style={{ color: 'var(--brand)', fontWeight: 600 }}>Active Shift</span>
            </div>
          </div>
          <button className="btn" style={{ padding: '.3rem .6rem' }} onClick={onClose} disabled={submitting}>✕</button>
        </div>

        {/* Tab Navigation */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '.4rem', marginTop: '.5rem' }}>
          <button
            type="button"
            className={`btn ${tab === 'actions' ? 'btn-primary' : ''}`}
            style={{ fontSize: '.8rem', padding: '.4rem' }}
            onClick={() => setTab('actions')}
          >
            Till Quick
          </button>
          <button
            type="button"
            className={`btn ${tab === 'drop' ? 'btn-primary' : ''}`}
            style={{ fontSize: '.8rem', padding: '.4rem' }}
            onClick={() => setTab('drop')}
          >
            Safe Drop
          </button>
          <button
            type="button"
            className={`btn ${tab === 'payout' ? 'btn-primary' : ''}`}
            style={{ fontSize: '.8rem', padding: '.4rem' }}
            onClick={() => setTab('payout')}
          >
            Paid-Out
          </button>
          <button
            type="button"
            className={`btn ${tab === 'close' ? 'btn-danger' : ''}`}
            style={{ fontSize: '.8rem', padding: '.4rem' }}
            onClick={() => setTab('close')}
          >
            End Shift
          </button>
        </div>

        {successMsg && (
          <div style={{ background: 'hsla(160, 60%, 45%, 0.2)', border: '1px solid var(--brand)', padding: '.6rem', borderRadius: 8, fontSize: '.85rem', color: 'var(--brand)', textAlign: 'center' }}>
            ✓ {successMsg}
          </div>
        )}

        {error && <div className="error" style={{ textAlign: 'center' }}>{error}</div>}

        {/* TAB 1: Quick Till Operations (No-Sale Drawer Kick) */}
        {tab === 'actions' && (
          <div style={{ display: 'grid', gap: '1rem' }}>
            <div style={{ background: 'var(--surface)', padding: '1rem', borderRadius: 8 }}>
              <div style={{ fontWeight: 600, marginBottom: '.4rem', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                <span>🔓 No-Sale Drawer Kick</span>
                <span className="badge badge-muted">Audited</span>
              </div>
              <p className="muted" style={{ fontSize: '.85rem', margin: '0 0 .8rem 0' }}>
                Open cash drawer without a sale to provide change or inspect currency. A permanent audit log is created.
              </p>
              <label style={{ fontSize: '.85rem' }}>
                Audit Reason
                <select className="input" value={noSaleReason} onChange={(e) => setNoSaleReason(e.target.value)}>
                  <option value="Change for customer">Change for customer</option>
                  <option value="Replace receipt roll">Replace receipt roll</option>
                  <option value="Till inspection / Float verification">Till inspection / Float verification</option>
                  <option value="Customer forgot change in till">Customer forgot change in till</option>
                </select>
              </label>
              <button
                id="no-sale-btn"
                type="button"
                className="btn btn-primary wide"
                style={{ marginTop: '.8rem' }}
                onClick={handleNoSale}
                disabled={submitting}
              >
                {submitting ? 'Opening...' : '⚡ Kick Cash Drawer (No-Sale)'}
              </button>
            </div>

            {/* Recent drawer movements in shift */}
            {currentShift?.drawerMovements && currentShift.drawerMovements.length > 0 && (
              <div>
                <div style={{ fontSize: '.85rem', fontWeight: 600, color: 'var(--muted)', marginBottom: '.3rem' }}>
                  Recent Drawer Activity This Shift:
                </div>
                <div style={{ maxHeight: 120, overflowY: 'auto', display: 'grid', gap: '.3rem' }}>
                  {currentShift.drawerMovements.slice(-4).reverse().map((m) => (
                    <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.8rem', padding: '.3rem .6rem', background: 'var(--surface)', borderRadius: 4 }}>
                      <span style={{ textTransform: 'uppercase', fontWeight: 600 }}>{m.type.replace('_', ' ')}: {m.reason}</span>
                      <span className="mono">{m.amountCents > 0 ? formatCents(m.amountCents) : '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: Cash Drop to Safe */}
        {tab === 'drop' && (
          <form onSubmit={handleCashDrop} style={{ display: 'grid', gap: '.8rem' }}>
            <div className="muted" style={{ fontSize: '.85rem' }}>
              Skim excess cash from the register till and transfer it to the store safe to reduce robbery exposure.
            </div>
            <label>
              Drop Amount ($)
              <input
                id="drop-amount"
                className="input mono"
                autoFocus
                inputMode="decimal"
                placeholder="200.00"
                value={dropAmount}
                onChange={(e) => setDropAmount(e.target.value)}
              />
            </label>
            <div style={{ display: 'flex', gap: '.4rem' }}>
              {[100, 200, 300, 500].map((amt) => (
                <button
                  key={amt}
                  type="button"
                  className="btn"
                  style={{ flex: 1, padding: '.3rem' }}
                  onClick={() => setDropAmount(amt.toFixed(2))}
                >
                  ${amt}
                </button>
              ))}
            </div>
            <label>
              Reason
              <input className="input" value={dropReason} onChange={(e) => setDropReason(e.target.value)} />
            </label>
            <button id="submit-drop-btn" className="btn btn-primary wide" type="submit" disabled={submitting}>
              {submitting ? 'Recording...' : 'Record Safe Drop'}
            </button>
          </form>
        )}

        {/* TAB 3: Paid-Out Petty Cash */}
        {tab === 'payout' && (
          <form onSubmit={handlePaidOut} style={{ display: 'grid', gap: '.8rem' }}>
            <div className="muted" style={{ fontSize: '.85rem' }}>
              Remove cash from the till for immediate store expenses (e.g. ice delivery, emergency supplies).
            </div>
            <label>
              Payout Amount ($)
              <input
                id="payout-amount"
                className="input mono"
                autoFocus
                inputMode="decimal"
                placeholder="25.00"
                value={payoutAmount}
                onChange={(e) => setPayoutAmount(e.target.value)}
              />
            </label>
            <label>
              Payee / Vendor Name
              <input
                id="payout-payee"
                className="input"
                placeholder="e.g. Arctic Ice Co. or Hardware Store"
                value={payoutPayee}
                onChange={(e) => setPayoutPayee(e.target.value)}
              />
            </label>
            <label>
              Expense Description / Receipt #
              <input className="input" value={payoutReason} onChange={(e) => setPayoutReason(e.target.value)} />
            </label>
            <button id="submit-payout-btn" className="btn btn-primary wide" type="submit" disabled={submitting}>
              {submitting ? 'Recording...' : 'Record Paid-Out'}
            </button>
          </form>
        )}

        {/* TAB 4: Close Shift & Z-Report */}
        {tab === 'close' && (
          <form onSubmit={handleCloseShift} style={{ display: 'grid', gap: '.8rem' }}>
            <div style={{ background: 'hsla(350, 70%, 50%, 0.1)', border: '1px solid var(--danger)', padding: '.8rem', borderRadius: 8 }}>
              <div style={{ fontWeight: 700, color: 'var(--danger)', fontSize: '.9rem' }}>⚠️ End-of-Day Shift Closeout</div>
              <p className="muted" style={{ fontSize: '.82rem', margin: '.3rem 0 0 0' }}>
                Perform a <b>blind cash count</b>. Count all physical cash in your drawer (including the $200 float) and enter the total. The system will calculate over/short variance and generate the official Z-Report.
              </p>
            </div>
            <label>
              Total Cash Counted in Till ($)
              <input
                id="closing-cash-input"
                className="input mono"
                autoFocus
                inputMode="decimal"
                placeholder="0.00"
                value={closingCash}
                onChange={(e) => setClosingCash(e.target.value)}
              />
            </label>
            <button id="close-shift-btn" className="btn btn-danger wide btn-lg" type="submit" disabled={submitting}>
              {submitting ? 'Generating Z-Report...' : '📊 Close Shift & Print Z-Report'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
