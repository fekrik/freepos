import React, { useState } from 'react';
import { api } from '../api';
import { formatCents, type Cents } from '@freshpos/shared';

export type OverrideType = 'price_override' | 'line_discount' | 'void_transaction';

interface Props {
  type: OverrideType;
  itemName?: string;
  currentPriceCents?: Cents;
  onClose: () => void;
  onApproved: (result: { newPriceCents?: Cents; discountCents?: Cents; reason: string; supervisorName: string }) => void;
}

const REASONS: Record<OverrideType, string[]> = {
  price_override: [
    'Damaged / Bruised Item',
    'Shelf Tag Mismatch',
    'Competitor Price Match',
    'Customer Satisfaction / Goodwill',
    'Manager Discretion',
  ],
  line_discount: [
    'Senior Citizen Discount (10%)',
    'Employee Discount (15%)',
    'Near Expiry Discount',
    'Manager Discretion',
  ],
  void_transaction: [
    'Customer Changed Mind',
    'Left Wallet / Cannot Pay',
    'Duplicate Ring / Cashier Error',
    'Suspicious / Refused Transaction',
  ],
};

export function SupervisorOverrideModal({ type, itemName, currentPriceCents, onClose, onApproved }: Props) {
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState(REASONS[type][0]);
  const [newPrice, setNewPrice] = useState('');
  const [discountPercent, setDiscountPercent] = useState('10');
  const [customDiscountDollars, setCustomDiscountDollars] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const title =
    type === 'price_override'
      ? 'Supervisor Price Override'
      : type === 'line_discount'
      ? 'Supervisor Line Discount'
      : 'Supervisor Void Ticket Approval';

  const requiredPermission =
    type === 'price_override'
      ? 'sale.price_override'
      : type === 'line_discount'
      ? 'sale.discount'
      : 'sale.void_transaction';

  async function submit() {
    if (pin.length < 4) {
      setError('Please enter a 4-digit supervisor PIN.');
      return;
    }
    setError('');
    setSubmitting(true);

    try {
      const res = await api<{ approved: boolean; supervisor: { name: string }; reason: string }>(
        '/auth/supervisor-authorize',
        {
          method: 'POST',
          json: {
            pin,
            permission: requiredPermission,
            reason,
            details: {
              type,
              itemName,
              currentPriceCents,
              newPriceInput: newPrice,
            },
          },
        },
      );

      let newPriceCents: Cents | undefined;
      let discountCents: Cents | undefined;

      if (type === 'price_override') {
        const p = parseFloat(newPrice);
        if (!(p >= 0)) throw new Error('Please enter a valid override price.');
        newPriceCents = Math.round(p * 100);
      } else if (type === 'line_discount') {
        if (customDiscountDollars) {
          discountCents = Math.round(parseFloat(customDiscountDollars) * 100);
        } else if (currentPriceCents) {
          const pct = parseFloat(discountPercent) || 0;
          discountCents = Math.round((currentPriceCents * pct) / 100);
        }
      }

      onApproved({
        newPriceCents,
        discountCents,
        reason,
        supervisorName: res.supervisor.name,
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="glass modal animate-in" style={{ width: 'min(460px, 94vw)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '1.25rem', color: 'var(--warn)' }}>🔒 {title}</h2>
          <button className="btn" style={{ padding: '.3rem .6rem' }} onClick={onClose} disabled={submitting}>✕</button>
        </div>

        {itemName && (
          <div style={{ fontSize: '.9rem', color: 'var(--muted)' }}>
            Item: <b style={{ color: 'var(--text)' }}>{itemName}</b>
            {currentPriceCents !== undefined && ` (${formatCents(currentPriceCents)})`}
          </div>
        )}

        {/* Action-specific inputs */}
        {type === 'price_override' && (
          <label>
            New Price ($)
            <input
              id="override-new-price"
              className="input mono"
              autoFocus
              inputMode="decimal"
              placeholder="0.00"
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
            />
          </label>
        )}

        {type === 'line_discount' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.6rem' }}>
            <label>
              Percent Off (%)
              <select className="input" value={discountPercent} onChange={(e) => { setDiscountPercent(e.target.value); setCustomDiscountDollars(''); }}>
                <option value="10">10% Off</option>
                <option value="15">15% Off</option>
                <option value="20">20% Off</option>
                <option value="25">25% Off</option>
                <option value="50">50% Off</option>
              </select>
            </label>
            <label>
              Or Fixed Amount ($)
              <input
                className="input mono"
                placeholder="$ Off"
                value={customDiscountDollars}
                onChange={(e) => { setCustomDiscountDollars(e.target.value); setDiscountPercent(''); }}
              />
            </label>
          </div>
        )}

        <label>
          Reason Code (Audited)
          <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS[type].map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </label>

        {/* Supervisor PIN entry */}
        <div style={{ display: 'grid', gap: '.5rem', textAlign: 'center', marginTop: '.3rem' }}>
          <span className="muted" style={{ fontSize: '.85rem' }}>Enter Supervisor / Admin PIN (Demo: 2000 or 1000):</span>
          <div className="pin-dots">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={`pin-dot ${i < pin.length ? 'filled' : ''}`} />
            ))}
          </div>

          <div className="pin-pad" style={{ maxWidth: 260, margin: '0 auto' }}>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'].map((k) => (
              <button
                key={k}
                type="button"
                className={`btn ${k === '✓' ? 'btn-primary' : ''}`}
                disabled={submitting}
                onClick={() => {
                  if (k === '⌫') setPin((p) => p.slice(0, -1));
                  else if (k === '✓') submit();
                  else setPin((p) => (p + k).slice(0, 8));
                }}
              >
                {k}
              </button>
            ))}
          </div>
        </div>

        {error && <div className="error" style={{ textAlign: 'center' }}>{error}</div>}

        <div style={{ display: 'flex', gap: '.6rem', justifyContent: 'flex-end', marginTop: '.4rem' }}>
          <button type="button" className="btn" onClick={onClose} disabled={submitting}>Cancel</button>
          <button id="override-approve-btn" type="button" className="btn btn-primary" onClick={submit} disabled={submitting}>
            {submitting ? 'Verifying...' : 'Approve Override'}
          </button>
        </div>
      </div>
    </div>
  );
}
