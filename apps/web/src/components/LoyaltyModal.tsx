import React, { useState } from 'react';
import { api } from '../api';

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email?: string;
  points: number;
}

interface Props {
  currentCustomer: Customer | null;
  onClose: () => void;
  onSelectCustomer: (customer: Customer | null) => void;
}

export function LoyaltyModal({ currentCustomer, onClose, onSelectCustomer }: Props) {
  const [tab, setTab] = useState<'lookup' | 'new'>('lookup');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [foundCustomer, setFoundCustomer] = useState<Customer | null>(currentCustomer);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleLookup(lookupPhone?: string) {
    const p = (lookupPhone || phone).trim();
    if (!p) return;
    setError('');
    setLoading(true);
    try {
      const cust = await api<Customer>(`/customers/lookup?phone=${encodeURIComponent(p)}`);
      setFoundCustomer(cust);
    } catch (e) {
      setError((e as Error).message || 'Customer not found.');
      setFoundCustomer(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const cust = await api<Customer>('/customers', {
        method: 'POST',
        json: { name, phone, email: email || undefined },
      });
      onSelectCustomer(cust);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="glass modal animate-in" style={{ width: 'min(460px, 94vw)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '1.3rem' }}>👤 Customer Loyalty</h2>
          <button className="btn" style={{ padding: '.3rem .6rem' }} onClick={onClose}>✕</button>
        </div>

        {/* Tab selector */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.4rem' }}>
          <button
            type="button"
            className={`btn ${tab === 'lookup' ? 'btn-primary' : ''}`}
            onClick={() => setTab('lookup')}
          >
            Lookup Member
          </button>
          <button
            type="button"
            className={`btn ${tab === 'new' ? 'btn-primary' : ''}`}
            onClick={() => setTab('new')}
          >
            + New Member
          </button>
        </div>

        {tab === 'lookup' && (
          <div style={{ display: 'grid', gap: '1rem' }}>
            <div>
              <span className="muted" style={{ fontSize: '.8rem' }}>Demo customer phone numbers:</span>
              <div style={{ display: 'flex', gap: '.4rem', marginTop: '.3rem' }}>
                <button
                  type="button"
                  className="btn"
                  style={{ fontSize: '.8rem', padding: '.4rem .6rem' }}
                  onClick={() => { setPhone('5550101'); handleLookup('5550101'); }}
                >
                  Sarah Connor (555-0101)
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ fontSize: '.8rem', padding: '.4rem .6rem' }}
                  onClick={() => { setPhone('5550102'); handleLookup('5550102'); }}
                >
                  David Miller (555-0102)
                </button>
              </div>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleLookup();
              }}
              style={{ display: 'flex', gap: '.5rem' }}
            >
              <input
                id="loyalty-phone-input"
                className="input mono"
                autoFocus
                placeholder="Enter 10-digit phone number..."
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
              <button className="btn btn-primary" type="submit" disabled={loading}>
                {loading ? 'Finding...' : 'Search'}
              </button>
            </form>

            {foundCustomer && (
              <div className="glass" style={{ padding: '1rem', background: 'hsl(152 68% 46% / .1)', border: '1px solid var(--brand)', display: 'grid', gap: '.4rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <b style={{ fontSize: '1.05rem' }}>{foundCustomer.name}</b>
                  <span className="badge badge-snap">{foundCustomer.points} Points</span>
                </div>
                <div className="muted" style={{ fontSize: '.85rem' }}>
                  Phone: <span className="mono">{foundCustomer.phone}</span>
                  {foundCustomer.email && ` · ${foundCustomer.email}`}
                </div>
                <div style={{ display: 'flex', gap: '.6rem', marginTop: '.6rem' }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ flex: 1 }}
                    onClick={() => {
                      onSelectCustomer(foundCustomer);
                      onClose();
                    }}
                  >
                    Attach to Order
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => {
                      setFoundCustomer(null);
                      onSelectCustomer(null);
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'new' && (
          <form onSubmit={handleCreate} style={{ display: 'grid', gap: '.8rem' }}>
            <label>
              Full Name
              <input className="input" required placeholder="e.g. Maria Gonzalez" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              Phone Number
              <input className="input mono" required placeholder="e.g. 555-0199" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
            <label>
              Email (Optional for digital receipts)
              <input className="input" type="email" placeholder="customer@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <button className="btn btn-primary btn-lg" type="submit" disabled={loading}>
              {loading ? 'Enrolling...' : 'Enroll (+25 Welcome Bonus Points)'}
            </button>
          </form>
        )}

        {error && <div className="error" style={{ textAlign: 'center' }}>{error}</div>}
      </div>
    </div>
  );
}
