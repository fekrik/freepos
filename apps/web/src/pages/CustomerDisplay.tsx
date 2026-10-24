import React, { useEffect, useRef, useState } from 'react';
import { formatCents } from '@freshpos/shared';
import { subscribeCFD, type CFDState } from '../cfd';

export function CustomerDisplay() {
  const [cfdState, setCfdState] = useState<CFDState>({
    type: 'idle',
    storeName: 'Fresh Market Supermarket',
    registerName: 'Lane 1',
  });
  const [clock, setClock] = useState(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
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
    <div
      style={{
        minHeight: '100vh',
        background: 'radial-gradient(ellipse at top, hsl(160 30% 10%), hsl(160 25% 4%))',
        color: 'var(--text)',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'var(--font)',
        userSelect: 'none',
        overflow: 'hidden',
      }}
    >
      {/* Top Header Bar */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '1rem 2rem',
          background: 'hsla(160, 20%, 8%, 0.85)',
          backdropFilter: 'blur(12px)',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: 'linear-gradient(135deg, var(--brand), var(--brand-2))',
              display: 'grid',
              placeItems: 'center',
              fontWeight: 800,
              fontSize: '1.4rem',
              color: '#042f1a',
              boxShadow: '0 0 20px var(--brand-glow)',
            }}
          >
            F
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: '1.4rem', letterSpacing: '-0.02em' }}>{storeName}</div>
            <div className="muted" style={{ fontSize: '.85rem' }}>{registerName} · Customer Display</div>
          </div>
        </div>

        {/* Loyalty Greeting or Live Clock */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          {cfdState.type === 'cart' && cfdState.customer && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '.6rem',
                background: 'hsla(152, 68%, 46%, 0.15)',
                border: '1px solid var(--brand)',
                padding: '.5rem 1rem',
                borderRadius: 999,
                fontSize: '.95rem',
              }}
            >
              <span style={{ color: 'var(--brand)', fontWeight: 800 }}>★ FRESH REWARDS</span>
              <span style={{ fontWeight: 600 }}>{cfdState.customer.name}</span>
              <span className="muted">({cfdState.customer.points} pts)</span>
              {cfdState.customer.earnedPoints !== undefined && cfdState.customer.earnedPoints > 0 && (
                <span className="badge badge-snap" style={{ fontSize: '.8rem' }}>
                  +{cfdState.customer.earnedPoints} pts
                </span>
              )}
            </div>
          )}

          <div
            className="mono"
            style={{
              fontSize: '1.2rem',
              fontWeight: 600,
              color: 'var(--muted)',
              background: 'var(--surface)',
              padding: '.4rem .9rem',
              borderRadius: 8,
              border: '1px solid var(--border)',
            }}
          >
            {clock}
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* STATE 1: IDLE / WELCOME SCREEN */}
        {cfdState.type === 'idle' && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              padding: '3rem',
              textAlign: 'center',
              gap: '2.5rem',
            }}
          >
            <div className="animate-in" style={{ maxWidth: 700 }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '.5rem',
                  padding: '.4rem 1rem',
                  borderRadius: 999,
                  background: 'hsla(152, 68%, 46%, 0.15)',
                  border: '1px solid var(--brand)',
                  color: 'var(--brand)',
                  fontWeight: 600,
                  fontSize: '.95rem',
                  marginBottom: '1.5rem',
                }}
              >
                ✓ Cashier Lane Open & Ready
              </div>
              <h1 style={{ fontSize: '3rem', fontWeight: 800, margin: '0 0 1rem 0', letterSpacing: '-0.03em', lineHeight: 1.15 }}>
                Welcome to <span style={{ background: 'linear-gradient(135deg, var(--brand), var(--brand-2))', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Fresh Market</span>
              </h1>
              <p className="muted" style={{ fontSize: '1.25rem', margin: 0, lineHeight: 1.5 }}>
                Scan items with your cashier to begin checkout. Have your Fresh Rewards phone number or digital member card ready.
              </p>
            </div>

            {/* Grocery Deals Showcase Carousel Cards */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '1.25rem',
                width: 'min(1100px, 94vw)',
              }}
            >
              <div className="glass" style={{ padding: '1.5rem', borderRadius: 16, textAlign: 'left', border: '1px solid hsla(152, 68%, 46%, 0.3)' }}>
                <div style={{ fontSize: '2rem', marginBottom: '.5rem' }}>🥑</div>
                <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>Hass Avocados</div>
                <div style={{ color: 'var(--brand)', fontWeight: 800, fontSize: '1.25rem', margin: '.2rem 0' }}>2 for $2.00</div>
                <div className="muted" style={{ fontSize: '.85rem' }}>Regular $1.29 each · Save $0.58</div>
              </div>

              <div className="glass" style={{ padding: '1.5rem', borderRadius: 16, textAlign: 'left', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '2rem', marginBottom: '.5rem' }}>🥤</div>
                <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>Classic Cola 12pk</div>
                <div style={{ color: 'var(--brand)', fontWeight: 800, fontSize: '1.25rem', margin: '.2rem 0' }}>3 for $18.00</div>
                <div className="muted" style={{ fontSize: '.85rem' }}>Stock up & save $4.47</div>
              </div>

              <div className="glass" style={{ padding: '1.5rem', borderRadius: 16, textAlign: 'left', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '2rem', marginBottom: '.5rem' }}>🍞</div>
                <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>Artisan Bakery</div>
                <div style={{ color: 'var(--brand)', fontWeight: 800, fontSize: '1.25rem', margin: '.2rem 0' }}>Buy 2 Get 1 Free</div>
                <div className="muted" style={{ fontSize: '.85rem' }}>Freshly baked this morning</div>
              </div>

              <div className="glass" style={{ padding: '1.5rem', borderRadius: 16, textAlign: 'left', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '2rem', marginBottom: '.5rem' }}>💳</div>
                <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>Payment Methods</div>
                <div style={{ color: 'var(--snap)', fontWeight: 700, fontSize: '1.1rem', margin: '.2rem 0' }}>EBT SNAP Ready</div>
                <div className="muted" style={{ fontSize: '.85rem' }}>Apple Pay, Google Pay, Chips</div>
              </div>
            </div>
          </div>
        )}

        {/* STATE 2: ACTIVE SCANNING CART STATE */}
        {cfdState.type === 'cart' && (
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', height: '100%', overflow: 'hidden' }}>
            {/* Left Column: Running Itemized Cart Lines */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                borderRight: '1px solid var(--border)',
                background: 'hsla(160, 20%, 6%, 0.5)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  padding: '1rem 1.5rem',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: 'var(--surface)',
                }}
              >
                <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>Your Grocery Cart</div>
                <div className="muted" style={{ fontSize: '.9rem' }}>
                  {cfdState.totals.itemCount} {cfdState.totals.itemCount === 1 ? 'item' : 'items'}
                </div>
              </div>

              <div
                ref={scrollRef}
                style={{
                  flex: 1,
                  overflowY: 'auto',
                  padding: '.5rem 1rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '.5rem',
                }}
              >
                {cfdState.lines.map((l) => (
                  <div
                    key={l.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '1rem 1.25rem',
                      borderRadius: 12,
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
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
                      <div className="muted" style={{ fontSize: '.9rem', marginTop: '.25rem' }}>
                        {l.fixedTotal !== undefined
                          ? 'Priced item'
                          : l.soldBy === 'weight'
                          ? `${(l.quantity / 1000).toFixed(3)} lb @ ${formatCents(l.unitPrice)}/lb`
                          : `${l.quantity} × ${formatCents(l.unitPrice)}`}
                        {l.depositPerUnit ? ` (+${formatCents(l.depositPerUnit * l.quantity)} deposit)` : ''}
                      </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div className="mono" style={{ fontSize: '1.3rem', fontWeight: 800 }}>
                        {formatCents(l.lineTotal)}
                      </div>
                      {l.discount && l.discount > 0 ? (
                        <div style={{ fontSize: '.8rem', color: 'var(--brand)', fontWeight: 600 }}>
                          Save {formatCents(l.discount)}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Column: Hero Showcase + Total Due */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                padding: '1.75rem',
                background: 'hsla(160, 25%, 5%, 0.8)',
                overflowY: 'auto',
                gap: '1.5rem',
              }}
            >
              {/* Last Scanned Item Hero Card */}
              {cfdState.lastScanned && (
                <div
                  className="glass"
                  style={{
                    padding: '1.5rem',
                    borderRadius: 16,
                    border: flashLastScanned ? '2px solid var(--brand)' : '1px solid var(--border)',
                    background: flashLastScanned ? 'hsla(152, 68%, 46%, 0.15)' : 'var(--surface)',
                    transition: 'all 0.25s ease-out',
                    transform: flashLastScanned ? 'scale(1.02)' : 'scale(1)',
                  }}
                >
                  <div style={{ fontSize: '.85rem', fontWeight: 700, color: 'var(--brand)', letterSpacing: '.06em', textTransform: 'uppercase' }}>
                    ✦ Just Scanned
                  </div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, marginTop: '.4rem' }}>
                    {cfdState.lastScanned.name}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '.6rem' }}>
                    <span className="muted" style={{ fontSize: '1.05rem' }}>{cfdState.lastScanned.quantityStr}</span>
                    <span className="mono" style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--text)' }}>
                      {cfdState.lastScanned.priceStr}
                    </span>
                  </div>
                </div>
              )}

              {/* Savings Banner */}
              {cfdState.totals.discounts > 0 && (
                <div
                  style={{
                    background: 'linear-gradient(135deg, hsla(152, 68%, 46%, 0.2), hsla(152, 68%, 46%, 0.05))',
                    border: '1px solid var(--brand)',
                    padding: '1rem 1.25rem',
                    borderRadius: 12,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
                    <span style={{ fontSize: '1.5rem' }}>🎉</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--brand)' }}>Total Store Savings</div>
                      <div className="muted" style={{ fontSize: '.8rem' }}>Multi-buy deals & rewards applied</div>
                    </div>
                  </div>
                  <div className="mono" style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--brand)' }}>
                    -{formatCents(cfdState.totals.discounts)}
                  </div>
                </div>
              )}

              {/* Order Summary & Grand Total */}
              <div
                className="glass"
                style={{
                  padding: '1.5rem',
                  borderRadius: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '.8rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--muted)', fontSize: '1.05rem' }}>
                  <span>Subtotal</span>
                  <span className="mono" style={{ color: 'var(--text)' }}>{formatCents(cfdState.totals.subtotal)}</span>
                </div>

                {cfdState.totals.deposits > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--muted)', fontSize: '1.05rem' }}>
                    <span>Bottle Deposits</span>
                    <span className="mono" style={{ color: 'var(--text)' }}>{formatCents(cfdState.totals.deposits)}</span>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--muted)', fontSize: '1.05rem' }}>
                  <span>Sales Tax</span>
                  <span className="mono" style={{ color: 'var(--text)' }}>{formatCents(cfdState.totals.tax)}</span>
                </div>

                {cfdState.totals.snapEligibleTotal > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--snap)', fontSize: '1.05rem' }}>
                    <span>SNAP Food Eligible</span>
                    <span className="mono">{formatCents(cfdState.totals.snapEligibleTotal)}</span>
                  </div>
                )}

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    paddingTop: '1rem',
                    borderTop: '2px solid var(--border)',
                    marginTop: '.5rem',
                  }}
                >
                  <span style={{ fontSize: '1.5rem', fontWeight: 800 }}>TOTAL DUE</span>
                  <span
                    id="cfd-grand-total"
                    className="mono"
                    style={{
                      fontSize: '3rem',
                      fontWeight: 800,
                      background: 'linear-gradient(135deg, var(--brand), var(--brand-2))',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                    }}
                  >
                    {formatCents(cfdState.totals.total)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STATE 3: PAYMENT IN PROGRESS */}
        {cfdState.type === 'payment' && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '2rem',
              padding: '2rem',
              textAlign: 'center',
            }}
          >
            <div className="glass animate-in" style={{ padding: '2.5rem', borderRadius: 24, maxWidth: 540, width: '90%' }}>
              <div style={{ fontSize: '3.5rem', marginBottom: '1rem' }}>💳</div>
              <h2 style={{ fontSize: '2rem', fontWeight: 800, margin: '0 0 .5rem 0' }}>Processing Payment</h2>
              <p className="muted" style={{ fontSize: '1.1rem', margin: '0 0 2rem 0' }}>
                Please tap card, insert chip, or enter EBT PIN on the pin pad
              </p>

              <div style={{ background: 'var(--surface)', padding: '1.25rem', borderRadius: 16, display: 'flex', flexDirection: 'column', gap: '.8rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.1rem' }}>
                  <span className="muted">Method</span>
                  <span style={{ fontWeight: 700, textTransform: 'uppercase' }}>{cfdState.tenderType}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.1rem' }}>
                  <span className="muted">Total Due</span>
                  <span className="mono" style={{ fontWeight: 700 }}>{formatCents(cfdState.totalDue)}</span>
                </div>
                {cfdState.amountPaid > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.1rem', color: 'var(--brand)' }}>
                    <span>Amount Paid</span>
                    <span className="mono" style={{ fontWeight: 700 }}>{formatCents(cfdState.amountPaid)}</span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.4rem', fontWeight: 800, borderTop: '1px solid var(--border)', paddingTop: '.8rem' }}>
                  <span>Remaining</span>
                  <span className="mono" style={{ color: 'var(--warn)' }}>{formatCents(cfdState.remainingDue)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STATE 4: SALE COMPLETED / THANK YOU */}
        {cfdState.type === 'complete' && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '2rem',
              padding: '2rem',
              textAlign: 'center',
            }}
          >
            <div className="glass animate-in" style={{ padding: '3rem', borderRadius: 24, maxWidth: 560, width: '90%' }}>
              <div
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: '50%',
                  background: 'hsla(152, 68%, 46%, 0.2)',
                  border: '2px solid var(--brand)',
                  color: 'var(--brand)',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: '2.5rem',
                  margin: '0 auto 1.5rem auto',
                }}
              >
                ✓
              </div>
              <h1 style={{ fontSize: '2.5rem', fontWeight: 800, margin: '0 0 .5rem 0' }}>Thank You!</h1>
              <p className="muted" style={{ fontSize: '1.15rem', margin: '0 0 2rem 0' }}>
                Your transaction has been approved. Please take your receipt.
              </p>

              <div style={{ background: 'var(--surface)', padding: '1.25rem', borderRadius: 16, display: 'flex', flexDirection: 'column', gap: '.8rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.15rem' }}>
                  <span className="muted">Total Paid</span>
                  <span className="mono" style={{ fontWeight: 800 }}>{formatCents(cfdState.total)}</span>
                </div>
                {cfdState.changeGiven > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.4rem', fontWeight: 800, color: 'var(--brand)' }}>
                    <span>Your Change</span>
                    <span className="mono">{formatCents(cfdState.changeGiven)}</span>
                  </div>
                )}
                {cfdState.customer && (
                  <div style={{ marginTop: '.5rem', borderTop: '1px solid var(--border)', paddingTop: '.8rem', fontSize: '.95rem', color: 'var(--brand)', fontWeight: 600 }}>
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
