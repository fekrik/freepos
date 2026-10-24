import React from 'react';
import { formatCents, type CartLine } from '@freshpos/shared';
import type { Customer } from './LoyaltyModal';

export interface ParkedOrder {
  id: string;
  parkedAt: string;
  cashierName: string;
  customer: Customer | null;
  lines: CartLine[];
  itemCount: number;
  totalCents: number;
  note?: string;
}

interface ParkedModalProps {
  parkedOrders: ParkedOrder[];
  onClose: () => void;
  onResume: (order: ParkedOrder) => void;
  onDiscard: (orderId: string) => void;
}

export function ParkedModal({ parkedOrders, onClose, onResume, onDiscard }: ParkedModalProps) {
  function formatTimeAgo(isoString: string): string {
    const diffSeconds = Math.max(0, Math.floor((Date.now() - new Date(isoString).getTime()) / 1000));
    if (diffSeconds < 60) return `${diffSeconds}s ago`;
    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    return `${diffHours}h ${diffMinutes % 60}m ago`;
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="glass modal" style={{ width: 'min(680px, 95vw)', maxHeight: '85vh', display: 'flex', flexDirection: 'column', gap: '1rem' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.4rem' }}>Suspended / Parked Tickets</h2>
            <div className="muted" style={{ fontSize: '.85rem', marginTop: '.2rem' }}>
              {parkedOrders.length} {parkedOrders.length === 1 ? 'order' : 'orders'} currently on hold
            </div>
          </div>
          <button type="button" className="btn btn-sm" onClick={onClose} style={{ padding: '.3rem .6rem' }}>
            ✕
          </button>
        </div>

        {parkedOrders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--muted)' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '.5rem' }}>⏸️</div>
            <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>No Parked Orders</div>
            <p style={{ margin: '.4rem 0 0 0', fontSize: '.9rem' }}>
              When a customer needs to step aside, click <b>Park Ticket</b> to suspend their cart and clear the lane for the next customer.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem', overflowY: 'auto', paddingRight: '.25rem' }}>
            {parkedOrders.map((order, idx) => (
              <div
                key={order.id}
                className="glass"
                style={{
                  padding: '1rem 1.15rem',
                  borderRadius: 12,
                  border: '1px solid var(--border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '1rem',
                  background: 'var(--surface)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
                    <span className="mono badge badge-muted" style={{ fontWeight: 700 }}>
                      #{idx + 1}
                    </span>
                    <span style={{ fontWeight: 700, fontSize: '1.05rem' }}>
                      {order.customer ? order.customer.name : 'Walk-in Customer'}
                    </span>
                    {order.customer && (
                      <span className="badge badge-snap" style={{ fontSize: '.75rem' }}>
                        ★ Member ({order.customer.points} pts)
                      </span>
                    )}
                    <span className="muted" style={{ fontSize: '.8rem' }}>
                      · {formatTimeAgo(order.parkedAt)} ({new Date(order.parkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
                    </span>
                  </div>

                  <div className="muted" style={{ fontSize: '.85rem', marginTop: '.35rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {order.itemCount} items: {order.lines.map((l) => l.name).slice(0, 4).join(', ')}
                    {order.lines.length > 4 ? ` +${order.lines.length - 4} more` : ''}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexShrink: 0 }}>
                  <div className="mono" style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--brand)' }}>
                    {formatCents(order.totalCents)}
                  </div>

                  <div style={{ display: 'flex', gap: '.4rem' }}>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      style={{ padding: '.5rem .85rem', fontWeight: 700 }}
                      onClick={() => onResume(order)}
                      title="Resume ringing up this order on the lane"
                    >
                      ▶ Resume
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      style={{ padding: '.5rem .65rem' }}
                      onClick={() => onDiscard(order.id)}
                      title="Discard this parked ticket"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '.8rem', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
