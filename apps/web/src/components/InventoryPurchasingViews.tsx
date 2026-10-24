import { useEffect, useState } from 'react';
import { formatCents } from '@freshpos/shared';
import { api, session } from '../api';

export interface StockSupplierLink {
  id: string;
  supplierId: string;
  supplierName: string;
  rank: number;
  vendorSku?: string | null;
  unitCostCents: number;
  casePackQty: number;
}

export interface StockItem {
  productId: string;
  name: string;
  brand?: string | null;
  plu?: string | null;
  upc?: string | null;
  department: { id: string; name: string; code?: string };
  soldBy: 'each' | 'weight';
  retailPriceCents: number;
  unitCostCents: number;
  onHand: number;
  reorderPoint: number | null;
  isLowStock: boolean;
  suppliers: StockSupplierLink[];
}

export interface SupplierRecord {
  id: string;
  name: string;
  code?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  paymentTerms?: string | null;
  balanceCents: number;
  active: boolean;
  products: Array<{
    id: string;
    rank: number;
    vendorSku?: string | null;
    unitCostCents: number;
    casePackQty: number;
    product: { id: string; name: string; price: number; soldBy: 'each' | 'weight'; plu?: string | null };
  }>;
  _count?: { purchaseOrders: number; products: number };
}

export interface PurchaseOrderRecord {
  id: string;
  poNumber: string;
  status: 'draft' | 'ordered' | 'received' | 'canceled';
  subtotalCents: number;
  totalCents: number;
  paidCents: number;
  invoiceNo?: string | null;
  notes?: string | null;
  expectedAt?: string | null;
  orderedAt: string;
  receivedAt?: string | null;
  supplier: SupplierRecord;
  lines: Array<{
    id: string;
    productId: string;
    name: string;
    orderedQty: number;
    receivedQty: number;
    unitCostCents: number;
    lineTotalCents: number;
    product: { id: string; name: string; soldBy: 'each' | 'weight'; plu?: string | null; price: number };
  }>;
}

function formatQty(qty: number, soldBy: 'each' | 'weight'): string {
  if (soldBy === 'weight') {
    return `${(qty / 1000).toFixed(1)} lb`;
  }
  return `${qty} units`;
}

// ============================================================================
// 1. Inventory & Reorder Alerts Tab
// ============================================================================

export function InventoryView() {
  const [q, setQ] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [stock, setStock] = useState<{
    items: StockItem[];
    totalItems: number;
    lowStockCount: number;
    totalValuationCents: number;
  }>({
    items: [],
    totalItems: 0,
    lowStockCount: 0,
    totalValuationCents: 0,
  });

  const [adjusting, setAdjusting] = useState<StockItem | null>(null);
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustReorder, setAdjustReorder] = useState('');
  const [adjustReason, setAdjustReason] = useState('Physical cycle count');
  const [toast, setToast] = useState<string | null>(null);

  // Quick PO modal from low-stock items
  const [quickPoSupplierId, setQuickPoSupplierId] = useState<string | null>(null);

  const load = () => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (supplierFilter) params.set('supplierId', supplierFilter);
    if (lowStockOnly) params.set('lowStockOnly', 'true');
    api<typeof stock>(`/inventory/stock?${params.toString()}`).then(setStock).catch(() => {});
  };

  useEffect(() => {
    api<SupplierRecord[]>('/inventory/suppliers').then(setSuppliers).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(load, 150);
    return () => clearTimeout(t);
  }, [q, supplierFilter, lowStockOnly]);

  function openAdjust(item: StockItem) {
    setAdjusting(item);
    setAdjustQty(
      item.soldBy === 'weight' ? (item.onHand / 1000).toFixed(2) : String(item.onHand),
    );
    setAdjustReorder(
      item.reorderPoint !== null
        ? item.soldBy === 'weight'
          ? (item.reorderPoint / 1000).toFixed(2)
          : String(item.reorderPoint)
        : '',
    );
    setAdjustReason('Physical cycle count');
  }

  async function saveAdjust(e: React.FormEvent) {
    e.preventDefault();
    if (!adjusting) return;
    const parsedOnHand =
      adjusting.soldBy === 'weight'
        ? Math.round(parseFloat(adjustQty || '0') * 1000)
        : Math.round(parseFloat(adjustQty || '0'));
    const parsedReorder = adjustReorder
      ? adjusting.soldBy === 'weight'
        ? Math.round(parseFloat(adjustReorder) * 1000)
        : Math.round(parseFloat(adjustReorder))
      : null;

    await api('/inventory/adjust', {
      method: 'POST',
      json: {
        productId: adjusting.productId,
        onHand: parsedOnHand,
        reorderPoint: parsedReorder,
        reason: adjustReason,
      },
    });
    setAdjusting(null);
    setToast(`Updated stock for ${adjusting.name}`);
    setTimeout(() => setToast(null), 3000);
    load();
  }

  return (
    <>
      <div className="toolbar" style={{ flexWrap: 'wrap', gap: '.75rem' }}>
        <h1 style={{ flex: 1, minWidth: 220 }}>
          Inventory & Stock Alerts{' '}
          <span className="muted" style={{ fontSize: '1rem', fontWeight: 500 }}>
            {stock.totalItems} SKUs
          </span>
        </h1>
        <input
          className="input"
          style={{ maxWidth: 260 }}
          placeholder="Search item, PLU, UPC…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="input"
          style={{ maxWidth: 240 }}
          value={supplierFilter}
          onChange={(e) => setSupplierFilter(e.target.value)}
        >
          <option value="">All Suppliers</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`btn ${lowStockOnly ? 'btn-warn' : ''}`}
          style={
            lowStockOnly
              ? { borderColor: 'var(--warn)', color: 'var(--warn)', fontWeight: 700 }
              : {}
          }
          onClick={() => setLowStockOnly((v) => !v)}
        >
          ⚠️ Low Stock Only ({stock.lowStockCount})
        </button>
      </div>

      {/* Summary KPI Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '1rem',
          marginBottom: '1.25rem',
        }}
      >
        <div className="glass" style={{ padding: '1rem 1.25rem' }}>
          <div className="muted" style={{ fontSize: '.8rem', textTransform: 'uppercase', letterSpacing: '.04em' }}>
            Total Inventory Cost Value
          </div>
          <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--brand)', marginTop: '.25rem' }}>
            {formatCents(stock.totalValuationCents)}
          </div>
        </div>

        <div className="glass" style={{ padding: '1rem 1.25rem' }}>
          <div className="muted" style={{ fontSize: '.8rem', textTransform: 'uppercase', letterSpacing: '.04em' }}>
            Items Below Reorder Threshold
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '.25rem' }}>
            <span
              className="mono"
              style={{
                fontSize: '1.5rem',
                fontWeight: 700,
                color: stock.lowStockCount > 0 ? 'var(--warn)' : 'var(--brand)',
              }}
            >
              {stock.lowStockCount} items
            </span>
            {stock.lowStockCount > 0 && (
              <button
                className="btn btn-sm"
                style={{ borderColor: 'var(--brand)', color: 'var(--brand)' }}
                onClick={() => setQuickPoSupplierId(supplierFilter || suppliers[0]?.id || '')}
              >
                + Auto-Draft PO
              </button>
            )}
          </div>
        </div>

        <div className="glass" style={{ padding: '1rem 1.25rem' }}>
          <div className="muted" style={{ fontSize: '.8rem', textTransform: 'uppercase', letterSpacing: '.04em' }}>
            Active Wholesalers / Vendors
          </div>
          <div className="mono" style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: '.25rem' }}>
            {suppliers.length} suppliers
          </div>
        </div>
      </div>

      <section className="glass" style={{ overflow: 'hidden' }}>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Primary / Secondary Suppliers</th>
                <th>Cost / Retail</th>
                <th>On Hand</th>
                <th>Reorder At</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {stock.items.map((item) => {
                const marginPct =
                  item.retailPriceCents > 0
                    ? Math.round(((item.retailPriceCents - item.unitCostCents) / item.retailPriceCents) * 100)
                    : 0;
                return (
                  <tr key={item.productId} onClick={() => session.can('catalog.write') && openAdjust(item)}>
                    <td>
                      <b>{item.name}</b>
                      <div className="muted" style={{ fontSize: '.8rem' }}>
                        {item.department.name} · {item.plu ? `PLU ${item.plu}` : item.upc ? `UPC ${item.upc}` : ''}
                      </div>
                    </td>
                    <td>
                      {item.suppliers.length === 0 ? (
                        <span className="muted">—</span>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '.2rem' }}>
                          {item.suppliers.map((sp) => (
                            <div key={sp.id} style={{ fontSize: '.8rem', display: 'flex', alignItems: 'center', gap: '.35rem' }}>
                              <span className="badge badge-muted" style={{ fontSize: '.7rem' }}>
                                {sp.rank === 1 ? '1° Primary' : sp.rank === 2 ? '2° Backup' : '3° Alt'}
                              </span>
                              <span>{sp.supplierName}</span>
                              <span className="mono muted">({formatCents(sp.unitCostCents)})</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="mono">
                      <div>
                        <span className="muted">Cost:</span> {formatCents(item.unitCostCents)}
                      </div>
                      <div style={{ fontSize: '.8rem' }}>
                        <span className="muted">Retail:</span> {formatCents(item.retailPriceCents)} ({marginPct}% margin)
                      </div>
                    </td>
                    <td className="mono" style={{ fontWeight: 700, color: item.isLowStock ? 'var(--warn)' : 'var(--text)' }}>
                      {formatQty(item.onHand, item.soldBy)}
                    </td>
                    <td className="mono muted">
                      {item.reorderPoint !== null ? formatQty(item.reorderPoint, item.soldBy) : '—'}
                    </td>
                    <td>
                      {item.isLowStock ? (
                        <span className="badge badge-age">⚠️ REORDER NEEDED</span>
                      ) : (
                        <span className="badge badge-snap">IN STOCK</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Adjust Stock & Reorder Threshold Modal */}
      {adjusting && (
        <div className="modal-backdrop" onClick={() => setAdjusting(null)}>
          <form
            className="glass modal"
            style={{ width: 'min(480px, 94vw)' }}
            onClick={(e) => e.stopPropagation()}
            onSubmit={saveAdjust}
          >
            <h2>Adjust Inventory: {adjusting.name}</h2>
            <p className="muted" style={{ margin: 0, fontSize: '.85rem' }}>
              Update physical stock count ({adjusting.soldBy === 'weight' ? 'lbs' : 'units'}) and low-stock alert threshold.
            </p>
            <div className="form-grid">
              <label>
                On Hand ({adjusting.soldBy === 'weight' ? 'lb' : 'units'})
                <input
                  className="input mono"
                  required
                  inputMode="decimal"
                  value={adjustQty}
                  onChange={(e) => setAdjustQty(e.target.value)}
                />
              </label>
              <label>
                Reorder Point ({adjusting.soldBy === 'weight' ? 'lb' : 'units'})
                <input
                  className="input mono"
                  inputMode="decimal"
                  value={adjustReorder}
                  onChange={(e) => setAdjustReorder(e.target.value)}
                />
              </label>
              <label className="full">
                Adjustment Reason
                <input
                  className="input"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                />
              </label>
            </div>
            <div style={{ display: 'flex', gap: '.6rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn" onClick={() => setAdjusting(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Save Stock Count
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Quick Auto-Draft PO Modal */}
      {quickPoSupplierId !== null && (
        <CreatePurchaseOrderModal
          suppliers={suppliers}
          stockItems={stock.items}
          initialSupplierId={quickPoSupplierId}
          preselectLowStock
          onClose={() => setQuickPoSupplierId(null)}
          onCreated={(po) => {
            setQuickPoSupplierId(null);
            setToast(`Created Purchase Order ${po.poNumber}`);
            setTimeout(() => setToast(null), 3500);
          }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

// ============================================================================
// 2. Purchase Orders & Receiving Tab
// ============================================================================

export function PurchaseOrdersView() {
  const [pos, setPos] = useState<PurchaseOrderRecord[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [receivingPo, setReceivingPo] = useState<PurchaseOrderRecord | null>(null);
  const [invoiceNo, setInvoiceNo] = useState('');
  const [paidAmount, setPaidAmount] = useState('');
  const [receiveQtys, setReceiveQtys] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);

  const load = () => {
    api<PurchaseOrderRecord[]>('/inventory/purchase-orders').then(setPos).catch(() => {});
    api<SupplierRecord[]>('/inventory/suppliers').then(setSuppliers).catch(() => {});
    api<{ items: StockItem[] }>('/inventory/stock')
      .then((res) => setStockItems(res.items))
      .catch(() => {});
  };

  useEffect(() => {
    load();
  }, []);

  function openReceiveModal(po: PurchaseOrderRecord) {
    setReceivingPo(po);
    setInvoiceNo(po.invoiceNo ?? `INV-${Math.floor(10000 + Math.random() * 90000)}`);
    setPaidAmount('0.00');
    const map: Record<string, string> = {};
    for (const l of po.lines) {
      map[l.id] =
        l.product.soldBy === 'weight'
          ? (l.orderedQty / 1000).toFixed(2)
          : String(l.orderedQty);
    }
    setReceiveQtys(map);
  }

  async function confirmReceive(e: React.FormEvent) {
    e.preventDefault();
    if (!receivingPo) return;

    const lines = receivingPo.lines.map((l) => {
      const raw = parseFloat(receiveQtys[l.id] ?? '0') || 0;
      const receivedQty =
        l.product.soldBy === 'weight' ? Math.round(raw * 1000) : Math.round(raw);
      return {
        lineId: l.id,
        receivedQty,
        unitCostCents: l.unitCostCents,
      };
    });

    await api(`/inventory/purchase-orders/${receivingPo.id}/receive`, {
      method: 'POST',
      json: {
        invoiceNo,
        paidCents: Math.round((parseFloat(paidAmount || '0') || 0) * 100),
        lines,
      },
    });

    const poNum = receivingPo.poNumber;
    setReceivingPo(null);
    setToast(`Received ${poNum} — Inventory on-hand and Supplier AP updated!`);
    setTimeout(() => setToast(null), 3500);
    load();
  }

  return (
    <>
      <div className="toolbar">
        <h1 style={{ flex: 1 }}>
          Purchase Orders & Receiving{' '}
          <span className="muted" style={{ fontSize: '1rem', fontWeight: 500 }}>
            {pos.length} orders
          </span>
        </h1>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          + New Purchase Order
        </button>
      </div>

      <section className="glass" style={{ overflow: 'hidden' }}>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>PO #</th>
                <th>Supplier</th>
                <th>Ordered Date</th>
                <th>Items</th>
                <th>Total Cost</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {pos.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '2rem' }} className="muted">
                    No purchase orders yet. Click "+ New Purchase Order" to order from a vendor.
                  </td>
                </tr>
              ) : (
                pos.map((po) => (
                  <tr key={po.id}>
                    <td className="mono" style={{ fontWeight: 700 }}>
                      {po.poNumber}
                      {po.invoiceNo && (
                        <div className="muted" style={{ fontSize: '.75rem' }}>
                          Inv: {po.invoiceNo}
                        </div>
                      )}
                    </td>
                    <td>
                      <b>{po.supplier?.name}</b>
                      {po.notes && (
                        <div className="muted" style={{ fontSize: '.8rem' }}>
                          {po.notes}
                        </div>
                      )}
                    </td>
                    <td className="muted">{new Date(po.orderedAt).toLocaleDateString()}</td>
                    <td>
                      <div style={{ fontSize: '.85rem' }}>{po.lines.length} line items</div>
                      <div className="muted" style={{ fontSize: '.75rem' }}>
                        {po.lines.slice(0, 2).map((l) => l.name).join(', ')}
                        {po.lines.length > 2 ? ` +${po.lines.length - 2} more` : ''}
                      </div>
                    </td>
                    <td className="mono" style={{ fontWeight: 700, color: 'var(--brand)' }}>
                      {formatCents(po.totalCents)}
                    </td>
                    <td>
                      {po.status === 'received' ? (
                        <span className="badge badge-snap">✓ RECEIVED</span>
                      ) : (
                        <span className="badge badge-age">⏳ OPEN ORDER</span>
                      )}
                    </td>
                    <td>
                      {po.status !== 'received' ? (
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => openReceiveModal(po)}
                        >
                          📦 Receive Stock
                        </button>
                      ) : (
                        <span className="muted" style={{ fontSize: '.8rem' }}>
                          {po.receivedAt ? new Date(po.receivedAt).toLocaleDateString() : 'Completed'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {showCreate && (
        <CreatePurchaseOrderModal
          suppliers={suppliers}
          stockItems={stockItems}
          onClose={() => setShowCreate(false)}
          onCreated={(po) => {
            setShowCreate(false);
            setToast(`Created ${po.poNumber}`);
            setTimeout(() => setToast(null), 3500);
            load();
          }}
        />
      )}

      {/* Receive PO & Invoice Reconciliation Modal */}
      {receivingPo && (
        <div className="modal-backdrop" onClick={() => setReceivingPo(null)}>
          <form
            className="glass modal"
            style={{ width: 'min(640px, 95vw)' }}
            onClick={(e) => e.stopPropagation()}
            onSubmit={confirmReceive}
          >
            <h2>Receive Delivery: {receivingPo.poNumber}</h2>
            <p className="muted" style={{ margin: 0, fontSize: '.85rem' }}>
              Vendor: <b>{receivingPo.supplier.name}</b> · Verify quantities delivered to increment shelf inventory.
            </p>

            <div className="form-grid">
              <label>
                Vendor Invoice #
                <input
                  className="input mono"
                  required
                  value={invoiceNo}
                  onChange={(e) => setInvoiceNo(e.target.value)}
                  placeholder="INV-10023"
                />
              </label>
              <label>
                Amount Paid Today ($) (Leave 0 to bill on {receivingPo.supplier.paymentTerms || 'AP Account'})
                <input
                  className="input mono"
                  inputMode="decimal"
                  value={paidAmount}
                  onChange={(e) => setPaidAmount(e.target.value)}
                />
              </label>
            </div>

            <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: '.5rem' }}>
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Ordered</th>
                    <th>Unit Cost</th>
                    <th>Received Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {receivingPo.lines.map((l) => (
                    <tr key={l.id}>
                      <td>{l.name}</td>
                      <td className="mono muted">{formatQty(l.orderedQty, l.product.soldBy)}</td>
                      <td className="mono">{formatCents(l.unitCostCents)}</td>
                      <td>
                        <input
                          className="input mono"
                          style={{ width: 100, padding: '.35rem .5rem' }}
                          inputMode="decimal"
                          value={receiveQtys[l.id] ?? ''}
                          onChange={(e) =>
                            setReceiveQtys({ ...receiveQtys, [l.id]: e.target.value })
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="muted" style={{ fontSize: '.85rem' }}>
                Order Total: <b className="mono" style={{ color: 'var(--brand)' }}>{formatCents(receivingPo.totalCents)}</b>
              </div>
              <div style={{ display: 'flex', gap: '.6rem' }}>
                <button type="button" className="btn" onClick={() => setReceivingPo(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  ✓ Confirm & Increment Stock
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

function CreatePurchaseOrderModal({
  suppliers,
  stockItems,
  initialSupplierId,
  preselectLowStock,
  onClose,
  onCreated,
}: {
  suppliers: SupplierRecord[];
  stockItems: StockItem[];
  initialSupplierId?: string;
  preselectLowStock?: boolean;
  onClose: () => void;
  onCreated: (po: PurchaseOrderRecord) => void;
}) {
  const [supplierId, setSupplierId] = useState(initialSupplierId || suppliers[0]?.id || '');
  const [notes, setNotes] = useState(preselectLowStock ? 'Low-stock replenishment order' : 'Standard vendor restock');
  const [qtys, setQtys] = useState<Record<string, string>>({});

  // Filter items supplied by selected vendor (or all items if none linked)
  const vendorItems = stockItems.filter(
    (item) => !supplierId || item.suppliers.some((sp) => sp.supplierId === supplierId),
  );
  const displayItems = vendorItems.length > 0 ? vendorItems : stockItems;

  useEffect(() => {
    if (preselectLowStock) {
      const next: Record<string, string> = {};
      for (const item of displayItems) {
        if (item.isLowStock) {
          next[item.productId] = item.soldBy === 'weight' ? '25' : '24';
        }
      }
      setQtys(next);
    }
  }, [supplierId, preselectLowStock]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const lines = [];
    for (const item of displayItems) {
      const raw = parseFloat(qtys[item.productId] ?? '0');
      if (raw > 0) {
        const orderedQty = item.soldBy === 'weight' ? Math.round(raw * 1000) : Math.round(raw);
        const sp = item.suppliers.find((s) => s.supplierId === supplierId);
        lines.push({
          productId: item.productId,
          orderedQty,
          unitCostCents: sp?.unitCostCents ?? item.unitCostCents,
        });
      }
    }
    if (lines.length === 0) return;

    const po = await api<PurchaseOrderRecord>('/inventory/purchase-orders', {
      method: 'POST',
      json: {
        supplierId,
        notes,
        lines,
      },
    });
    onCreated(po);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="glass modal"
        style={{ width: 'min(680px, 95vw)' }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h2>Create Purchase Order</h2>
        <div className="form-grid">
          <label>
            Supplier / Wholesaler
            <select
              className="input"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.paymentTerms || 'Net 30'})
                </option>
              ))}
            </select>
          </label>
          <label>
            Order Notes
            <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>

        <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: '.5rem' }}>
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>On Hand</th>
                <th>Unit Cost</th>
                <th>Order Qty</th>
              </tr>
            </thead>
            <tbody>
              {displayItems.map((item) => {
                const sp = item.suppliers.find((s) => s.supplierId === supplierId);
                const cost = sp?.unitCostCents ?? item.unitCostCents;
                return (
                  <tr key={item.productId}>
                    <td>
                      <b>{item.name}</b>
                      {item.isLowStock && (
                        <span className="badge badge-age" style={{ marginLeft: '.4rem', fontSize: '.7rem' }}>
                          LOW
                        </span>
                      )}
                    </td>
                    <td className="mono muted">{formatQty(item.onHand, item.soldBy)}</td>
                    <td className="mono">{formatCents(cost)}</td>
                    <td>
                      <input
                        className="input mono"
                        style={{ width: 95, padding: '.3rem .5rem' }}
                        placeholder={item.soldBy === 'weight' ? '0 lb' : '0'}
                        inputMode="decimal"
                        value={qtys[item.productId] ?? ''}
                        onChange={(e) =>
                          setQtys({ ...qtys, [item.productId]: e.target.value })
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.6rem' }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Submit Purchase Order
          </button>
        </div>
      </form>
    </div>
  );
}

// ============================================================================
// 3. Suppliers & Accounts Payable (Money Owed to Suppliers) Tab
// ============================================================================

export function SuppliersView() {
  const [suppliers, setSuppliers] = useState<SupplierRecord[]>([]);
  const [editing, setEditing] = useState<Partial<SupplierRecord> | null>(null);
  const [paying, setPaying] = useState<SupplierRecord | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payRef, setPayRef] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const load = () => {
    api<SupplierRecord[]>('/inventory/suppliers').then(setSuppliers).catch(() => {});
  };

  useEffect(() => {
    load();
  }, []);

  const totalApBalanceCents = suppliers.reduce((s, v) => s + v.balanceCents, 0);

  async function saveSupplier(e: React.FormEvent) {
    e.preventDefault();
    if (!editing?.name) return;
    await api(editing.id ? `/inventory/suppliers/${editing.id}` : '/inventory/suppliers', {
      method: editing.id ? 'PATCH' : 'POST',
      json: {
        name: editing.name,
        code: editing.code,
        contactName: editing.contactName,
        phone: editing.phone,
        email: editing.email,
        paymentTerms: editing.paymentTerms || 'Net 30',
      },
    });
    setEditing(null);
    load();
  }

  async function recordPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!paying) return;
    const cents = Math.round((parseFloat(payAmount || '0') || 0) * 100);
    if (cents <= 0) return;

    await api(`/inventory/suppliers/${paying.id}/pay`, {
      method: 'POST',
      json: {
        amountCents: cents,
        reference: payRef || `CHK-${Math.floor(1000 + Math.random() * 9000)}`,
      },
    });
    setToast(`Recorded ${formatCents(cents)} payment to ${paying.name}`);
    setTimeout(() => setToast(null), 3500);
    setPaying(null);
    load();
  }

  return (
    <>
      <div className="toolbar">
        <h1 style={{ flex: 1 }}>
          Suppliers & Vendor Balances{' '}
          <span className="muted" style={{ fontSize: '1rem', fontWeight: 500 }}>
            Total AP Owed: {formatCents(totalApBalanceCents)}
          </span>
        </h1>
        <button
          className="btn btn-primary"
          onClick={() => setEditing({ name: '', code: '', paymentTerms: 'Net 30' })}
        >
          + New Supplier
        </button>
      </div>

      <section className="glass" style={{ overflow: 'hidden' }}>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Supplier</th>
                <th>Contact</th>
                <th>Terms</th>
                <th>Catalog Items</th>
                <th>Balance Owed (AP)</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.id}>
                  <td>
                    <b>{s.name}</b>
                    {s.code && (
                      <span className="mono badge badge-muted" style={{ marginLeft: '.4rem' }}>
                        {s.code}
                      </span>
                    )}
                  </td>
                  <td>
                    <div>{s.contactName || '—'}</div>
                    <div className="muted" style={{ fontSize: '.8rem' }}>
                      {s.phone} {s.email ? `· ${s.email}` : ''}
                    </div>
                  </td>
                  <td>
                    <span className="badge badge-muted">{s.paymentTerms || 'Net 30'}</span>
                  </td>
                  <td className="mono">{s._count?.products ?? s.products?.length ?? 0} SKUs</td>
                  <td
                    className="mono"
                    style={{
                      fontWeight: 700,
                      color: s.balanceCents > 0 ? 'var(--warn)' : 'var(--brand)',
                    }}
                  >
                    {formatCents(s.balanceCents)}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '.4rem' }}>
                      {s.balanceCents > 0 && (
                        <button
                          className="btn btn-sm"
                          style={{ borderColor: 'var(--brand)', color: 'var(--brand)' }}
                          onClick={() => {
                            setPaying(s);
                            setPayAmount((s.balanceCents / 100).toFixed(2));
                            setPayRef('');
                          }}
                        >
                          💵 Pay Balance
                        </button>
                      )}
                      <button className="btn btn-sm" onClick={() => setEditing(s)}>
                        Edit
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <form
            className="glass modal"
            style={{ width: 'min(520px, 94vw)' }}
            onClick={(e) => e.stopPropagation()}
            onSubmit={saveSupplier}
          >
            <h2>{editing.id ? 'Edit Supplier' : 'New Supplier'}</h2>
            <div className="form-grid">
              <label className="full">
                Supplier Name
                <input
                  className="input"
                  required
                  value={editing.name ?? ''}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              </label>
              <label>
                Vendor Code
                <input
                  className="input mono"
                  value={editing.code ?? ''}
                  onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                  placeholder="UNFI"
                />
              </label>
              <label>
                Payment Terms
                <input
                  className="input"
                  value={editing.paymentTerms ?? 'Net 30'}
                  onChange={(e) => setEditing({ ...editing, paymentTerms: e.target.value })}
                />
              </label>
              <label>
                Contact Rep
                <input
                  className="input"
                  value={editing.contactName ?? ''}
                  onChange={(e) => setEditing({ ...editing, contactName: e.target.value })}
                />
              </label>
              <label>
                Phone
                <input
                  className="input"
                  value={editing.phone ?? ''}
                  onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
                />
              </label>
              <label className="full">
                Email
                <input
                  className="input"
                  value={editing.email ?? ''}
                  onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                />
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.6rem' }}>
              <button type="button" className="btn" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Save Supplier
              </button>
            </div>
          </form>
        </div>
      )}

      {paying && (
        <div className="modal-backdrop" onClick={() => setPaying(null)}>
          <form
            className="glass modal"
            style={{ width: 'min(440px, 94vw)' }}
            onClick={(e) => e.stopPropagation()}
            onSubmit={recordPayment}
          >
            <h2>Pay Supplier: {paying.name}</h2>
            <p className="muted" style={{ margin: 0, fontSize: '.85rem' }}>
              Current Balance Owed: <b className="mono">{formatCents(paying.balanceCents)}</b>
            </p>
            <div className="form-grid">
              <label className="full">
                Payment Amount ($)
                <input
                  className="input mono"
                  required
                  inputMode="decimal"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                />
              </label>
              <label className="full">
                Check / ACH Reference #
                <input
                  className="input mono"
                  placeholder="CHK-1042 or ACH"
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                />
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.6rem' }}>
              <button type="button" className="btn" onClick={() => setPaying(null)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Record Payment
              </button>
            </div>
          </form>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
