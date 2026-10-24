import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { formatCents, type Cents } from '@freshpos/shared';
import type { ReceiptData } from './ReceiptModal';

interface OriginalSale {
  id: string;
  saleNumber: string;
  completedAt: string;
  totalCents: number;
  snapPaidCents: number;
  customer?: { name: string; phone: string; points: number };
  payments: Array<{ tenderType: string; amountCents: number; cardBrand?: string; last4?: string }>;
  lines: Array<{
    id: string;
    productId: string;
    name: string;
    soldBy: 'each' | 'weight';
    quantity: number;
    unitPriceCents: number;
    fixedTotalCents?: number;
    taxRateBps: number;
    snapEligible: boolean;
    depositCents: number;
    discountCents: number;
  }>;
}

interface ReturnLineSelection {
  selected: boolean;
  quantity: number;
  reason: string;
  action: 'restock' | 'spoilage_writeoff';
}

interface Props {
  onClose: () => void;
  onRefundCompleted: (receipt: ReceiptData) => void;
}

const RETURN_REASONS = [
  'Damaged / Defective Packaging',
  'Spoiled / Expired Product',
  'Wrong Item Purchased',
  'Customer Dissatisfaction / Quality Dispute',
  'Product Recall',
];

export function ReturnModal({ onClose, onRefundCompleted }: Props) {
  const [saleNumberInput, setSaleNumberInput] = useState('');
  const [recentSales, setRecentSales] = useState<Array<{ id: string; saleNumber: string; totalCents: number; completedAt: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [sale, setSale] = useState<OriginalSale | null>(null);
  const [lineSelections, setLineSelections] = useState<Record<string, ReturnLineSelection>>({});
  const [refundTender, setRefundTender] = useState<'cash' | 'card' | 'ebt_snap'>('cash');
  const [supervisorPin, setSupervisorPin] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Fetch recent sales for 1-click lookup during demo
  useEffect(() => {
    api<{ sales: OriginalSale[] }>('/sales?take=4')
      .then((res) => {
        setRecentSales(res.sales.filter((s) => s.totalCents > 0));
      })
      .catch(() => {});
  }, []);

  async function handleLookup(lookupCode?: string) {
    const q = (lookupCode || saleNumberInput).trim();
    if (!q) return;
    setError('');
    setLoading(true);
    try {
      const found = await api<OriginalSale>(`/sales/${encodeURIComponent(q)}`);
      setSale(found);

      // Pre-populate selections for all lines
      const initial: Record<string, ReturnLineSelection> = {};
      found.lines.forEach((l) => {
        initial[l.id] = {
          selected: false,
          quantity: l.soldBy === 'weight' ? l.quantity : 1,
          reason: RETURN_REASONS[0],
          action: 'restock',
        };
      });
      setLineSelections(initial);

      // Set smart default tender based on original payment
      if (found.snapPaidCents > 0) {
        setRefundTender('ebt_snap');
      } else if (found.payments.some((p) => p.tenderType === 'card')) {
        setRefundTender('card');
      } else {
        setRefundTender('cash');
      }
    } catch (e) {
      setError((e as Error).message || 'Transaction not found.');
      setSale(null);
    } finally {
      setLoading(false);
    }
  }

  // Calculate estimated refund total
  const estimatedRefundCents = sale
    ? sale.lines.reduce((total, l) => {
        const sel = lineSelections[l.id];
        if (!sel || !sel.selected) return total;

        let lineNet: number;
        if (l.soldBy === 'weight') {
          const fullPrice = l.fixedTotalCents ?? Math.round((l.unitPriceCents * l.quantity) / 1000);
          lineNet = Math.round(fullPrice * (sel.quantity / l.quantity));
        } else {
          const unitNet = Math.round((l.unitPriceCents * l.quantity - l.discountCents) / l.quantity);
          lineNet = unitNet * sel.quantity;
        }

        const tax = Math.round((lineNet * l.taxRateBps) / 10000);
        const unitDeposit = l.soldBy === 'each' && l.quantity > 0 ? Math.round(l.depositCents / l.quantity) : 0;
        const deposit = unitDeposit * sel.quantity;

        return total + lineNet + tax + deposit;
      }, 0)
    : 0;

  async function submitRefund(e: React.FormEvent) {
    e.preventDefault();
    if (!sale) return;

    const returnLines = sale.lines
      .filter((l) => lineSelections[l.id]?.selected)
      .map((l) => ({
        saleLineId: l.id,
        productId: l.productId,
        quantity: lineSelections[l.id].quantity,
        reason: lineSelections[l.id].reason,
        action: lineSelections[l.id].action,
      }));

    if (returnLines.length === 0) {
      setError('Please select at least one item to return.');
      return;
    }

    setError('');
    setSubmitting(true);

    try {
      const res = await api<{ refundReceipt: ReceiptData }>('/sales/refund', {
        method: 'POST',
        json: {
          originalSaleId: sale.id,
          returnLines,
          refundTenderType: refundTender,
          supervisorPin: supervisorPin || undefined,
        },
      });

      onRefundCompleted(res.refundReceipt);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="glass modal animate-in"
        style={{ width: 'min(640px, 95vw)', maxHeight: '92vh', overflowY: 'auto', padding: '1.5rem' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.3rem', margin: 0, color: 'var(--warn)' }}>↩️ Customer Return & Refund</h2>
            <div className="muted" style={{ fontSize: '.8rem', marginTop: '.2rem' }}>
              Supermarket returns with receipt lookup, restock/spoilage selection, and SNAP compliance
            </div>
          </div>
          <button className="btn" style={{ padding: '.3rem .6rem' }} onClick={onClose} disabled={submitting}>✕</button>
        </div>

        {/* STEP 1: RECEIPT LOOKUP */}
        {!sale ? (
          <div style={{ display: 'grid', gap: '1.25rem', marginTop: '.5rem' }}>
            <form
              onSubmit={(e) => { e.preventDefault(); handleLookup(); }}
              style={{ display: 'flex', gap: '.6rem' }}
            >
              <input
                id="receipt-lookup-input"
                className="input mono"
                autoFocus
                placeholder="Scan receipt barcode or enter TX-... number"
                value={saleNumberInput}
                onChange={(e) => setSaleNumberInput(e.target.value)}
              />
              <button
                id="lookup-receipt-btn"
                className="btn btn-primary"
                type="submit"
                disabled={loading || !saleNumberInput.trim()}
              >
                {loading ? 'Searching...' : 'Find Receipt'}
              </button>
            </form>

            {/* Quick Demo Recent Sales Selection */}
            {recentSales.length > 0 && (
              <div>
                <span className="muted" style={{ fontSize: '.8rem' }}>Or select a recent completed supermarket ticket:</span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.5rem', marginTop: '.4rem' }}>
                  {recentSales.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className="btn"
                      style={{ fontSize: '.8rem', justifyContent: 'space-between', padding: '.5rem .8rem' }}
                      onClick={() => { setSaleNumberInput(s.saleNumber); handleLookup(s.saleNumber); }}
                    >
                      <span className="mono">{s.saleNumber}</span>
                      <span style={{ fontWeight: 700 }}>{formatCents(s.totalCents)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {error && <div className="error" style={{ textAlign: 'center' }}>{error}</div>}
          </div>
        ) : (
          /* STEP 2: SELECT ITEMS TO RETURN */
          <form onSubmit={submitRefund} style={{ display: 'grid', gap: '1.25rem', marginTop: '.5rem' }}>
            {/* Original Sale Header Info */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '.8rem 1rem',
                background: 'var(--surface)',
                borderRadius: 8,
                border: '1px solid var(--border)',
                fontSize: '.85rem',
              }}
            >
              <div>
                <div>Receipt: <b className="mono">{sale.saleNumber}</b></div>
                <div className="muted">{new Date(sale.completedAt).toLocaleString()}</div>
                {sale.customer && (
                  <div style={{ color: 'var(--brand)', fontWeight: 600, marginTop: '.2rem' }}>
                    ★ Member: {sale.customer.name} ({sale.customer.phone})
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '1.1rem', fontWeight: 800 }}>{formatCents(sale.totalCents)}</div>
                <div className="muted">
                  Paid via: {sale.payments.map((p) => p.tenderType.toUpperCase()).join(' + ')}
                </div>
                <button
                  type="button"
                  className="btn"
                  style={{ fontSize: '.75rem', padding: '.2rem .5rem', marginTop: '.3rem' }}
                  onClick={() => setSale(null)}
                >
                  Change Receipt
                </button>
              </div>
            </div>

            {/* Line items with return checkboxes & disposition */}
            <div style={{ display: 'grid', gap: '.6rem' }}>
              <div style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--muted)' }}>
                Select Item(s) to Return:
              </div>

              {sale.lines.map((l) => {
                const sel = lineSelections[l.id] || { selected: false, quantity: 1, reason: RETURN_REASONS[0], action: 'restock' };
                return (
                  <div
                    key={l.id}
                    style={{
                      padding: '.8rem 1rem',
                      borderRadius: 8,
                      background: sel.selected ? 'hsla(152, 68%, 46%, 0.08)' : 'var(--surface)',
                      border: sel.selected ? '1px solid var(--brand)' : '1px solid var(--border)',
                      display: 'grid',
                      gap: '.5rem',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '.6rem', cursor: 'pointer', margin: 0 }}>
                        <input
                          type="checkbox"
                          checked={sel.selected}
                          onChange={(e) =>
                            setLineSelections((prev) => ({
                              ...prev,
                              [l.id]: { ...sel, selected: e.target.checked },
                            }))
                          }
                        />
                        <span style={{ fontWeight: 700, fontSize: '.95rem' }}>{l.name}</span>
                        {l.snapEligible && <span className="badge badge-snap" style={{ fontSize: '.75rem' }}>SNAP</span>}
                      </label>

                      <div className="mono" style={{ fontWeight: 700 }}>
                        {formatCents(l.fixedTotalCents ?? l.unitPriceCents * (l.soldBy === 'weight' ? l.quantity / 1000 : l.quantity))}
                      </div>
                    </div>

                    {/* Return Details shown when item is checked */}
                    {sel.selected && (
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: l.soldBy === 'each' ? '120px 1fr 1fr' : '1fr 1fr',
                          gap: '.6rem',
                          paddingTop: '.5rem',
                          borderTop: '1px dashed var(--border)',
                          alignItems: 'end',
                        }}
                      >
                        {l.soldBy === 'each' && (
                          <label style={{ fontSize: '.8rem', margin: 0 }}>
                            Return Qty
                            <select
                              className="input"
                              style={{ padding: '.3rem' }}
                              value={sel.quantity}
                              onChange={(e) =>
                                setLineSelections((prev) => ({
                                  ...prev,
                                  [l.id]: { ...sel, quantity: parseInt(e.target.value) },
                                }))
                              }
                            >
                              {Array.from({ length: l.quantity }).map((_, i) => (
                                <option key={i + 1} value={i + 1}>
                                  {i + 1} of {l.quantity}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}

                        <label style={{ fontSize: '.8rem', margin: 0 }}>
                          Return Reason
                          <select
                            className="input"
                            style={{ padding: '.3rem' }}
                            value={sel.reason}
                            onChange={(e) =>
                              setLineSelections((prev) => ({
                                ...prev,
                                [l.id]: { ...sel, reason: e.target.value },
                              }))
                            }
                          >
                            {RETURN_REASONS.map((r) => (
                              <option key={r} value={r}>{r}</option>
                            ))}
                          </select>
                        </label>

                        <label style={{ fontSize: '.8rem', margin: 0 }}>
                          Inventory Disposition
                          <select
                            className="input"
                            style={{ padding: '.3rem' }}
                            value={sel.action}
                            onChange={(e) =>
                              setLineSelections((prev) => ({
                                ...prev,
                                [l.id]: { ...sel, action: e.target.value as any },
                              }))
                            }
                          >
                            <option value="restock">🔄 Restock to Shelf</option>
                            <option value="spoilage_writeoff">🗑️ Discard (Spoilage / Trash)</option>
                          </select>
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* STEP 3: REFUND TENDER & SUPERVISOR PIN */}
            <div
              style={{
                background: 'var(--surface)',
                padding: '1.25rem',
                borderRadius: 12,
                display: 'grid',
                gap: '1rem',
                border: '1px solid var(--border)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>TOTAL REFUND DUE:</span>
                <span className="mono" style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--warn)' }}>
                  {formatCents(estimatedRefundCents)}
                </span>
              </div>

              {/* Tender Selector */}
              <div>
                <label style={{ fontSize: '.85rem' }}>Refund Payment Method</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '.4rem', marginTop: '.3rem' }}>
                  <button
                    type="button"
                    className={`btn ${refundTender === 'cash' ? 'btn-primary' : ''}`}
                    onClick={() => setRefundTender('cash')}
                  >
                    💵 Cash (Till)
                  </button>
                  <button
                    type="button"
                    className={`btn ${refundTender === 'card' ? 'btn-primary' : ''}`}
                    onClick={() => setRefundTender('card')}
                  >
                    💳 Card Refund
                  </button>
                  <button
                    type="button"
                    className={`btn ${refundTender === 'ebt_snap' ? 'btn-primary' : ''}`}
                    onClick={() => setRefundTender('ebt_snap')}
                  >
                    🍎 EBT SNAP
                  </button>
                </div>
                {sale.snapPaidCents > 0 && refundTender === 'cash' && (
                  <div style={{ fontSize: '.78rem', color: 'var(--warn)', marginTop: '.4rem' }}>
                    ⚠️ Notice: Items paid with SNAP benefits cannot legally be refunded in cash (7 CFR 272.1).
                  </div>
                )}
              </div>

              {/* Supervisor PIN input for refunds */}
              <div>
                <label style={{ fontSize: '.85rem' }}>Supervisor Approval PIN (Demo: 2000 or 1000)</label>
                <input
                  id="refund-supervisor-pin"
                  className="input mono"
                  type="password"
                  maxLength={8}
                  placeholder="Enter 4-digit PIN (2000)"
                  value={supervisorPin}
                  onChange={(e) => setSupervisorPin(e.target.value)}
                />
              </div>
            </div>

            {error && <div className="error" style={{ textAlign: 'center' }}>{error}</div>}

            <div style={{ display: 'flex', gap: '.6rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={onClose} disabled={submitting}>Cancel</button>
              <button
                id="submit-refund-btn"
                type="submit"
                className="btn btn-primary btn-lg"
                disabled={submitting || estimatedRefundCents <= 0}
              >
                {submitting ? 'Processing Refund...' : `Approve & Refund ${formatCents(estimatedRefundCents)}`}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
