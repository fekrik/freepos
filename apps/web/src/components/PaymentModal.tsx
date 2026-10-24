import React, { useMemo, useState } from 'react';
import { formatCents, taxAfterSnap, type CartLine, type CartTotals, type Cents } from '@freshpos/shared';

export interface PaymentTender {
  tenderType: 'cash' | 'card' | 'ebt_snap' | 'ebt_cash';
  amountCents: Cents;
  tenderedCents?: Cents;
  changeCents?: Cents;
  cardBrand?: string;
  last4?: string;
  authCode?: string;
}

interface Props {
  lines: CartLine[];
  baseTotals: CartTotals;
  onClose: () => void;
  onFinalize: (payments: PaymentTender[]) => Promise<void>;
}

export function PaymentModal({ lines, baseTotals, onClose, onFinalize }: Props) {
  const [tenders, setTenders] = useState<PaymentTender[]>([]);
  const [activeTab, setActiveTab] = useState<'cash' | 'card' | 'ebt_snap'>('cash');
  const [cashInput, setCashInput] = useState('');
  const [cardProcessing, setCardProcessing] = useState(false);
  const [ebtPin, setEbtPin] = useState('');
  const [ebtStep, setEbtStep] = useState<'amount' | 'pin'>('amount');
  const [ebtAmount, setEbtAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Calculate adjusted tax based on accumulated EBT SNAP tenders
  const snapPaidSoFar = tenders
    .filter((t) => t.tenderType === 'ebt_snap')
    .reduce((s, t) => s + t.amountCents, 0);

  const effectiveTax = taxAfterSnap(lines, snapPaidSoFar);
  const currentTotal = baseTotals.subtotal - baseTotals.discounts + baseTotals.deposits + effectiveTax;

  const totalPaidSoFar = tenders.reduce((s, t) => s + t.amountCents, 0);
  const balanceRemaining = Math.max(0, currentTotal - totalPaidSoFar);

  const snapRemainingEligible = Math.max(0, baseTotals.snapEligibleTotal - snapPaidSoFar);

  // Quick cash bill suggestions
  const nextDollar = Math.ceil(balanceRemaining / 100) * 100;
  const quickCashOptions = useMemo(() => {
    const list = [balanceRemaining];
    if (nextDollar > balanceRemaining && !list.includes(nextDollar)) list.push(nextDollar);
    [500, 1000, 2000, 5000, 10000].forEach((amt) => {
      if (amt > balanceRemaining && !list.includes(amt)) list.push(amt);
    });
    return list.slice(0, 5);
  }, [balanceRemaining, nextDollar]);

  async function applyTender(tender: PaymentTender) {
    const newTenders = [...tenders, tender];
    setTenders(newTenders);

    // Recompute total with this tender included
    const newSnap = newTenders
      .filter((t) => t.tenderType === 'ebt_snap')
      .reduce((s, t) => s + t.amountCents, 0);
    const newTax = taxAfterSnap(lines, newSnap);
    const newTotal = baseTotals.subtotal - baseTotals.discounts + baseTotals.deposits + newTax;
    const newTotalPaid = newTenders.reduce((s, t) => s + t.amountCents, 0);

    if (newTotalPaid >= newTotal) {
      setSubmitting(true);
      setError('');
      try {
        await onFinalize(newTenders);
      } catch (e) {
        setError((e as Error).message);
        setSubmitting(false);
      }
    }
  }

  function handleCashSubmit(amountToTenderCents: number) {
    if (amountToTenderCents <= 0) return;
    const tenderAmount = Math.min(amountToTenderCents, balanceRemaining);
    const change = Math.max(0, amountToTenderCents - balanceRemaining);
    applyTender({
      tenderType: 'cash',
      amountCents: tenderAmount,
      tenderedCents: amountToTenderCents,
      changeCents: change,
    });
  }

  function handleCardSimulation() {
    setCardProcessing(true);
    setError('');
    setTimeout(() => {
      setCardProcessing(false);
      applyTender({
        tenderType: 'card',
        amountCents: balanceRemaining,
        cardBrand: 'Visa',
        last4: '4242',
        authCode: `AUTH-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
      });
    }, 1200);
  }

  function handleEbtSubmit() {
    const centsToPay = ebtAmount ? Math.round(parseFloat(ebtAmount) * 100) : snapRemainingEligible;
    const finalAmount = Math.min(centsToPay, balanceRemaining, snapRemainingEligible);
    if (finalAmount <= 0) {
      setError('No remaining SNAP eligible balance on ticket.');
      return;
    }
    setEbtStep('amount');
    setEbtPin('');
    setEbtAmount('');
    applyTender({
      tenderType: 'ebt_snap',
      amountCents: finalAmount,
      authCode: `SNAP-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
    });
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="glass modal animate-in" style={{ width: 'min(580px, 95vw)', padding: '1.75rem' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '1.4rem' }}>Tender Payment</h2>
          <button className="btn" style={{ padding: '.4rem .8rem', fontSize: '.85rem' }} onClick={onClose} disabled={submitting}>
            Cancel
          </button>
        </div>

        {/* Dynamic balance summary */}
        <div className="glass" style={{ padding: '1rem 1.25rem', background: 'hsl(160 14% 12% / .8)', display: 'grid', gap: '.4rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.9rem', color: 'var(--muted)' }}>
            <span>Order Total</span>
            <span className="mono">{formatCents(currentTotal)}</span>
          </div>
          {snapPaidSoFar > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.8rem', color: 'var(--snap)' }}>
              <span>SNAP Tax Forgiveness Applied</span>
              <span>- {formatCents(baseTotals.tax - effectiveTax)} tax saved</span>
            </div>
          )}
          {tenders.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.9rem', color: 'var(--muted)' }}>
              <span>Tendered ({tenders.length})</span>
              <span className="mono">{formatCents(totalPaidSoFar)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.5rem', fontWeight: 700, paddingTop: '.4rem', borderTop: '1px solid var(--border)' }}>
            <span>Balance Due</span>
            <span className="mono" style={{ color: 'var(--brand)' }}>{formatCents(balanceRemaining)}</span>
          </div>
        </div>

        {/* Existing partial tenders list */}
        {tenders.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem' }}>
            {tenders.map((t, idx) => (
              <span key={idx} className="badge badge-muted" style={{ padding: '.4rem .7rem', fontSize: '.8rem' }}>
                ✓ {t.tenderType.toUpperCase()}: {formatCents(t.amountCents)}
                {t.changeCents ? ` (Change: ${formatCents(t.changeCents)})` : ''}
              </span>
            ))}
          </div>
        )}

        {/* Tender method selector tabs */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '.5rem' }}>
          <button
            type="button"
            className={`btn ${activeTab === 'cash' ? 'btn-primary' : ''}`}
            onClick={() => setActiveTab('cash')}
            disabled={submitting}
          >
            💵 Cash
          </button>
          <button
            type="button"
            className={`btn ${activeTab === 'card' ? 'btn-primary' : ''}`}
            onClick={() => setActiveTab('card')}
            disabled={submitting}
          >
            💳 Stripe Terminal
          </button>
          <button
            type="button"
            className={`btn ${activeTab === 'ebt_snap' ? 'btn-primary' : ''}`}
            onClick={() => setActiveTab('ebt_snap')}
            disabled={submitting}
          >
            🍎 EBT SNAP
          </button>
        </div>

        {/* CASH TAB */}
        {activeTab === 'cash' && (
          <div style={{ display: 'grid', gap: '.85rem' }}>
            <span className="muted" style={{ fontSize: '.85rem' }}>Quick cash bill options:</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: '.5rem' }}>
              {quickCashOptions.map((cents) => (
                <button
                  key={cents}
                  type="button"
                  className="btn"
                  style={{ fontSize: '1.05rem', padding: '.8rem' }}
                  onClick={() => handleCashSubmit(cents)}
                  disabled={submitting}
                >
                  {formatCents(cents)}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginTop: '.3rem' }}>
              <input
                className="input mono"
                placeholder="Custom cash amount ($)"
                inputMode="decimal"
                value={cashInput}
                onChange={(e) => setCashInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const val = parseFloat(cashInput);
                    if (val > 0) handleCashSubmit(Math.round(val * 100));
                  }
                }}
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const val = parseFloat(cashInput);
                  if (val > 0) handleCashSubmit(Math.round(val * 100));
                }}
                disabled={submitting || !parseFloat(cashInput)}
              >
                Tender
              </button>
            </div>
          </div>
        )}

        {/* CARD TAB */}
        {activeTab === 'card' && (
          <div className="glass" style={{ padding: '1.5rem', textAlign: 'center', display: 'grid', gap: '1rem', background: 'hsl(160 14% 10% / .5)' }}>
            <div style={{ fontSize: '2.5rem' }}>💳</div>
            <div>
              <h3 style={{ fontSize: '1.1rem', marginBottom: '.3rem' }}>Stripe Terminal Reader</h3>
              <p className="muted" style={{ margin: 0, fontSize: '.9rem' }}>
                {cardProcessing
                  ? 'Connecting to EMV reader & processing card authorization...'
                  : `Waiting for customer to tap, insert, or swipe card for ${formatCents(balanceRemaining)}`}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={handleCardSimulation}
              disabled={cardProcessing || submitting}
            >
              {cardProcessing ? 'Authorizing Payment...' : `Simulate Card Tap (${formatCents(balanceRemaining)})`}
            </button>
          </div>
        )}

        {/* EBT SNAP TAB */}
        {activeTab === 'ebt_snap' && (
          <div style={{ display: 'grid', gap: '1rem' }}>
            <div className="glass" style={{ padding: '1rem', background: 'hsl(212 90% 64% / .08)', border: '1px solid hsl(212 90% 64% / .3)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--snap)', fontWeight: 600 }}>
                <span>Eligible SNAP Food Items</span>
                <span className="mono">{formatCents(snapRemainingEligible)}</span>
              </div>
              <span className="muted" style={{ fontSize: '.8rem', display: 'block', marginTop: '.3rem' }}>
                Per federal law (7 CFR 272.1), sales tax on items paid with SNAP benefits is waived.
              </span>
            </div>

            {ebtStep === 'amount' ? (
              <div style={{ display: 'grid', gap: '.75rem' }}>
                <div style={{ display: 'flex', gap: '.5rem' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ flex: 1 }}
                    onClick={() => {
                      setEbtAmount((snapRemainingEligible / 100).toFixed(2));
                      setEbtStep('pin');
                    }}
                    disabled={snapRemainingEligible <= 0 || submitting}
                  >
                    Pay Max SNAP: {formatCents(Math.min(balanceRemaining, snapRemainingEligible))}
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '.5rem' }}>
                  <input
                    className="input mono"
                    placeholder="Partial SNAP amount ($)"
                    inputMode="decimal"
                    value={ebtAmount}
                    onChange={(e) => setEbtAmount(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setEbtStep('pin')}
                    disabled={!parseFloat(ebtAmount) || submitting}
                  >
                    Next (PIN)
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '.75rem', textAlign: 'center' }}>
                <span className="muted" style={{ fontSize: '.9rem' }}>Customer PIN Pad Simulator:</span>
                <div className="pin-dots">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className={`pin-dot ${i < ebtPin.length ? 'filled' : ''}`} />
                  ))}
                </div>
                <div className="pin-pad" style={{ maxWidth: 260, margin: '0 auto' }}>
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'].map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={`btn ${k === '✓' ? 'btn-primary' : ''}`}
                      onClick={() => {
                        if (k === '⌫') setEbtPin((p) => p.slice(0, -1));
                        else if (k === '✓') {
                          if (ebtPin.length >= 4) handleEbtSubmit();
                        } else {
                          setEbtPin((p) => (p + k).slice(0, 4));
                        }
                      }}
                    >
                      {k}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn"
                  style={{ fontSize: '.8rem' }}
                  onClick={() => { setEbtStep('amount'); setEbtPin(''); }}
                >
                  ← Back to Amount
                </button>
              </div>
            )}
          </div>
        )}

        {error && <div className="error" style={{ textAlign: 'center' }}>{error}</div>}
      </div>
    </div>
  );
}
