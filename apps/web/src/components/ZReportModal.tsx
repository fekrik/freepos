import React from 'react';
import { formatCents } from '@freshpos/shared';

export interface ZReportData {
  shiftId: string;
  storeName: string;
  registerName: string;
  cashierName: string;
  openedAt: string;
  closedAt: string;
  salesSummary: {
    transactionsCount: number;
    grossSalesCents: number;
    taxCents: number;
    depositCents: number;
  };
  tendersSummary: {
    cashCents: number;
    cardCents: number;
    ebtCents: number;
  };
  drawerReconciliation: {
    openingFloatCents: number;
    cashSalesCents: number;
    paidInCents: number;
    paidOutCents: number;
    cashDropsCents: number;
    expectedCashCents: number;
    countedCashCents: number;
    differenceCents: number;
    status: 'balanced' | 'over' | 'short';
  };
}

interface Props {
  zReport: ZReportData;
  onClose: () => void;
}

export function ZReportModal({ zReport, onClose }: Props) {
  const rec = zReport.drawerReconciliation;
  const isBalanced = rec.differenceCents === 0;
  const isOver = rec.differenceCents > 0;

  return (
    <div className="modal-backdrop">
      <div className="glass modal animate-in" style={{ width: 'min(480px, 95vw)', padding: '1.5rem', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '1.25rem' }}>End-of-Day Z-Report</h2>
          <div style={{ display: 'flex', gap: '.5rem' }}>
            <button type="button" className="btn" style={{ padding: '.4rem .8rem', fontSize: '.85rem' }} onClick={() => window.print()}>
              🖨️ Print Report
            </button>
            <button type="button" className="btn btn-primary" style={{ padding: '.4rem .8rem', fontSize: '.85rem' }} onClick={onClose}>
              Done
            </button>
          </div>
        </div>

        {/* Thermal paper style layout */}
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
          <div style={{ textAlign: 'center', borderBottom: '2px dashed #000', paddingBottom: '.75rem', marginBottom: '.75rem' }}>
            <div style={{ fontWeight: 800, fontSize: '1.2rem', letterSpacing: '.04em' }}>{zReport.storeName}</div>
            <div style={{ fontWeight: 700, fontSize: '1rem', marginTop: '.2rem' }}>*** OFFICIAL Z-REPORT ***</div>
            <div style={{ fontSize: '.78rem', color: '#444', marginTop: '.3rem' }}>
              <div>Register: {zReport.registerName} · Cashier: {zReport.cashierName}</div>
              <div>Opened: {new Date(zReport.openedAt).toLocaleString()}</div>
              <div>Closed: {new Date(zReport.closedAt).toLocaleString()}</div>
            </div>
          </div>

          {/* Sales Summary */}
          <div style={{ borderBottom: '1px dashed #666', paddingBottom: '.6rem', marginBottom: '.6rem' }}>
            <div style={{ fontWeight: 700, marginBottom: '.3rem' }}>SALES ACTIVITY</div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Completed Tickets:</span>
              <span>{zReport.salesSummary.transactionsCount}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Total Sales Tax:</span>
              <span>{formatCents(zReport.salesSummary.taxCents)}</span>
            </div>
            {zReport.salesSummary.depositCents > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Container Deposits:</span>
                <span>{formatCents(zReport.salesSummary.depositCents)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginTop: '.2rem' }}>
              <span>GROSS TOTAL SALES:</span>
              <span>{formatCents(zReport.salesSummary.grossSalesCents)}</span>
            </div>
          </div>

          {/* Tenders Breakdown */}
          <div style={{ borderBottom: '1px dashed #666', paddingBottom: '.6rem', marginBottom: '.6rem' }}>
            <div style={{ fontWeight: 700, marginBottom: '.3rem' }}>TENDERS COLLECTED</div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>CASH SALES:</span>
              <span>{formatCents(zReport.tendersSummary.cashCents)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>CARD (STRIPE):</span>
              <span>{formatCents(zReport.tendersSummary.cardCents)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>EBT SNAP FOOD:</span>
              <span>{formatCents(zReport.tendersSummary.ebtCents)}</span>
            </div>
          </div>

          {/* Cash Drawer Reconciliation */}
          <div style={{ borderBottom: '2px dashed #000', paddingBottom: '.75rem', marginBottom: '.75rem' }}>
            <div style={{ fontWeight: 700, marginBottom: '.3rem' }}>CASH DRAWER RECONCILIATION</div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>(+) Opening Float:</span>
              <span>{formatCents(rec.openingFloatCents)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>(+) Cash Sales:</span>
              <span>{formatCents(rec.cashSalesCents)}</span>
            </div>
            {rec.paidInCents > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>(+) Paid-Ins:</span>
                <span>{formatCents(rec.paidInCents)}</span>
              </div>
            )}
            {rec.paidOutCents > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>(-) Paid-Outs (Petty Cash):</span>
                <span>- {formatCents(rec.paidOutCents)}</span>
              </div>
            )}
            {rec.cashDropsCents > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>(-) Cash Drops to Safe:</span>
                <span>- {formatCents(rec.cashDropsCents)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, borderTop: '1px solid #999', paddingTop: '.3rem', marginTop: '.3rem' }}>
              <span>EXPECTED DRAWER CASH:</span>
              <span>{formatCents(rec.expectedCashCents)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
              <span>ACTUAL COUNTED CASH:</span>
              <span>{formatCents(rec.countedCashCents)}</span>
            </div>

            {/* Over/Short Banner */}
            <div
              style={{
                marginTop: '.6rem',
                padding: '.5rem',
                textAlign: 'center',
                fontWeight: 800,
                fontSize: '.95rem',
                border: '1px solid #444',
                background: isBalanced ? '#ecfdf5' : isOver ? '#eff6ff' : '#fef2f2',
                color: isBalanced ? '#047857' : isOver ? '#1d4ed8' : '#b91c1c',
              }}
            >
              {isBalanced && 'DRAWER BALANCED (0.00)'}
              {isOver && `DRAWER OVER BY +${formatCents(rec.differenceCents)}`}
              {!isBalanced && !isOver && `DRAWER SHORT BY -${formatCents(Math.abs(rec.differenceCents))}`}
            </div>
          </div>

          <div style={{ textAlign: 'center', fontSize: '.75rem', color: '#555' }}>
            <div>End of Shift Z-Report · Retain with cash drop bag</div>
            <div style={{ marginTop: '.4rem' }}>Cashier Signature: ______________________</div>
          </div>
        </div>
      </div>
    </div>
  );
}
