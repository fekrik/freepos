import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { formatCents } from '@freshpos/shared';
import { api, session, type Product } from '../api';
import { CsvImportModal } from '../components/CsvImportModal';

interface Ref { id: string; name: string; rateBps?: number }

export function BackOffice() {
  const nav = useNavigate();
  const user = (session.get('admin') ?? session.get())!.user;
  return (
    <div className="bo">
      <nav className="bo-nav">
        <div className="logo" style={{ marginBottom: '1.5rem' }}><div className="logo-mark">F</div>FreshPOS</div>
        <NavLink to="/admin/products">Products</NavLink>
        <NavLink to="/admin/sales">Transactions</NavLink>
        <NavLink to="/admin/audit">Audit log</NavLink>
        <div style={{ flex: 1 }} />
        <span className="muted" style={{ fontSize: '.85rem', padding: '.5rem .8rem' }}>{user.name}</span>
        <button className="btn" onClick={() => { session.clear('admin'); nav('/admin/login'); }}>Sign out</button>
      </nav>
      <main className="bo-main">
        <Routes>
          <Route path="products" element={<Products />} />
          <Route path="sales" element={<Transactions />} />
          <Route path="audit" element={<Audit />} />
        </Routes>
      </main>
    </div>
  );
}

function Products() {
  const [q, setQ] = useState('');
  const [data, setData] = useState<{ items: Product[]; total: number }>({ items: [], total: 0 });
  const [editing, setEditing] = useState<Partial<Product> | null>(null);
  const [showImport, setShowImport] = useState(false);
  const load = () => api<typeof data>(`/products?q=${encodeURIComponent(q)}`).then(setData);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [q]);

  return (
    <>
      <div className="toolbar">
        <h1 style={{ flex: 1 }}>Products <span className="muted" style={{ fontSize: '1rem', fontWeight: 500 }}>{data.total}</span></h1>
        <input id="product-search" className="input" style={{ maxWidth: 320 }} placeholder="Search name, PLU, UPC…" value={q} onChange={(e) => setQ(e.target.value)} />
        {session.can('catalog.write') && (
          <>
            <button id="import-csv-btn" className="btn" onClick={() => setShowImport(true)}>📥 Import CSV</button>
            <button id="new-product" className="btn btn-primary" onClick={() => setEditing({ soldBy: 'each', active: true, snapEligible: true, barcodes: [] })}>New product</button>
          </>
        )}
      </div>
      <section className="glass" style={{ overflow: 'hidden' }}>
        <div className="table-wrapper">
          <table>
            <thead><tr><th>Name</th><th>Department</th><th>Code</th><th>Price</th><th>Flags</th></tr></thead>
            <tbody>
              {data.items.map((p) => (
                <tr key={p.id} onClick={() => session.can('catalog.write') && setEditing(p)}>
                  <td><b>{p.name}</b>{p.brand && <div className="muted" style={{ fontSize: '.8rem' }}>{p.brand}</div>}</td>
                  <td className="muted">{p.department.name}</td>
                  <td className="mono muted">{p.plu ?? p.barcodes[0]?.code.replace(/^0+/, '') ?? '—'}</td>
                  <td className="mono">{formatCents(p.price)}{p.soldBy === 'weight' && <span className="muted">/lb</span>}</td>
                  <td style={{ display: 'flex', gap: '.3rem' }}>
                    {p.snapEligible && <span className="badge badge-snap">SNAP</span>}
                    {p.minAge && <span className="badge badge-age">{p.minAge}+</span>}
                    {p.taxClass.rateBps > 0 && <span className="badge badge-muted">TAX {p.taxClass.rateBps / 100}%</span>}
                    {!p.active && <span className="badge badge-muted">INACTIVE</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {editing && <ProductForm initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {showImport && (
        <CsvImportModal
          onClose={() => setShowImport(false)}
          onImportCompleted={() => {
            setShowImport(false);
            load();
          }}
        />
      )}
    </>
  );
}

function ProductForm({ initial, onClose, onSaved }: { initial: Partial<Product>; onClose: () => void; onSaved: () => void }) {
  const [depts, setDepts] = useState<Ref[]>([]);
  const [taxes, setTaxes] = useState<Ref[]>([]);
  const [f, setF] = useState({
    name: initial.name ?? '', brand: initial.brand ?? '', departmentId: initial.departmentId ?? '', taxClassId: initial.taxClassId ?? '',
    soldBy: initial.soldBy ?? 'each', price: initial.price !== undefined ? (initial.price / 100).toFixed(2) : '',
    plu: initial.plu ?? '', barcodes: (initial.barcodes ?? []).map((b) => b.code.replace(/^0{1,2}/, '')).join(', '),
    snapEligible: initial.snapEligible ?? false, minAge: initial.minAge ? String(initial.minAge) : '',
    deposit: initial.depositCents ? (initial.depositCents / 100).toFixed(2) : '', active: initial.active ?? true,
  });
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value });

  useEffect(() => {
    api<Ref[]>('/departments').then((d) => { setDepts(d); setF((x) => ({ ...x, departmentId: x.departmentId || d[0]?.id || '' })); });
    api<Ref[]>('/tax-classes').then((t) => { setTaxes(t); setF((x) => ({ ...x, taxClassId: x.taxClassId || t[0]?.id || '' })); });
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    const body = {
      name: f.name, brand: f.brand || undefined, departmentId: f.departmentId, taxClassId: f.taxClassId, soldBy: f.soldBy,
      price: Math.round(parseFloat(f.price) * 100), plu: f.plu || null, snapEligible: f.snapEligible, active: f.active,
      minAge: f.minAge ? Number(f.minAge) : null, depositCents: f.deposit ? Math.round(parseFloat(f.deposit) * 100) : null,
      barcodes: f.barcodes.split(/[,\s]+/).filter(Boolean),
    };
    try {
      await api(initial.id ? `/products/${initial.id}` : '/products', { method: initial.id ? 'PATCH' : 'POST', json: body });
      onSaved();
    } catch (e) { setErr((e as Error).message); }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="glass modal" style={{ width: 'min(640px, 94vw)' }} onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h2>{initial.id ? 'Edit product' : 'New product'}</h2>
        <div className="form-grid">
          <label className="full">Name<input id="pf-name" className="input" required value={f.name} onChange={set('name')} /></label>
          <label>Brand<input className="input" value={f.brand} onChange={set('brand')} /></label>
          <label>Department<select className="input" value={f.departmentId} onChange={set('departmentId')}>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          <label>Tax class<select className="input" value={f.taxClassId} onChange={set('taxClassId')}>{taxes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label>Sold by<select className="input" value={f.soldBy} onChange={set('soldBy')}><option value="each">Each</option><option value="weight">Weight (lb)</option></select></label>
          <label>Price ($){f.soldBy === 'weight' && ' per lb'}<input id="pf-price" className="input mono" required inputMode="decimal" value={f.price} onChange={set('price')} /></label>
          <label>PLU<input className="input mono" value={f.plu} onChange={set('plu')} placeholder="4011" /></label>
          <label className="full">UPC / EAN barcodes<input className="input mono" value={f.barcodes} onChange={set('barcodes')} placeholder="Comma separated" /></label>
          <label>Bottle deposit ($)<input className="input mono" value={f.deposit} onChange={set('deposit')} /></label>
          <label>Minimum age<select className="input" value={f.minAge} onChange={set('minAge')}><option value="">None</option><option value="18">18+</option><option value="21">21+</option></select></label>
          <label className="check"><input type="checkbox" checked={f.snapEligible} onChange={set('snapEligible')} /> SNAP eligible</label>
          <label className="check"><input type="checkbox" checked={f.active} onChange={set('active')} /> Active</label>
        </div>
        <div className="error">{err}</div>
        <div style={{ display: 'flex', gap: '.6rem', justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button id="pf-save" className="btn btn-primary">Save</button>
        </div>
      </form>
    </div>
  );
}

function Transactions() {
  const [data, setData] = useState<{ sales: any[]; total: number }>({ sales: [], total: 0 });
  const [selectedSale, setSelectedSale] = useState<any | null>(null);

  useEffect(() => {
    api<typeof data>('/sales?take=50').then(setData).catch(() => setData({ sales: [], total: 0 }));
  }, []);

  return (
    <>
      <div className="toolbar">
        <h1 style={{ flex: 1 }}>
          Transactions <span className="muted" style={{ fontSize: '1rem', fontWeight: 500 }}>{data.total}</span>
        </h1>
      </div>
      <section className="glass" style={{ overflow: 'hidden' }}>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Receipt #</th>
                <th>Date & Time</th>
                <th>Cashier</th>
                <th>Items</th>
                <th>Tenders</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {data.sales.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: '2rem' }} className="muted">
                    No completed sales yet. Ring up a sale on Lane 1!
                  </td>
                </tr>
              ) : (
                data.sales.map((s) => (
                  <tr key={s.id} onClick={() => setSelectedSale(s)}>
                    <td className="mono" style={{ fontWeight: 600 }}>{s.saleNumber}</td>
                    <td className="muted">{new Date(s.completedAt).toLocaleString()}</td>
                    <td>{s.user?.name || 'Cashier'}</td>
                    <td>{s.lines?.length || 0} items</td>
                    <td>
                      {s.payments?.map((p: any, i: number) => (
                        <span key={i} className="badge badge-muted" style={{ marginRight: '.3rem' }}>
                          {p.tenderType.toUpperCase()}
                        </span>
                      ))}
                    </td>
                    <td className="mono" style={{ fontWeight: 700, color: 'var(--brand)' }}>
                      {formatCents(s.totalCents)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Sale Detail Modal */}
      {selectedSale && (
        <div className="modal-backdrop" onClick={() => setSelectedSale(null)}>
          <div className="glass modal" style={{ width: 'min(540px, 94vw)' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>Transaction Details</h2>
              <button className="btn" style={{ padding: '.3rem .6rem' }} onClick={() => setSelectedSale(null)}>✕</button>
            </div>
            <div className="mono" style={{ fontSize: '.9rem', color: 'var(--brand)' }}>{selectedSale.saleNumber}</div>
            <div className="muted" style={{ fontSize: '.85rem' }}>
              {new Date(selectedSale.completedAt).toLocaleString()} · Cashier: {selectedSale.user?.name}
            </div>

            <div style={{ maxHeight: 200, overflowY: 'auto', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', padding: '.6rem 0' }}>
              {selectedSale.lines?.map((l: any, i: number) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.85rem', marginBottom: '.3rem' }}>
                  <span>{l.quantity} × {l.name}</span>
                  <span className="mono">{formatCents(l.fixedTotalCents ?? l.unitPriceCents * l.quantity)}</span>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gap: '.3rem', fontSize: '.9rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="muted">Subtotal</span>
                <span className="mono">{formatCents(selectedSale.subtotalCents)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="muted">Tax</span>
                <span className="mono">{formatCents(selectedSale.taxCents)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: '1.1rem' }}>
                <span>Total</span>
                <span className="mono" style={{ color: 'var(--brand)' }}>{formatCents(selectedSale.totalCents)}</span>
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '.6rem' }}>
              <span className="muted" style={{ fontSize: '.8rem' }}>Payments:</span>
              {selectedSale.payments?.map((p: any, i: number) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.85rem' }}>
                  <span>{p.tenderType.toUpperCase()} {p.last4 ? `(**** ${p.last4})` : ''}</span>
                  <span className="mono">{formatCents(p.amountCents)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Audit() {
  const [rows, setRows] = useState<{ id: string; action: string; entity?: string; createdAt: string; data?: unknown }[]>([]);
  useEffect(() => { api<typeof rows>('/audit').then(setRows).catch(() => setRows([])); }, []);
  return (
    <>
      <h1>Audit log</h1>
      <section className="glass" style={{ overflow: 'hidden' }}>
        <div className="table-wrapper">
          <table>
            <thead><tr><th>When</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}><td className="muted">{new Date(r.createdAt).toLocaleString()}</td><td className="mono">{r.action}</td>
                <td className="muted">{r.entity ?? '—'}</td><td className="mono muted" style={{ fontSize: '.8rem' }}>{r.data ? JSON.stringify(r.data) : ''}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </section>
    </>
  );
}

