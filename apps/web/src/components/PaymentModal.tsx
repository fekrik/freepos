import React, { useEffect, useMemo, useState } from 'react';
import { formatCents, taxAfterSnap, type CartLine, type CartTotals, type Cents } from '@freshpos/shared';
import { api } from '../api';

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

interface TerminalStatus {
  configured: boolean;
  mode: 'stripe' | 'simulated_fallback' | 'stripe_error';
  message?: string;
  error?: string;
  reader?: {
    id: string;
    label: string;
    status: string;
    deviceType: string;
    ipAddress?: string;
  };
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

  // Terminal state
  const [terminalStatus, setTerminalStatus] = useState<TerminalStatus | null>(null);
  const [terminalLoading, setTerminalLoading] = useState(false);
  const [activePaymentIntentId, setActivePaymentIntentId] = useState<string | null>(null);
  const [activeReaderId, setActiveReaderId] = useState<string | null>(null);
  const [collectingCard, setCollectingCard] = useState(false);
  const [pollingTimer, setPollingTimer] = useState<NodeJS.Timeout | null>(null);

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

  // Load terminal status when opening card tab
  useEffect(() => {
    if (activeTab === 'card' && !terminalStatus) {
      setTerminalLoading(true);
      api<TerminalStatus>('/terminal/status')
        .then(setTerminalStatus)
        .catch(() => {
          setTerminalStatus({
            configured: false,
            mode: 'simulated_fallback',
            reader: {
              id: 'simulated-reader-demo',
              label: 'Simulated WisePOS E (Local)',
              status: 'online',
              deviceType: 'simulated_wisepos_e',
            },
          });
        })
        .finally(() => setTerminalLoading(false));
    }
  }, [activeTab, terminalStatus]);

  // Cleanup polling timer
  useEffect(() => {
    return () => {
      if (pollingTimer) clearInterval(pollingTimer);
    };
  }, [pollingTimer]);

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

  async function handleStartTerminalPayment() {
    setError('');
    setCardProcessing(true);

    if (!terminalStatus?.configured) {
      // In simulated fallback mode (no STRIPE_SECRET_KEY set yet)
      setTimeout(() => {
        setCardProcessing(false);
        applyTender({
          tenderType: 'card',
          amountCents: balanceRemaining,
          cardBrand: 'Visa',
          last4: '4242',
          authCode: `AUTH-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
        });
      }, 1000);
      return;
    }

    try {
      // 1. Create PaymentIntent on server and send to Reader
      const res = await api<{
        mode: string;
        paymentIntentId: string;
        readerId: string;
        status: string;
      }>('/terminal/create-payment-intent', {
        method: 'POST',
        json: { amountCents: balanceRemaining },
      });

      setActivePaymentIntentId(res.paymentIntentId);
      setActiveReaderId(res.readerId);
      setCollectingCard(true);

      // Start polling status
      const poll = setInterval(async () => {
        try {
          const status = await api<{
            status: string;
            cardBrand: string;
            last4: string;
            authCode: string;
          }>(`/terminal/payment-status/${res.paymentIntentId}`);

          if (status.status === 'succeeded') {
            clearInterval(poll);
            setCollectingCard(false);
            setCardProcessing(false);
            applyTender({
              tenderType: 'card',
              amountCents: balanceRemaining,
              cardBrand: status.cardBrand || 'Visa',
              last4: status.last4 || '4242',
              authCode: status.authCode,
            });
          }
        } catch (err) {
          clearInterval(poll);
          setCollectingCard(false);
          setCardProcessing(false);
          setError((err as Error).message);
        }
      }, 1500);

      setPollingTimer(poll);
    } catch (err) {
      setCardProcessing(false);
      setError((err as Error).message);
    }
  }

  async function handleSimulateCustomerTap() {
    if (!activeReaderId || !activePaymentIntentId) return;
    try {
      setCardProcessing(true);
      const res = await api<{
        status: string;
        cardBrand: string;
        last4: string;
        authCode: string;
      }>('/terminal/simulate-card', {
        method: 'POST',
        json: {
          readerId: activeReaderId,
          paymentIntentId: activePaymentIntentId,
        },
      });

      if (res.status === 'succeeded') {
        if (pollingTimer) clearInterval(pollingTimer);
        setCollectingCard(false);
        setCardProcessing(false);
        applyTender({
          tenderType: 'card',
          amountCents: balanceRemaining,
          cardBrand: res.cardBrand || 'Visa',
          last4: res.last4 || '4242',
          authCode: res.authCode,
        });
      }
    } catch (err) {
      setError((err as Error).message);
      setCardProcessing(false);
    }
  }

  async function handleCancelTerminal() {
    if (pollingTimer) clearInterval(pollingTimer);
    setCollectingCard(false);
    setCardProcessing(false);
    if (activeReaderId || activePaymentIntentId) {
      api('/terminal/cancel', {
        method: 'POST',
        json: { readerId: activeReaderId, paymentIntentId: activePaymentIntentId },
      }).catch(() => {});
    }
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
            disabled={submitting || cardProcessing}
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
            disabled={submitting || cardProcessing}
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

        {/* CARD TAB (STRIPE TERMINAL SERVER-DRIVEN) */}
        {activeTab === 'card' && (
          <div className="glass" style={{ padding: '1.5rem', textAlign: 'center', display: 'grid', gap: '1rem', background: 'hsl(160 14% 10% / .5)' }}>
            {/* Terminal Reader Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '.6rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                <span style={{ fontSize: '1.3rem' }}>💳</span>
                <div style={{ textAlign: 'left' }}>
                  <div style={{ fontWeight: 600, fontSize: '.9rem' }}>
                    {terminalStatus?.reader?.label || 'Stripe Terminal Reader'}
                  </div>
                  <div className="muted" style={{ fontSize: '.75rem' }}>
                    {terminalStatus?.configured ? 'Cloud Server-Driven Reader' : 'Local Reader Simulation'}
                  </div>
                </div>
              </div>

              <span
                className="badge"
                style={{
                  background: terminalStatus?.configured ? 'hsla(152, 68%, 46%, 0.15)' : 'hsla(38, 92%, 50%, 0.15)',
                  color: terminalStatus?.configured ? 'var(--brand)' : 'var(--warn)',
                  fontWeight: 600,
                  fontSize: '.75rem',
                }}
              >
                {terminalLoading
                  ? 'Connecting...'
                  : terminalStatus?.configured
                  ? '● Stripe Live / Test'
                  : '⚡ Fallback Mode'}
              </span>
            </div>

            {/* Reader State Box */}
            <div style={{ padding: '1.25rem 0', display: 'grid', gap: '.6rem' }}>
              <div style={{ fontSize: '2.4rem' }}>
                {collectingCard ? '📲' : '💳'}
              </div>

              <div>
                <h3 style={{ fontSize: '1.15rem', margin: '0 0 .3rem 0' }}>
                  {collectingCard
                    ? `Waiting for Customer Card (${formatCents(balanceRemaining)})`
                    : cardProcessing
                    ? 'Processing Payment Intent...'
                    : `Charge ${formatCents(balanceRemaining)} on Card`}
                </h3>
                <p className="muted" style={{ margin: 0, fontSize: '.88rem' }}>
                  {collectingCard
                    ? 'Reader display is active. Customer is prompted to Tap, Insert, or Swipe card.'
                    : cardProcessing
                    ? 'Creating terminal payment intent & waking reader...'
                    : 'Customer taps Apple Pay / Google Pay, inserts EMV chip, or swipes card.'}
                </p>
              </div>
            </div>

            {/* Actions */}
            {!collectingCard ? (
              <div style={{ display: 'grid', gap: '.6rem' }}>
                <button
                  type="button"
                  className="btn btn-primary btn-lg"
                  onClick={handleStartTerminalPayment}
                  disabled={cardProcessing || submitting || balanceRemaining <= 0}
                  style={{ padding: '.85rem 1rem', fontWeight: 700, fontSize: '1.05rem' }}
                >
                  {cardProcessing ? 'Communicating with Terminal...' : `Charge Card (${formatCents(balanceRemaining)})`}
                </button>

                {!terminalStatus?.configured && (
                  <div className="muted" style={{ fontSize: '.8rem', background: 'hsla(0, 0%, 100%, 0.03)', padding: '.5rem', borderRadius: 6 }}>
                    💡 <em>To test with live Stripe Test cards, set <code>STRIPE_SECRET_KEY=sk_test_...</code> in your environment.</em>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '.6rem' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleSimulateCustomerTap}
                  disabled={cardProcessing || submitting}
                  style={{ padding: '.75rem 1rem', fontWeight: 700 }}
                >
                  💳 Simulate Customer Tap (Test Card)
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={handleCancelTerminal}
                  style={{ fontSize: '.85rem' }}
                >
                  Cancel Reader Prompt
                </button>
              </div>
            )}
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

        {error && <div className="error" style={{ textAlign: 'center', marginTop: '.5rem' }}>⚠️ {error}</div>}
      </div>
    </div>
  );
}
