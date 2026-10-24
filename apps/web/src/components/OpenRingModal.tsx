import React, { useState } from 'react';
import type { CartLine } from '@freshpos/shared';

interface OpenRingModalProps {
  onClose: () => void;
  onAddLine: (line: CartLine) => void;
}

const DEPARTMENTS = [
  { id: 'grocery', name: 'Grocery', snap: true, taxBps: 0 },
  { id: 'produce', name: 'Produce', snap: true, taxBps: 0 },
  { id: 'deli', name: 'Deli', snap: false, taxBps: 888 }, // Prepared foods usually taxable & non-SNAP
  { id: 'bakery', name: 'Bakery', snap: true, taxBps: 0 },
  { id: 'dairy', name: 'Dairy', snap: true, taxBps: 0 },
  { id: 'meat', name: 'Meat', snap: true, taxBps: 0 },
  { id: 'beverage', name: 'Beverages', snap: true, taxBps: 888 },
  { id: 'general', name: 'General / Misc', snap: false, taxBps: 888 },
];

export function OpenRingModal({ onClose, onAddLine }: OpenRingModalProps) {
  const [selectedDept, setSelectedDept] = useState(DEPARTMENTS[0]);
  const [amountStr, setAmountStr] = useState('');
  const [customName, setCustomName] = useState('');
  const [isSnap, setIsSnap] = useState(DEPARTMENTS[0].snap);
  const [isTaxable, setIsTaxable] = useState(DEPARTMENTS[0].taxBps > 0);
  const [error, setError] = useState('');

  function handleSelectDept(dept: typeof DEPARTMENTS[0]) {
    setSelectedDept(dept);
    setIsSnap(dept.snap);
    setIsTaxable(dept.taxBps > 0);
  }

  function handleKeypad(digit: string) {
    if (digit === '⌫') {
      setAmountStr((v) => v.slice(0, -1));
    } else if (digit === 'C') {
      setAmountStr('');
    } else {
      if (amountStr.length >= 7) return; // Cap at reasonable price
      setAmountStr((v) => v + digit);
    }
  }

  function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const val = parseFloat(amountStr);
    if (isNaN(val) || val <= 0) {
      setError('Please enter a valid price amount');
      return;
    }

    const unitPriceCents = Math.round(val * 100);
    const lineName = customName.trim() || `${selectedDept.name} (Manual Ring)`;

    const newLine: CartLine = {
      id: `open-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      productId: `manual-${selectedDept.id}`,
      name: lineName,
      soldBy: 'each',
      quantity: 1,
      unitPrice: unitPriceCents,
      taxRateBps: isTaxable ? 888 : 0,
      snapEligible: isSnap,
    };

    onAddLine(newLine);
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="glass modal"
        style={{ width: 'min(560px, 95vw)', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.4rem' }}>Manual Department Ring</h2>
            <div className="muted" style={{ fontSize: '.85rem', marginTop: '.2rem' }}>
              Key in price for unbarcoded or custom grocery items
            </div>
          </div>
          <button type="button" className="btn btn-sm" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Amount Input with Large Display */}
        <div style={{ background: 'var(--surface)', padding: '1rem', borderRadius: 12, border: '1px solid var(--border)', textAlign: 'center' }}>
          <div className="muted" style={{ fontSize: '.85rem', marginBottom: '.3rem' }}>
            Item Price
          </div>
          <div
            className="mono"
            style={{
              fontSize: '2.5rem',
              fontWeight: 800,
              color: amountStr ? 'var(--brand)' : 'var(--muted)',
            }}
          >
            ${amountStr ? (parseFloat(amountStr) || 0).toFixed(2) : '0.00'}
          </div>
        </div>

        {/* Quick Department Selector */}
        <div>
          <div className="muted" style={{ fontSize: '.85rem', marginBottom: '.5rem', fontWeight: 600 }}>
            Select Department:
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '.4rem' }}>
            {DEPARTMENTS.map((dept) => (
              <button
                key={dept.id}
                type="button"
                className={`btn btn-sm ${selectedDept.id === dept.id ? 'btn-primary' : ''}`}
                style={{ padding: '.5rem .4rem', fontSize: '.82rem', fontWeight: 600 }}
                onClick={() => handleSelectDept(dept)}
              >
                {dept.name}
              </button>
            ))}
          </div>
        </div>

        {/* Custom Item Description */}
        <div>
          <label style={{ fontSize: '.85rem', display: 'block', marginBottom: '.3rem', color: 'var(--muted)' }}>
            Custom Description (Optional):
          </label>
          <input
            className="input"
            placeholder={`e.g. ${selectedDept.name} Special`}
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            style={{ fontSize: '.95rem', padding: '.55rem .85rem' }}
          />
        </div>

        {/* Compliance / Tax Flags */}
        <div style={{ display: 'flex', gap: '1.5rem', padding: '.4rem 0' }}>
          <label className="check" style={{ fontSize: '.9rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={isSnap}
              onChange={(e) => setIsSnap(e.target.checked)}
            />
            <span>SNAP / EBT Eligible</span>
          </label>
          <label className="check" style={{ fontSize: '.9rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={isTaxable}
              onChange={(e) => setIsTaxable(e.target.checked)}
            />
            <span>Taxable Item (8.875%)</span>
          </label>
        </div>

        {/* On-Screen Touch Numpad */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '.4rem' }}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((k) => (
            <button
              key={k}
              type="button"
              className="btn"
              style={{
                padding: '.75rem 0',
                fontSize: '1.25rem',
                fontWeight: 700,
                color: k === 'C' ? 'var(--warn)' : k === '⌫' ? 'var(--danger)' : 'var(--text)',
              }}
              onClick={() => handleKeypad(k)}
            >
              {k}
            </button>
          ))}
        </div>

        {error && <div className="error" style={{ textAlign: 'center' }}>{error}</div>}

        <div style={{ display: 'flex', gap: '.6rem', justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: '.8rem' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ padding: '.65rem 1.4rem', fontWeight: 700 }}
            onClick={() => handleSubmit()}
            disabled={!amountStr || parseFloat(amountStr) <= 0}
          >
            Add to Cart (${amountStr ? (parseFloat(amountStr) || 0).toFixed(2) : '0.00'})
          </button>
        </div>
      </div>
    </div>
  );
}
