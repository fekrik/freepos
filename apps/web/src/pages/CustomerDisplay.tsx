import React, { useEffect, useRef, useState } from 'react';
import { formatCents } from '@freshpos/shared';
import { subscribeCFD, type CFDState } from '../cfd';

export function CustomerDisplay() {
  const [cfdState, setCfdState] = useState<CFDState>({
    type: 'idle',
    storeName: 'Fresh Market Supermarket',
    registerName: 'Lane 1',
  });
  const [clock, setClock] = useState(
    new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  );
  const [flashLastScanned, setFlashLastScanned] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Digital live clock
  useEffect(() => {
    const timer = setInterval(() => {
      setClock(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Listen to lane broadcasts
  useEffect(() => {
    const unsubscribe = subscribeCFD((state) => {
      setCfdState(state);
      if (state.type === 'cart' && state.lastScanned) {
        setFlashLastScanned(true);
        setTimeout(() => setFlashLastScanned(false), 800);
      }
    });
    return unsubscribe;
  }, []);

  // Auto-scroll cart lines to bottom when items are scanned
  useEffect(() => {
    if (cfdState.type === 'cart' && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [cfdState]);

  const storeName = 'storeName' in cfdState ? cfdState.storeName : 'Fresh Market';
  const registerName = 'registerName' in cfdState ? cfdState.registerName : 'Lane 1';

  return (
    <div className="cfd-container">
      {/* Top Header Bar */}
      <header className="cfd-header">
        <div className="cfd-brand">
          <div className="cfd-brand-logo">F</div>
          <div>
            <div className="cfd-store-name">{storeName}</div>
            <div className="muted cfd-reg-name">{registerName} · Customer Display</div>
          </div>
        </div>

        {/* Loyalty Greeting or Live Clock */}
        <div className="cfd-header-right">
          {cfdState.type === 'cart' && cfdState.customer && (
            <div className="cfd-loyalty-chip">
              <span className="cfd-loyalty-star">★ REWARDS</span>
              <span className="cfd-loyalty-name">{cfdState.customer.name}</span>
              <span className="muted" style={{ fontSize: '.8rem' }}>({cfdState.customer.points} pts)</span>
              {cfdState.customer.earnedPoints !== undefined && cfdState.customer.earnedPoints > 0 && (
                <span className="badge badge-snap" style={{ fontSize: '.75rem' }}>
                  +{cfdState.customer.earnedPoints} pts
                </span>
              )}
            </div>
          )}

          <div className="mono cfd-clock">{clock}</div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="cfd-main">
        {/* STATE 1: IDLE / WELCOME SCREEN */}
        {cfdState.type === 'idle' && (
          <div className="cfd-idle">
            <div className="animate-in cfd-idle-hero">
              <div className="cfd-idle-badge">✓ Cashier Lane Open & Ready</div>
              <h1 className="cfd-idle-title">
                Welcome to <span className="cfd-gradient-text">Fresh Market</span>
              </h1>
              <p className="muted cfd-idle-sub">
                Scan items with your cashier to begin checkout. Have your Fresh Rewards phone number or digital member card ready.
              </p>
            </div>

            {/* Grocery Deals Showcase Carousel Cards */}
            <div className="cfd-deals-grid">
              <div className="glass cfd-deal-card cfd-deal-featured">
                <div className="cfd-deal-icon">🥑</div>
                <div className="cfd-deal-name">Hass Avocados</div>
                <div className="cfd-deal-price">2 for $2.00</div>
                <div className="muted cfd-deal-sub">Regular $1.29 each · Save $0.58</div>
              </div>

              <div className="glass cfd-deal-card">
                <div className="cfd-deal-icon">🥤</div>
                <div className="cfd-deal-name">Classic Cola 12pk</div>
                <div className="cfd-deal-price">3 for $18.00</div>
                <div className="muted cfd-deal-sub">Stock up & save $4.47</div>
              </div>

              <div className="glass cfd-deal-card">
                <div className="cfd-deal-icon">🍞</div>
                <div className="cfd-deal-name">Artisan Bakery</div>
                <div className="cfd-deal-price">Buy 2 Get 1 Free</div>
                <div className="muted cfd-deal-sub">Freshly baked this morning</div>
              </div>

              <div className="glass cfd-deal-card">
                <div className="cfd-deal-icon">💳</div>
                <div className="cfd-deal-name">Payment Methods</div>
                <div className="cfd-deal-price cfd-snap-text">EBT SNAP Ready</div>
                <div className="muted cfd-deal-sub">Apple Pay, Google Pay, Chips</div>
              </div>
            </div>
          </div>
        )}

        {/* STATE 2: ACTIVE SCANNING CART STATE */}
        {cfdState.type === 'cart' && (
          <div className="cfd-cart-layout">
            {/* Left Column: Running Itemized Cart Lines */}
            <div className="cfd-cart-column">
              <div className="cfd-cart-header">
                <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>Your Grocery Cart</div>
                <div className="muted" style={{ fontSize: '.88rem' }}>
                  {cfdState.totals.itemCount} {cfdState.totals.itemCount === 1 ? 'item' : 'items'}
                </div>
              </div>

              <div ref={scrollRef} className="cfd-cart-list">
                {cfdState.lines.map((l) => (
                  <div key={l.id} className="cfd-cart-item">
                    <div style={{ flex: 1 }}>
                      <div className="cfd-item-name-row">
                        <span>{l.name}</span>
                        {l.snapEligible && <span className="badge badge-snap" style={{ fontSize: '.75rem' }}>SNAP</span>}
                        {l.isOverridden && (
                          <span className="badge badge-age" style={{ fontSize: '.75rem' }}>
                            PRICE ADJUSTED
                          </span>
                        )}
                        {l.promoName && (
                          <span className="badge badge-snap" style={{ fontSize: '.75rem' }}>
                            {l.promoName}
                          </span>
                        )}
                      </div>
                      <div className="muted cfd-item-meta">
                        {l.fixedTotal !== undefined
                          ? 'Priced item'
                          : l.soldBy === 'weight'
                          ? `${(l.quantity / 1000).toFixed(3)} lb @ ${formatCents(l.unitPrice)}/lb`
                          : `${l.quantity} × ${formatCents(l.unitPrice)}`}
                        {l.depositPerUnit ? ` (+${formatCents(l.depositPerUnit * l.quantity)} deposit)` : ''}
                      </div>
                    </div>

                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div className="mono cfd-item-price">
                        {formatCents(l.lineTotal)}
                      </div>
                      {l.discount && l.discount > 0 ? (
                        <div className="cfd-item-discount">
                          Save {formatCents(l.discount)}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Column: Hero Showcase + Total Due */}
            <div className="cfd-summary-column">
              {/* Last Scanned Item Hero Card */}
              {cfdState.lastScanned && (
                <div className={`glass cfd-last-scanned ${flashLastScanned ? 'flashing' : ''}`}>
                  <div className="cfd-last-scanned-badge">✦ Just Scanned</div>
                  <div className="cfd-last-scanned-name">{cfdState.lastScanned.name}</div>
                  <div className="cfd-last-scanned-row">
                    <span className="muted" style={{ fontSize: '1rem' }}>{cfdState.lastScanned.quantityStr}</span>
                    <span className="mono cfd-last-scanned-price">
                      {cfdState.lastScanned.priceStr}
                    </span>
                  </div>
                  {cfdState.lastScanned.promoDiscount && (
                    <div className="cfd-last-scanned-promo">{cfdState.lastScanned.promoDiscount}</div>
                  )}
                </div>
              )}

              {/* Savings Banner */}
              {cfdState.totals.discounts > 0 && (
                <div className="cfd-savings-banner">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
                    <span style={{ fontSize: '1.4rem' }}>🎉</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '.95rem', color: 'var(--brand)' }}>Total Store Savings</div>
                      <div className="muted" style={{ fontSize: '.78rem' }}>Multi-buy deals & rewards applied</div>
                    </div>
                  </div>
                  <div className="mono" style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--brand)' }}>
                    -{formatCents(cfdState.totals.discounts)}
                  </div>
                </div>
              )}

              {/* Order Summary & Grand Total */}
              <div className="glass cfd-totals-card">
                <div className="cfd-total-row">
                  <span>Subtotal</span>
                  <span className="mono">{formatCents(cfdState.totals.subtotal)}</span>
                </div>

                {cfdState.totals.deposits > 0 && (
                  <div className="cfd-total-row">
                    <span>Bottle Deposits</span>
                    <span className="mono">{formatCents(cfdState.totals.deposits)}</span>
                  </div>
                )}

                <div className="cfd-total-row">
                  <span>Sales Tax</span>
                  <span className="mono">{formatCents(cfdState.totals.tax)}</span>
                </div>

                {cfdState.totals.snapEligibleTotal > 0 && (
                  <div className="cfd-total-row cfd-snap-row">
                    <span>SNAP Food Eligible</span>
                    <span className="mono">{formatCents(cfdState.totals.snapEligibleTotal)}</span>
                  </div>
                )}

                <div className="cfd-grand-row">
                  <span className="cfd-grand-label">TOTAL DUE</span>
                  <span id="cfd-grand-total" className="mono cfd-grand-total">
                    {formatCents(cfdState.totals.total)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STATE 3: PAYMENT IN PROGRESS */}
        {cfdState.type === 'payment' && (
          <div className="cfd-modal-container">
            <div className="glass animate-in cfd-payment-card">
              <div style={{ fontSize: '3.2rem', marginBottom: '.8rem' }}>💳</div>
              <h2 style={{ fontSize: '1.85rem', fontWeight: 800, margin: '0 0 .5rem 0' }}>Processing Payment</h2>
              <p className="muted" style={{ fontSize: '1.05rem', margin: '0 0 1.75rem 0' }}>
                Please tap card, insert chip, or enter EBT PIN on the pin pad
              </p>

              <div className="cfd-payment-breakdown">
                <div className="cfd-breakdown-row">
                  <span className="muted">Method</span>
                  <span style={{ fontWeight: 700, textTransform: 'uppercase' }}>{cfdState.tenderType}</span>
                </div>
                <div className="cfd-breakdown-row">
                  <span className="muted">Total Due</span>
                  <span className="mono" style={{ fontWeight: 700 }}>{formatCents(cfdState.totalDue)}</span>
                </div>
                {cfdState.amountPaid > 0 && (
                  <div className="cfd-breakdown-row" style={{ color: 'var(--brand)' }}>
                    <span>Amount Paid</span>
                    <span className="mono" style={{ fontWeight: 700 }}>{formatCents(cfdState.amountPaid)}</span>
                  </div>
                )}
                <div className="cfd-breakdown-row cfd-breakdown-due">
                  <span>Remaining</span>
                  <span className="mono" style={{ color: 'var(--warn)' }}>{formatCents(cfdState.remainingDue)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STATE 4: SALE COMPLETED / THANK YOU */}
        {cfdState.type === 'complete' && (
          <div className="cfd-modal-container">
            <div className="glass animate-in cfd-complete-card">
              <div className="cfd-complete-checkmark">✓</div>
              <h1 style={{ fontSize: '2.2rem', fontWeight: 800, margin: '0 0 .5rem 0' }}>Thank You!</h1>
              <p className="muted" style={{ fontSize: '1.1rem', margin: '0 0 1.75rem 0' }}>
                Your transaction has been approved. Please take your receipt.
              </p>

              <div className="cfd-payment-breakdown">
                <div className="cfd-breakdown-row">
                  <span className="muted">Total Paid</span>
                  <span className="mono" style={{ fontWeight: 800 }}>{formatCents(cfdState.total)}</span>
                </div>
                {cfdState.changeGiven > 0 && (
                  <div className="cfd-breakdown-row" style={{ color: 'var(--brand)', fontSize: '1.3rem', fontWeight: 800 }}>
                    <span>Your Change</span>
                    <span className="mono">{formatCents(cfdState.changeGiven)}</span>
                  </div>
                )}
                {cfdState.customer && (
                  <div className="cfd-rewards-earned">
                    ★ Fresh Rewards: You earned +{cfdState.customer.earnedPoints} points today! Total: {cfdState.customer.points + cfdState.customer.earnedPoints} pts
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
