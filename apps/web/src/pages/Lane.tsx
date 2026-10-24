import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  applyPromotions,
  computeTotals,
  formatCents,
  lineGross,
  lineNet,
  taxAfterSnap,
  type CartLine,
  type ParsedBarcode,
} from '@freshpos/shared';
import { api, session, type Product } from '../api';
import { PaymentModal, type PaymentTender } from '../components/PaymentModal';
import { ReceiptModal, type ReceiptData } from '../components/ReceiptModal';
import { SupervisorOverrideModal, type OverrideType } from '../components/SupervisorOverrideModal';
import { LoyaltyModal, type Customer } from '../components/LoyaltyModal';
import { ShiftModal, type ShiftInfo } from '../components/ShiftModal';
import { ZReportModal, type ZReportData } from '../components/ZReportModal';
import { ReturnModal } from '../components/ReturnModal';
import { ParkedModal, type ParkedOrder } from '../components/ParkedModal';
import { OpenRingModal } from '../components/OpenRingModal';
import { TimeClockModal } from '../components/TimeClockModal';
import { queueOfflineSale, getPendingOfflineSales, removeOfflineSale, type OfflineSalePayload } from '../offline';
import { broadcastCFD } from '../cfd';

export function Lane() {
  const nav = useNavigate();
  const user = (session.get('lane') ?? session.get())!.user;
  const [lines, setLines] = useState<CartLine[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [toast, setToast] = useState<{ msg: string; err?: boolean } | null>(null);
  const [weighFor, setWeighFor] = useState<Product | null>(null);
  const [weight, setWeight] = useState('');
  const [ageFor, setAgeFor] = useState<{ p: Product; parsed: ParsedBarcode } | null>(null);

  // Phase 2 checkout & receipt states
  const [showPayment, setShowPayment] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);

  // Autocomplete search states
  const [suggestions, setSuggestions] = useState<Product[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Loyalty states
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [showLoyaltyModal, setShowLoyaltyModal] = useState(false);

  // Supervisor override modal state
  const [overrideModal, setOverrideModal] = useState<{ type: OverrideType; line?: CartLine } | null>(null);

  // Shift & cash drawer management states
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [currentShift, setCurrentShift] = useState<ShiftInfo | null>(null);
  const [zReport, setZReport] = useState<ZReportData | null>(null);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [showMobileTotals, setShowMobileTotals] = useState(false);

  // Suspended / Parked tickets
  const [parkedOrders, setParkedOrders] = useState<ParkedOrder[]>(() => {
    try {
      const raw = localStorage.getItem('freshpos.parked_orders');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [showParkedModal, setShowParkedModal] = useState(false);
  const [showOpenRingModal, setShowOpenRingModal] = useState(false);
  const [showTimeClockModal, setShowTimeClockModal] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem('freshpos.parked_orders', JSON.stringify(parkedOrders));
    } catch {}
  }, [parkedOrders]);

  const scanRef = useRef<HTMLInputElement>(null);

  // Automatic promotions applied dynamically to non-overridden items
  const activeLines = useMemo(() => applyPromotions(lines), [lines]);
  const totals = useMemo(() => computeTotals(activeLines), [activeLines]);
  const itemCount = useMemo(
    () => activeLines.filter((l) => !l.voided).reduce((n, l) => n + (l.soldBy === 'each' ? l.quantity : 1), 0),
    [activeLines],
  );

  // Synchronize Customer-Facing Display (CFD) in real-time
  useEffect(() => {
    if (activeLines.length === 0) {
      broadcastCFD({
        type: 'idle',
        storeName: 'Fresh Market Supermarket',
        registerName: 'Lane 1',
      });
      return;
    }

    const last = activeLines[activeLines.length - 1];
    const quantityStr =
      last.fixedTotal !== undefined
        ? 'Fixed price'
        : last.soldBy === 'weight'
        ? `${(last.quantity / 1000).toFixed(3)} lb @ ${formatCents(last.unitPrice)}/lb`
        : `${last.quantity} × ${formatCents(last.unitPrice)}`;

    broadcastCFD({
      type: 'cart',
      storeName: 'Fresh Market Supermarket',
      registerName: 'Lane 1',
      cashierName: user.name,
      customer: customer
        ? {
            name: customer.name,
            phone: customer.phone,
            points: customer.points,
            earnedPoints: Math.floor(totals.total / 100),
          }
        : undefined,
      lines: activeLines.map((l) => ({
        id: l.id,
        name: l.name,
        soldBy: l.soldBy,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        fixedTotal: l.fixedTotal,
        taxRateBps: l.taxRateBps,
        snapEligible: l.snapEligible,
        depositPerUnit: l.depositPerUnit,
        discount: l.discount,
        promoName: l.promoName,
        isOverridden: l.isOverridden,
        overrideReason: l.overrideReason,
        lineTotal: lineNet(l),
      })),
      lastScanned: last
        ? {
            name: last.name,
            quantityStr,
            priceStr: formatCents(lineNet(last)),
            promoDiscount: last.discount ? `Save ${formatCents(last.discount)}` : undefined,
          }
        : undefined,
      totals: {
        itemCount,
        subtotal: totals.subtotal,
        discounts: totals.discounts,
        deposits: totals.deposits,
        tax: totals.tax,
        total: totals.total,
        snapEligibleTotal: totals.snapEligibleTotal,
      },
    });
  }, [activeLines, totals, itemCount, customer, user.name]);

  useEffect(() => {
    if (showPayment) {
      broadcastCFD({
        type: 'payment',
        storeName: 'Fresh Market Supermarket',
        registerName: 'Lane 1',
        tenderType: 'Card / Cash / EBT SNAP',
        totalDue: totals.total,
        amountPaid: 0,
        remainingDue: totals.total,
      });
    }
  }, [showPayment, totals.total]);

  const notify = (msg: string, err = false) => {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 2800);
  };
  const focusScan = () => setTimeout(() => scanRef.current?.focus(), 0);

  async function fetchCurrentShift() {
    try {
      const shift = await api<ShiftInfo>('/shifts/current');
      setCurrentShift(shift);
    } catch {
      // Offline or network error
    }
  }

  // Debounced autocomplete query when typing in the search bar
  useEffect(() => {
    const q = code.trim();
    if (!q) {
      setSuggestions([]);
      setShowSuggestions(false);
      setSelectedIndex(-1);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await api<{ items: Product[] }>(`/products?q=${encodeURIComponent(q)}&take=10`);
        const lowerQ = q.toLowerCase();
        // Smart ranking: exact word prefix first
        const sorted = [...res.items].sort((a, b) => {
          const aStarts = a.name.toLowerCase().startsWith(lowerQ);
          const bStarts = b.name.toLowerCase().startsWith(lowerQ);
          if (aStarts && !bStarts) return -1;
          if (!aStarts && bStarts) return 1;

          const aWord = a.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(lowerQ));
          const bWord = b.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(lowerQ));
          if (aWord && !bWord) return -1;
          if (!aWord && bWord) return 1;

          return a.name.localeCompare(b.name);
        });

        setSuggestions(sorted);
        setShowSuggestions(sorted.length > 0);
        setSelectedIndex(sorted.length > 0 ? 0 : -1);
      } catch {
        setSuggestions([]);
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [code]);

  // Monitor network connectivity, fetch active shift, and drain offline sales queue
  useEffect(() => {
    focusScan();
    fetchCurrentShift();

    const handleOnline = () => { setIsOnline(true); syncOfflineSales(); };
    const handleOffline = () => setIsOnline(false);
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) && scanRef.current && !scanRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('mousedown', handleClickOutside);

    syncOfflineSales();

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  async function syncOfflineSales() {
    try {
      const pending = await getPendingOfflineSales();
      setPendingSyncCount(pending.length);
      if (pending.length === 0 || !navigator.onLine) return;

      for (const sale of pending) {
        try {
          await api('/sales', {
            method: 'POST',
            json: {
              lines: sale.lines,
              payments: sale.payments,
              offlineCreated: true,
              offlineSaleNumber: sale.offlineSaleNumber,
            },
          });
          await removeOfflineSale(sale.id);
        } catch (e) {
          console.error('Failed to sync offline transaction', e);
          break;
        }
      }
      const remaining = await getPendingOfflineSales();
      setPendingSyncCount(remaining.length);
      if (remaining.length === 0 && pending.length > 0) {
        notify(`Synced ${pending.length} offline transactions to cloud.`);
      }
    } catch (e) {
      console.error('Offline sync error', e);
    }
  }

  function addLine(p: Product, parsed: ParsedBarcode, weightThousandths?: number) {
    const base: CartLine = {
      id: crypto.randomUUID(),
      productId: p.id,
      name: p.name,
      soldBy: p.soldBy,
      quantity: 1,
      unitPrice: p.price,
      taxRateBps: p.taxClass.rateBps,
      snapEligible: p.snapEligible,
      depositPerUnit: p.depositCents ?? undefined,
    };
    if (parsed.kind === 'price-embedded') {
      Object.assign(base, { soldBy: 'each', fixedTotal: parsed.price });
    } else if (parsed.kind === 'weight-embedded') {
      Object.assign(base, { soldBy: 'weight', quantity: parsed.weightThousandths });
    } else if (p.soldBy === 'weight') {
      base.quantity = weightThousandths!;
    }

    setLines((ls) => {
      // Merge repeat scans of identical fixed-price items that haven't been modified
      const same = ls.find(
        (l) => !l.voided && !l.isOverridden && l.productId === p.id && l.soldBy === 'each' && l.fixedTotal === undefined && base.fixedTotal === undefined,
      );
      if (same) {
        setSelected(same.id);
        return ls.map((l) => (l === same ? { ...l, quantity: l.quantity + 1 } : l));
      }
      setSelected(base.id);
      return [...ls, base];
    });
    focusScan();
  }

  async function scan(raw: string) {
    if (!raw.trim()) return;
    setCode('');
    try {
      const { product, parsed } = await api<{ product: Product; parsed: ParsedBarcode }>(`/scan/${encodeURIComponent(raw.trim())}`);
      if (product.minAge) return setAgeFor({ p: product, parsed });
      if (product.soldBy === 'weight' && parsed.kind !== 'price-embedded' && parsed.kind !== 'weight-embedded') {
        setWeighFor(product);
        setWeight('');
        return;
      }
      addLine(product, parsed);
    } catch (e) {
      notify((e as Error).message, true);
      focusScan();
    }
  }

  function handleSelectProduct(product: Product) {
    setShowSuggestions(false);
    setSuggestions([]);
    setCode('');
    setSelectedIndex(-1);

    if (product.minAge) {
      setAgeFor({ p: product, parsed: { kind: 'product', code: product.barcodes[0]?.code || product.plu || '' } });
      return;
    }
    if (product.soldBy === 'weight') {
      setWeighFor(product);
      setWeight('');
      return;
    }

    addLine(product, { kind: 'product', code: product.barcodes[0]?.code || product.plu || '' });
    focusScan();
  }

  function handleInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
        return;
      }
      if (e.key === 'Escape') {
        setShowSuggestions(false);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
          handleSelectProduct(suggestions[selectedIndex]);
          return;
        }
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      scan(code);
    }
  }

  function confirmWeight() {
    const lbs = parseFloat(weight);
    if (!weighFor || !(lbs > 0)) return;
    addLine(weighFor, { kind: 'plu', plu: weighFor.plu ?? '' }, Math.round(lbs * 1000));
    setWeighFor(null);
  }

  function voidSelected() {
    if (!selected) return;
    setLines((ls) => ls.map((l) => (l.id === selected ? { ...l, voided: !l.voided } : l)));
  }

  function changeQty(delta: number) {
    setLines((ls) =>
      ls.map((l) =>
        l.id === selected && l.soldBy === 'each' && !l.fixedTotal
          ? { ...l, quantity: Math.max(1, l.quantity + delta) }
          : l,
      ),
    );
  }

  async function handleFinalizePayment(payments: PaymentTender[]) {
    const saleLines = activeLines.filter((l) => !l.voided);
    const snapTenderPaid = payments.filter((p) => p.tenderType === 'ebt_snap').reduce((s, p) => s + p.amountCents, 0);
    const effectiveTax = taxAfterSnap(saleLines, snapTenderPaid);
    const finalTotal = totals.subtotal - totals.discounts + totals.deposits + effectiveTax;

    const payload = {
      lines: saleLines.map((l) => ({
        productId: l.productId,
        name: l.name,
        soldBy: l.soldBy,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        fixedTotal: l.fixedTotal,
        taxRateBps: l.taxRateBps,
        snapEligible: l.snapEligible,
        depositPerUnit: l.depositPerUnit,
        discount: l.discount,
        overrideReason: l.overrideReason,
      })),
      payments: payments.map((p) => ({
        tenderType: p.tenderType,
        amountCents: p.amountCents,
        tenderedCents: p.tenderedCents,
        changeCents: p.changeCents,
        cardBrand: p.cardBrand,
        last4: p.last4,
        authCode: p.authCode,
      })),
      customerId: customer?.id,
    };

    let receiptData: ReceiptData;

    try {
      if (!isOnline) throw new Error('Offline mode active');
      const res = await api<{
        sale: { id: string; saleNumber: string; completedAt: string };
        store: { name: string; address: string; fnsNumber: string };
      }>('/sales', { method: 'POST', json: payload });

      receiptData = {
        saleNumber: res.sale.saleNumber,
        completedAt: res.sale.completedAt,
        store: res.store,
        registerName: 'Lane 1',
        cashierName: user.name,
        customer: customer
          ? {
              name: customer.name,
              phone: customer.phone,
              points: customer.points,
              earnedPoints: Math.floor(finalTotal / 100),
            }
          : undefined,
        lines: saleLines.map((l) => ({
          name: l.name,
          soldBy: l.soldBy,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          fixedTotal: l.fixedTotal,
          taxRateBps: l.taxRateBps,
          snapEligible: l.snapEligible,
          depositPerUnit: l.depositPerUnit,
          discount: l.discount,
          promoName: l.promoName,
          isOverridden: l.isOverridden,
          overrideReason: l.overrideReason,
          lineTotal: lineNet(l),
        })),
        totals: {
          subtotal: totals.subtotal,
          deposits: totals.deposits,
          tax: effectiveTax,
          total: finalTotal,
          snapPaid: snapTenderPaid,
          snapEligible: totals.snapEligibleTotal,
        },
        payments,
      };
    } catch {
      // Fallback to local offline storage
      const offlineSaleNumber = `OFFLINE-${Date.now().toString(36).toUpperCase()}`;
      const localRecord: OfflineSalePayload = {
        id: crypto.randomUUID(),
        offlineSaleNumber,
        createdAt: new Date().toISOString(),
        ...payload,
      };
      await queueOfflineSale(localRecord);
      setPendingSyncCount((c) => c + 1);

      receiptData = {
        saleNumber: offlineSaleNumber,
        completedAt: localRecord.createdAt,
        store: {
          name: 'Fresh Market Supermarket',
          address: '100 Main St, Springfield, MA',
          fnsNumber: '1234567',
        },
        registerName: 'Lane 1 (Offline)',
        cashierName: user.name,
        customer: customer
          ? {
              name: customer.name,
              phone: customer.phone,
              points: customer.points,
              earnedPoints: Math.floor(finalTotal / 100),
            }
          : undefined,
        lines: saleLines.map((l) => ({
          name: l.name,
          soldBy: l.soldBy,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          fixedTotal: l.fixedTotal,
          taxRateBps: l.taxRateBps,
          snapEligible: l.snapEligible,
          depositPerUnit: l.depositPerUnit,
          discount: l.discount,
          promoName: l.promoName,
          isOverridden: l.isOverridden,
          overrideReason: l.overrideReason,
          lineTotal: lineNet(l),
        })),
        totals: {
          subtotal: totals.subtotal,
          deposits: totals.deposits,
          tax: effectiveTax,
          total: finalTotal,
          snapPaid: snapTenderPaid,
          snapEligible: totals.snapEligibleTotal,
        },
        payments,
      };
      notify('Sale completed offline and queued for cloud sync.', false);
    }

    setShowPayment(false);
    setReceipt(receiptData);
    setLines([]);
    setSelected(null);
    setCustomer(null);

    broadcastCFD({
      type: 'complete',
      saleNumber: receiptData.saleNumber,
      storeName: 'Fresh Market Supermarket',
      total: finalTotal,
      changeGiven: payments.reduce((s, p) => s + (p.changeCents || 0), 0),
      customer: customer
        ? {
            name: customer.name,
            points: customer.points,
            earnedPoints: Math.floor(finalTotal / 100),
          }
        : undefined,
    });
  }

  function handleNewSale() {
    setReceipt(null);
    setLines([]);
    setSelected(null);
    setCustomer(null);
    broadcastCFD({
      type: 'idle',
      storeName: 'Fresh Market Supermarket',
      registerName: 'Lane 1',
    });
    focusScan();
  }

  function logout() {
    session.clear('lane');
    nav('/lane/login');
  }

  function parkCurrentCart() {
    if (activeLines.length === 0) return;
    const newParked: ParkedOrder = {
      id: `parked-${Date.now()}`,
      parkedAt: new Date().toISOString(),
      cashierName: user.name,
      customer,
      lines: activeLines,
      itemCount,
      totalCents: totals.total,
    };
    setParkedOrders((prev) => [newParked, ...prev]);
    setLines([]);
    setSelected(null);
    setCustomer(null);
    notify(`Ticket parked with ${newParked.itemCount} items.`);
    focusScan();
  }

  function handleResumeParked(order: ParkedOrder) {
    if (activeLines.length > 0) {
      if (!window.confirm('Current cart has items. Would you like to park the current cart before resuming?')) {
        return;
      }
      parkCurrentCart();
    }
    setLines(order.lines);
    setCustomer(order.customer);
    setSelected(null);
    setParkedOrders((prev) => prev.filter((p) => p.id !== order.id));
    setShowParkedModal(false);
    notify(`Resumed ticket for ${order.customer?.name ?? 'Walk-in Customer'}.`);
    focusScan();
  }

  function handleDiscardParked(orderId: string) {
    setParkedOrders((prev) => prev.filter((p) => p.id !== orderId));
    notify('Parked ticket discarded.');
  }

  function handleAddManualLine(line: CartLine) {
    setLines((prev) => [...prev, line]);
    notify(`Added ${line.name} (${formatCents(line.unitPrice)}).`);
    focusScan();
  }

  const selectedLine = activeLines.find((l) => l.id === selected);

  return (
    <main className="lane">
      <header className="glass lane-header">
        <div className="logo lane-header-brand">
          <div className="logo-mark">F</div>
          FreshPOS <span className="muted lane-tag" style={{ fontWeight: 500, fontSize: '.9rem' }}>· Lane 1</span>
        </div>
        <div className="lane-header-actions" style={{ display: 'flex', alignItems: 'center' }}>
          {/* Connectivity badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.8rem' }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: isOnline ? 'var(--brand)' : 'var(--warn)',
                boxShadow: isOnline ? '0 0 8px var(--brand-glow)' : 'none',
              }}
            />
            <span className="muted">{isOnline ? 'Online' : 'Offline'}</span>
            {pendingSyncCount > 0 && (
              <span className="badge badge-age" title="Unsynced offline transactions waiting to upload">
                {pendingSyncCount} queued
              </span>
            )}
          </div>

          {/* Launch Customer-Facing Display (CFD) in secondary window or tab */}
          <button
            id="open-cfd-btn"
            type="button"
            className="btn btn-sm"
            onClick={() =>
              window.open(
                '/cfd?lane=1',
                '_blank',
              )
            }
            title="Open Customer-Facing Display for Lane 1 in a new tab"
          >
            🖥️ CFD
          </button>

          {/* Employee Time Clock */}
          <button
            id="lane-clock-btn"
            type="button"
            className="btn btn-sm"
            onClick={() => setShowTimeClockModal(true)}
            title="Employee Time Clock (Punch In / Out)"
          >
            ⏱️ Clock
          </button>

          {/* Suspend / Park Ticket */}
          <button
            id="lane-park-btn"
            type="button"
            className="btn btn-sm"
            onClick={activeLines.length > 0 ? parkCurrentCart : () => setShowParkedModal(true)}
            title={activeLines.length > 0 ? 'Suspend/Park current ticket' : 'View parked tickets'}
          >
            ⏸️ {activeLines.length > 0 ? 'Park' : 'Parked'}
            {parkedOrders.length > 0 && (
              <span className="badge badge-snap" style={{ fontSize: '.75rem', padding: '.1rem .35rem', marginLeft: '.2rem' }}>
                {parkedOrders.length}
              </span>
            )}
          </button>

          {/* Cash Drawer & Shift Management Button */}
          <button
            id="drawer-shift-btn"
            type="button"
            className="btn btn-sm"
            onClick={() => setShowShiftModal(true)}
          >
            💵 Shift
          </button>

          {/* Customer Returns & Refunds Button */}
          <button
            id="return-btn"
            type="button"
            className="btn btn-sm"
            style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}
            onClick={() => setShowReturnModal(true)}
          >
            ↩️ Return
          </button>

          <span className="muted cashier-name">
            {user.name}
          </span>
          <button id="logout" className="btn btn-sm" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <section className="glass lane-cart">
        {/* Customer Loyalty Banner */}
        <div className="loyalty-banner" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.45rem .85rem', background: 'var(--surface)', borderRadius: '8px', border: '1px solid var(--border)' }}>
          {customer ? (
            <div className="loyalty-info" style={{ display: 'flex', alignItems: 'center', gap: '.6rem', fontSize: '.85rem', flexWrap: 'wrap' }}>
              <span className="badge badge-snap" style={{ fontSize: '.75rem', padding: '.2rem .4rem' }}>★ MEMBER</span>
              <span style={{ fontWeight: 600 }}>{customer.name}</span>
              <span className="muted">({customer.phone})</span>
              <span style={{ color: 'var(--brand)', fontWeight: 600 }}>{customer.points} pts</span>
              <span className="muted hide-mobile" style={{ fontSize: '.8rem' }}>+{Math.floor(totals.total / 100)} pts this order</span>
            </div>
          ) : (
            <div className="loyalty-info" style={{ display: 'flex', alignItems: 'center', gap: '.5rem', fontSize: '.85rem', color: 'var(--muted)', flexWrap: 'wrap' }}>
              <span>👤 No loyalty member</span>
              <span className="hide-mobile" style={{ fontSize: '.75rem' }}>(Earn 1 pt per $1)</span>
            </div>
          )}
          <div style={{ display: 'flex', gap: '.4rem', flexShrink: 0 }}>
            {customer ? (
              <button type="button" className="btn btn-sm" style={{ fontSize: '.75rem', padding: '.2rem .5rem' }} onClick={() => setCustomer(null)}>
                Detach
              </button>
            ) : (
              <button
                id="add-loyalty-btn"
                type="button"
                className="btn btn-primary btn-sm"
                style={{ fontSize: '.8rem', padding: '.3rem .6rem' }}
                onClick={() => setShowLoyaltyModal(true)}
              >
                + Member
              </button>
            )}
          </div>
        </div>

        <form className="scan-bar" onSubmit={(e) => e.preventDefault()}>
          <div className="scan-input-wrapper">
            <input
              id="scan-input"
              ref={scanRef}
              className="input"
              placeholder="Scan barcode, PLU, or search items..."
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={handleInputKeyDown}
              onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
              autoComplete="off"
            />

            {/* Live Autocomplete Dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <div ref={dropdownRef} className="autocomplete-dropdown" id="autocomplete-dropdown">
                {suggestions.map((p, idx) => (
                  <div
                    key={p.id}
                    className={`autocomplete-item ${idx === selectedIndex ? 'active' : ''}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelectProduct(p);
                    }}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <div>
                      <div className="item-title">
                        {p.name}
                        {p.brand && (
                          <span className="muted" style={{ fontWeight: 400, marginLeft: '.5rem', fontSize: '.85rem' }}>
                            {p.brand}
                          </span>
                        )}
                      </div>
                      <div className="item-sub">
                        <span>{p.department?.name || 'Grocery'}</span>
                        {p.plu && <span className="mono badge badge-muted">PLU {p.plu}</span>}
                        {p.barcodes && p.barcodes[0] && (
                          <span className="mono badge badge-muted">UPC {p.barcodes[0].code.replace(/^0+/, '')}</span>
                        )}
                        {p.snapEligible && <span className="badge badge-snap">SNAP</span>}
                        {p.minAge && <span className="badge badge-age">{p.minAge}+</span>}
                      </div>
                    </div>
                    <div className="item-price">
                      {formatCents(p.price)}
                      {p.soldBy === 'weight' && <span className="muted" style={{ fontSize: '.8rem', fontWeight: 500 }}>/lb</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            className="btn btn-primary scan-enter-btn"
            type="button"
            onClick={() => {
              if (showSuggestions && selectedIndex >= 0 && suggestions[selectedIndex]) {
                handleSelectProduct(suggestions[selectedIndex]);
              } else {
                scan(code);
              }
            }}
          >
            Enter
          </button>

          <button
            id="open-ring-btn"
            type="button"
            className="btn btn-sm"
            style={{ borderColor: 'var(--brand)', color: 'var(--brand)', whiteSpace: 'nowrap', padding: '.65rem .85rem' }}
            onClick={() => setShowOpenRingModal(true)}
            title="Manual Department / Open Ring"
          >
            🏷️ Open Ring
          </button>
        </form>

        {activeLines.length === 0 ? (
          <div className="empty-cart">
            <div style={{ maxWidth: 480 }}>
              <h2 style={{ fontSize: '1.4rem', marginBottom: '.6rem' }}>Ready to Scan</h2>
              <p className="muted" style={{ margin: '0 0 1.25rem 0', fontSize: '.95rem' }}>
                Scan barcodes, enter PLUs, or type to search. Try these supermarket demo deals:
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.6rem' }}>
                <button type="button" className="btn" style={{ fontSize: '.85rem', justifyContent: 'flex-start', borderColor: 'var(--brand)', color: 'var(--brand)' }} onClick={() => setShowOpenRingModal(true)}>
                  🏷️ Manual Dept Ring ($)
                </button>
                {parkedOrders.length > 0 ? (
                  <button type="button" className="btn btn-primary" style={{ fontSize: '.85rem', justifyContent: 'flex-start' }} onClick={() => setShowParkedModal(true)}>
                    ⏸️ Resume Parked ({parkedOrders.length})
                  </button>
                ) : (
                  <button type="button" className="btn" style={{ fontSize: '.85rem', justifyContent: 'flex-start' }} onClick={() => scan('4046')}>
                    🥑 Avocados (2 for $2 promo!)
                  </button>
                )}
                <button type="button" className="btn" style={{ fontSize: '.85rem', justifyContent: 'flex-start' }} onClick={() => scan('070000000010')}>
                  🥛 Whole Milk 1 Gal ($3.99)
                </button>
                <button type="button" className="btn" style={{ fontSize: '.85rem', justifyContent: 'flex-start' }} onClick={() => scan('212345005996')}>
                  🥩 Deli Turkey ($5.99 tag)
                </button>
                <button type="button" className="btn" style={{ fontSize: '.85rem', justifyContent: 'flex-start' }} onClick={() => scan('070000000065')}>
                  🍺 Craft IPA (21+ check)
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="cart-lines" id="cart-lines">
            {activeLines.map((l) => (
              <div
                key={l.id}
                className={`cart-line ${l.id === selected ? 'selected' : ''} ${l.voided ? 'voided' : ''}`}
                onClick={() => setSelected(l.id)}
              >
                <div>
                  <div className="name" style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
                    <span>{l.name}</span>
                    {l.isOverridden && (
                      <span className="badge badge-age" title={`Authorized by ${l.overrideSupervisor}: ${l.overrideReason}`}>
                        🔒 OVERRIDE ({l.overrideReason})
                      </span>
                    )}
                    {l.promoName && (
                      <span className="badge badge-snap" title="Automatic multi-buy store promotion">
                        🏷️ {l.promoName} (-{formatCents(l.discount || 0)})
                      </span>
                    )}
                  </div>
                  <div className="meta">
                    {l.fixedTotal !== undefined
                      ? 'Priced item'
                      : l.soldBy === 'weight'
                      ? `${(l.quantity / 1000).toFixed(3)} lb @ ${formatCents(l.unitPrice)}/lb`
                      : `${l.quantity} × ${formatCents(l.unitPrice)}`}
                    {l.originalUnitPrice && l.originalUnitPrice !== l.unitPrice && (
                      <span style={{ textDecoration: 'line-through', opacity: 0.6 }}>
                        orig {formatCents(l.originalUnitPrice)}
                      </span>
                    )}
                    {l.snapEligible && <span className="badge badge-snap">SNAP</span>}
                    {l.taxRateBps > 0 && <span className="badge badge-muted">T</span>}
                    {l.depositPerUnit ? <span className="badge badge-muted">+{formatCents(l.depositPerUnit * l.quantity)} dep</span> : null}
                  </div>
                </div>
                <div />
                <div className="amount" style={{ textAlign: 'right' }}>
                  {formatCents(lineNet(l))}
                  {l.discount && l.discount > 0 ? (
                    <div className="muted" style={{ fontSize: '.75rem', color: 'var(--brand)' }}>
                      save {formatCents(l.discount)}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <aside className="lane-side">
        <section className="glass totals" aria-label="Totals">
          <div className="row"><span>Items</span><span>{itemCount}</span></div>
          <div className="row"><span>Subtotal</span><span>{formatCents(totals.subtotal)}</span></div>
          {totals.discounts > 0 && (
            <div className="row" style={{ color: 'var(--brand)' }}>
              <span>Savings / Discounts</span>
              <span>-{formatCents(totals.discounts)}</span>
            </div>
          )}
          {totals.deposits > 0 && <div className="row"><span>Deposits</span><span>{formatCents(totals.deposits)}</span></div>}
          <div className="row"><span>Tax</span><span>{formatCents(totals.tax)}</span></div>
          <div className="row" style={{ color: 'var(--snap)' }}>
            <span>SNAP eligible</span>
            <span>{formatCents(totals.snapEligibleTotal)}</span>
          </div>
          <div className="row grand">
            <span>Total</span>
            <span id="grand-total">{formatCents(totals.total)}</span>
          </div>
        </section>

        <section className="glass actions">
          <button id="qty-minus" className="btn" onClick={() => changeQty(-1)} disabled={!selected}>− Qty</button>
          <button id="qty-plus" className="btn" onClick={() => changeQty(1)} disabled={!selected}>+ Qty</button>

          {/* Supervisor Price Override button */}
          <button
            id="override-price-btn"
            className="btn"
            style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}
            onClick={() => {
              if (!selectedLine) return;
              setOverrideModal({ type: 'price_override', line: selectedLine });
            }}
            disabled={!selected}
          >
            🔒 Override Price
          </button>

          {/* Supervisor Line Discount button */}
          <button
            id="line-discount-btn"
            className="btn"
            onClick={() => {
              if (!selectedLine) return;
              setOverrideModal({ type: 'line_discount', line: selectedLine });
            }}
            disabled={!selected}
          >
            % Line Discount
          </button>

          <button id="void-line" className="btn btn-danger" onClick={voidSelected} disabled={!selected}>
            Void line
          </button>

          {/* Void Ticket / Clear Sale with supervisor protection */}
          <button
            id="clear-sale"
            className="btn btn-danger"
            onClick={() => {
              if (activeLines.length > 0) {
                setOverrideModal({ type: 'void_transaction' });
              } else {
                setLines([]);
                setSelected(null);
              }
            }}
            disabled={!activeLines.length}
          >
            Void Ticket
          </button>

          {/* Suspend / Park Current Cart */}
          <button
            id="park-ticket-btn"
            className="btn"
            onClick={activeLines.length > 0 ? parkCurrentCart : () => setShowParkedModal(true)}
            title={activeLines.length > 0 ? 'Suspend/Park current ticket' : 'View suspended tickets'}
          >
            ⏸️ {activeLines.length > 0 ? 'Park Ticket' : 'View Parked'}
            {parkedOrders.length > 0 && (
              <span className="badge badge-snap" style={{ marginLeft: '.4rem' }}>
                {parkedOrders.length}
              </span>
            )}
          </button>

          <button
            id="pay"
            className="btn btn-primary btn-lg wide"
            disabled={!activeLines.length}
            onClick={() => setShowPayment(true)}
          >
            Pay {formatCents(totals.total)}
          </button>
        </section>
      </aside>

      {/* Mobile Floating Bottom Bar with Drawer and Quick Actions */}
      <div className="mobile-bottom-wrap">
        {selectedLine && (
          <div className="mobile-line-actions">
            <span className="mobile-line-name" title={selectedLine.name}>
              {selectedLine.name}
            </span>
            <div className="mobile-line-btns">
              <button className="btn btn-sm" onClick={() => changeQty(-1)} title="Decrease quantity">
                − Qty
              </button>
              <button className="btn btn-sm" onClick={() => changeQty(1)} title="Increase quantity">
                + Qty
              </button>
              <button
                className="btn btn-sm"
                style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}
                onClick={() => setOverrideModal({ type: 'price_override', line: selectedLine })}
                title="Supervisor price override"
              >
                🔒 Price
              </button>
              <button
                className="btn btn-sm"
                onClick={() => setOverrideModal({ type: 'line_discount', line: selectedLine })}
                title="Supervisor line discount"
              >
                % Disc
              </button>
              <button className="btn btn-danger btn-sm" onClick={voidSelected} title="Void selected item">
                ✕ Void
              </button>
              <button className="btn btn-sm" onClick={() => setSelected(null)} title="Deselect">
                Done
              </button>
            </div>
          </div>
        )}

        {showMobileTotals && (
          <div className="mobile-totals-sheet">
            <div className="totals-sheet-header">
              <span style={{ fontWeight: 600, fontSize: '.95rem' }}>Bill Breakdown</span>
              <button
                type="button"
                className="btn btn-sm"
                style={{ padding: '.2rem .5rem', fontSize: '.75rem' }}
                onClick={() => setShowMobileTotals(false)}
              >
                ✕ Close
              </button>
            </div>
            <div className="totals-sheet-rows">
              <div className="row">
                <span>Items</span>
                <span>{itemCount}</span>
              </div>
              <div className="row">
                <span>Subtotal</span>
                <span>{formatCents(totals.subtotal)}</span>
              </div>
              {totals.discounts > 0 && (
                <div className="row" style={{ color: 'var(--brand)' }}>
                  <span>Savings / Discounts</span>
                  <span>-{formatCents(totals.discounts)}</span>
                </div>
              )}
              {totals.deposits > 0 && (
                <div className="row">
                  <span>Bottle Deposits</span>
                  <span>{formatCents(totals.deposits)}</span>
                </div>
              )}
              <div className="row">
                <span>Sales Tax</span>
                <span>{formatCents(totals.tax)}</span>
              </div>
              {totals.snapEligibleTotal > 0 && (
                <div className="row" style={{ color: 'var(--snap)' }}>
                  <span>SNAP eligible</span>
                  <span>{formatCents(totals.snapEligibleTotal)}</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="mobile-checkout-bar">
          <div className="mobile-summary-tap" onClick={() => setShowMobileTotals((v) => !v)}>
            <div className="mobile-grand-price">{formatCents(totals.total)}</div>
            <div className="mobile-grand-sub">
              <span className="muted">{itemCount} items</span>
              <span className="breakdown-toggle">
                {showMobileTotals ? 'Hide breakdown ▲' : 'Details ▼'}
              </span>
            </div>
          </div>
          <button
            id="mobile-pay-btn"
            className="btn btn-primary btn-lg mobile-pay-btn"
            disabled={!activeLines.length}
            onClick={() => setShowPayment(true)}
          >
            Pay {formatCents(totals.total)}
          </button>
        </div>
      </div>

      {/* Produce Scale Weight Modal */}
      {weighFor && (
        <div className="modal-backdrop" onClick={() => setWeighFor(null)}>
          <form className="glass modal" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); confirmWeight(); }}>
            <h2>{weighFor.name}</h2>
            <span className="muted">{formatCents(weighFor.price)} / lb · place item on scale or enter weight</span>
            <input
              id="weight-input"
              className="input mono"
              autoFocus
              inputMode="decimal"
              placeholder="0.000 lb"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
            <button className="btn btn-primary btn-lg" type="submit">
              Add {weight && parseFloat(weight) > 0 ? formatCents(Math.round(weighFor.price * parseFloat(weight))) : ''}
            </button>
          </form>
        </div>
      )}

      {/* 21+ Age Check Modal */}
      {ageFor && (
        <div className="modal-backdrop">
          <div className="glass modal">
            <h2>Age check required</h2>
            <p className="muted" style={{ margin: 0 }}>
              {ageFor.p.name} requires the customer to be <b style={{ color: 'var(--warn)' }}>{ageFor.p.minAge}+</b>. Verify a valid photo ID.
            </p>
            <p className="mono" style={{ margin: 0 }}>
              Born on or before: {new Date(new Date().setFullYear(new Date().getFullYear() - ageFor.p.minAge!)).toLocaleDateString()}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.6rem' }}>
              <button id="age-deny" className="btn btn-danger" onClick={() => { setAgeFor(null); focusScan(); }}>
                Refuse
              </button>
              <button id="age-ok" className="btn btn-primary" onClick={() => { addLine(ageFor.p, ageFor.parsed); setAgeFor(null); }}>
                ID verified
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Supervisor Override Modal (Price, Discount, or Ticket Void) */}
      {overrideModal && (
        <SupervisorOverrideModal
          type={overrideModal.type}
          itemName={overrideModal.line?.name}
          currentPriceCents={overrideModal.line ? lineGross(overrideModal.line) : undefined}
          onClose={() => { setOverrideModal(null); focusScan(); }}
          onApproved={(res) => {
            if (overrideModal.type === 'void_transaction') {
              setLines([]);
              setSelected(null);
              setCustomer(null);
              setOverrideModal(null);
              notify(`Ticket voided by ${res.supervisorName} (${res.reason}).`);
              focusScan();
            } else if (overrideModal.type === 'price_override' && overrideModal.line) {
              setLines((ls) =>
                ls.map((l) =>
                  l.id === overrideModal.line!.id
                    ? {
                        ...l,
                        unitPrice: res.newPriceCents!,
                        originalUnitPrice: l.unitPrice,
                        isOverridden: true,
                        overrideReason: res.reason,
                        overrideSupervisor: res.supervisorName,
                        promoName: undefined,
                        discount: undefined,
                      }
                    : l,
                ),
              );
              setOverrideModal(null);
              notify(`Price override approved by ${res.supervisorName}.`);
              focusScan();
            } else if (overrideModal.type === 'line_discount' && overrideModal.line) {
              setLines((ls) =>
                ls.map((l) =>
                  l.id === overrideModal.line!.id
                    ? {
                        ...l,
                        discount: res.discountCents!,
                        isOverridden: true,
                        overrideReason: res.reason,
                        overrideSupervisor: res.supervisorName,
                        promoName: undefined,
                      }
                    : l,
                ),
              );
              setOverrideModal(null);
              notify(`Line discount approved by ${res.supervisorName}.`);
              focusScan();
            }
          }}
        />
      )}

      {/* Customer Loyalty Modal */}
      {showLoyaltyModal && (
        <LoyaltyModal
          currentCustomer={customer}
          onClose={() => { setShowLoyaltyModal(false); focusScan(); }}
          onSelectCustomer={(c) => {
            setCustomer(c);
            setShowLoyaltyModal(false);
            if (c) notify(`Loyalty member attached: ${c.name} (${c.points} pts)`);
            focusScan();
          }}
        />
      )}

      {/* Cash Drawer & Shift Operations Modal */}
      {showShiftModal && (
        <ShiftModal
          currentShift={currentShift}
          onClose={() => { setShowShiftModal(false); focusScan(); }}
          onShiftUpdated={fetchCurrentShift}
          onShiftClosed={(report) => {
            setShowShiftModal(false);
            setZReport(report);
            fetchCurrentShift();
            notify('Shift closed successfully. Official Z-Report ready.');
          }}
        />
      )}

      {/* Customer Returns & Refunds Modal */}
      {showReturnModal && (
        <ReturnModal
          onClose={() => { setShowReturnModal(false); focusScan(); }}
          onRefundCompleted={(refundReceipt) => {
            setShowReturnModal(false);
            setReceipt(refundReceipt);
            fetchCurrentShift();
            notify(`Refund ${refundReceipt.saleNumber} processed successfully.`);
            broadcastCFD({
              type: 'complete',
              saleNumber: refundReceipt.saleNumber,
              storeName: refundReceipt.store.name,
              total: refundReceipt.totals.total,
              changeGiven: 0,
            });
          }}
        />
      )}

      {/* Official End-of-Day Z-Report Modal */}
      {zReport && (
        <ZReportModal
          zReport={zReport}
          onClose={() => setZReport(null)}
        />
      )}

      {/* Payment Tender Modal */}
      {showPayment && (
        <PaymentModal
          lines={activeLines.filter((l) => !l.voided)}
          baseTotals={totals}
          onClose={() => { setShowPayment(false); focusScan(); }}
          onFinalize={handleFinalizePayment}
        />
      )}

      {/* Digital & Printable Receipt Modal */}
      {receipt && (
        <ReceiptModal
          receipt={receipt}
          onNewSale={handleNewSale}
        />
      )}

      {/* Suspended / Parked Orders Modal */}
      {showParkedModal && (
        <ParkedModal
          parkedOrders={parkedOrders}
          onClose={() => { setShowParkedModal(false); focusScan(); }}
          onResume={handleResumeParked}
          onDiscard={handleDiscardParked}
        />
      )}

      {/* Manual Department / Open Ring Modal */}
      {showOpenRingModal && (
        <OpenRingModal
          onClose={() => { setShowOpenRingModal(false); focusScan(); }}
          onAddLine={handleAddManualLine}
        />
      )}

      {/* Employee Time Clock Modal */}
      {showTimeClockModal && (
        <TimeClockModal
          tenant={user.tenantId ?? 'demo'}
          storeId={user.storeId ?? ''}
          defaultEmployeeNo={user.employeeNo ?? ''}
          onClose={() => { setShowTimeClockModal(false); focusScan(); }}
          onSuccess={(msg) => notify(msg)}
        />
      )}

      {toast && <div className={`toast ${toast.err ? 'err' : ''}`}>{toast.msg}</div>}
    </main>
  );
}
