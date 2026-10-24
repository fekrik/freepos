import React from 'react';
import { formatCents, type Cents } from '@freshpos/shared';

export interface ReceiptData {
  saleNumber: string;
  completedAt: string;
  store: {
    name: string;
    address: string;
    fnsNumber?: string;
  };
  registerName: string;
  cashierName: string;
  customer?: {
    name: string;
    phone: string;
    points: number;
    earnedPoints?: number;
  };
  lines: Array<{
    name: string;
    soldBy: 'each' | 'weight';
    quantity: number;
    unitPrice: number;
    fixedTotal?: number;
    taxRateBps: number;
    snapEligible: boolean;
    depositPerUnit?: number;
    discount?: number;
    promoName?: string;
    isOverridden?: boolean;
    overrideReason?: string;
    lineTotal: number;
  }>;
  totals: {
    subtotal: Cents;
    deposits: Cents;
    tax: Cents;
    total: Cents;
    snapPaid: Cents;
    snapEligible: Cents;
  };
  payments: Array<{
    tenderType: string;
    amountCents: Cents;
    tenderedCents?: Cents;
    changeCents?: Cents;
    cardBrand?: string;
    last4?: string;
    authCode?: string;
  }>;
}

interface Props {
  receipt: ReceiptData;
  onNewSale: () => void;
}

export function ReceiptModal({ receipt, onNewSale }: Props) {
  return (
    <div className="modal-backdrop">
      <div className="glass modal animate-in" style={{ width: 'min(480px, 95vw)', padding: '1.5rem', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '1.25rem' }}>Receipt</h2>
          <div style={{ display: 'flex', gap: '.5rem' }}>
            <button type="button" className="btn" style={{ padding: '.4rem .8rem', fontSize: '.85rem' }} onClick={() => window.print()}>
              🖨️ Print
            </button>
            <button type="button" className="btn btn-primary" style={{ padding: '.4rem .8rem', fontSize: '.85rem' }} onClick={onNewSale}>
              + New Sale
            </button>
          </div>
        </div>

        {/* Thermal receipt paper preview */}
        <div
          id="printable-receipt"
          style={{
            background: 'hsl(160 10% 98%)',
            color: 'hsl(0 0% 10%)',
            fontFamily: 'var(--mono)',
            fontSize: '.85rem',
            padding: '1.5rem',
            borderRadius: '6px',
            lineHeight: 1.45,
            boxShadow: '0 8px 30px rgba(0,0,0,0.4)',
          }}
        >
          {/* Header */}
          <div style={{ textAlign: 'center', borderBottom: '1px dashed #888', paddingBottom: '.75rem', marginBottom: '.75rem' }}>
            <div style={{ fontWeight: 700, fontSize: '1.15rem', letterSpacing: '.04em' }}>{receipt.store.name}</div>
            <div style={{ fontSize: '.8rem', color: '#444' }}>{receipt.store.address}</div>
            {receipt.store.fnsNumber && (
              <div style={{ fontSize: '.75rem', color: '#555', marginTop: '.2rem' }}>
                USDA SNAP FNS Retailer #{receipt.store.fnsNumber}
              </div>
            )}
            <div style={{ marginTop: '.5rem', fontSize: '.78rem', color: '#333' }}>
              <div>Receipt: {receipt.saleNumber}</div>
              <div>{new Date(receipt.completedAt).toLocaleString()}</div>
              <div>Lane: {receipt.registerName} · Cashier: {receipt.cashierName}</div>
              {receipt.customer && (
                <div style={{ marginTop: '.3rem', fontWeight: 600, color: '#047857', borderTop: '1px dotted #aaa', paddingTop: '.3rem' }}>
                  ★ FRESH REWARDS MEMBER: {receipt.customer.name}
                  <div style={{ fontWeight: 400, fontSize: '.74rem', color: '#333' }}>
                    Phone: {receipt.customer.phone} · Balance: {receipt.customer.points + (receipt.customer.earnedPoints || 0)} pts (+{receipt.customer.earnedPoints || 0} earned)
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Line items */}
          <div style={{ borderBottom: '1px dashed #888', paddingBottom: '.75rem', marginBottom: '.75rem' }}>
            {receipt.lines.map((l, i) => (
              <div key={i} style={{ marginBottom: '.4rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                  <span>{l.name}</span>
                  <span>{formatCents(l.lineTotal)}</span>
                </div>
                <div style={{ fontSize: '.75rem', color: '#555', display: 'flex', justifyContent: 'space-between' }}>
                  <span>
                    {l.soldBy === 'weight'
                      ? `${(l.quantity / 1000).toFixed(3)} lb @ ${formatCents(l.unitPrice)}/lb`
                      : `${l.quantity} @ ${formatCents(l.unitPrice)}`}
                    {l.snapEligible ? ' [F]' : ''}
                    {l.taxRateBps > 0 ? ' [T]' : ''}
                  </span>
                  {l.depositPerUnit ? <span>+{formatCents(l.depositPerUnit * (l.soldBy === 'each' ? l.quantity : 1))} dep</span> : null}
                </div>
                {l.isOverridden && (
                  <div style={{ fontSize: '.72rem', color: '#b91c1c', fontWeight: 600 }}>
                    ↳ OVERRIDE: {l.overrideReason || 'Price adjusted'}
                  </div>
                )}
                {l.promoName && (
                  <div style={{ fontSize: '.72rem', color: '#047857', fontWeight: 600 }}>
                    ↳ PROMO: {l.promoName} (-{formatCents(l.discount || 0)})
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Subtotals & Taxes */}
          <div style={{ borderBottom: '1px dashed #888', paddingBottom: '.75rem', marginBottom: '.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Subtotal</span>
              <span>{formatCents(receipt.totals.subtotal)}</span>
            </div>
            {receipt.totals.deposits > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Container Deposits</span>
                <span>{formatCents(receipt.totals.deposits)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Sales Tax</span>
              <span>{formatCents(receipt.totals.tax)}</span>
            </div>
            {receipt.totals.snapPaid > 0 && (
              <div style={{ fontSize: '.75rem', color: '#2563eb', margin: '.2rem 0' }}>
                * SNAP Food benefit tax forgiveness applied (7 CFR 272.1)
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.15rem', fontWeight: 700, marginTop: '.4rem' }}>
              <span>TOTAL DUE</span>
              <span>{formatCents(receipt.totals.total)}</span>
            </div>
          </div>

          {/* Payments & Change */}
          <div style={{ borderBottom: '1px dashed #888', paddingBottom: '.75rem', marginBottom: '.75rem' }}>
            <div style={{ fontWeight: 600, marginBottom: '.3rem' }}>PAYMENTS</div>
            {receipt.payments.map((p, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.8rem' }}>
                <span>
                  {p.tenderType.toUpperCase()}
                  {p.cardBrand ? ` (${p.cardBrand} ****${p.last4})` : ''}
                  {p.authCode ? ` · ${p.authCode}` : ''}
                </span>
                <span>{formatCents(p.amountCents)}</span>
              </div>
            ))}
            {receipt.payments.some((p) => p.changeCents && p.changeCents > 0) && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginTop: '.3rem', color: '#047857' }}>
                <span>CHANGE GIVEN</span>
                <span>
                  {formatCents(receipt.payments.reduce((s, p) => s + (p.changeCents || 0), 0))}
                </span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{ textAlign: 'center', fontSize: '.75rem', color: '#555', marginTop: '.75rem' }}>
            <div>[F] = SNAP Eligible Food Item</div>
            <div>[T] = Taxable Item</div>
            <div style={{ marginTop: '.5rem', fontWeight: 600 }}>THANK YOU FOR SHOPPING FRESH!</div>
            <div style={{ fontSize: '.7rem', color: '#777', marginTop: '.2rem' }}>Please retain for your records</div>
          </div>
        </div>
      </div>
    </div>
  );
}
