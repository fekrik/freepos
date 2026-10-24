import { describe, expect, it } from 'vitest';
import { computeTotals, parseBarcode, taxAfterSnap, isValidGtin, gs1CheckDigit, type CartLine, hasPermission } from './index.js';

const milk: CartLine = { id: '1', productId: 'p1', name: 'Milk', soldBy: 'each', quantity: 2, unitPrice: 399, taxRateBps: 0, snapEligible: true };
const soda: CartLine = { id: '2', productId: 'p2', name: 'Soda 6pk', soldBy: 'each', quantity: 1, unitPrice: 599, taxRateBps: 700, snapEligible: true, depositPerUnit: 30 };
const soap: CartLine = { id: '3', productId: 'p3', name: 'Soap', soldBy: 'each', quantity: 1, unitPrice: 1000, taxRateBps: 700, snapEligible: false };
const apples: CartLine = { id: '4', productId: 'p4', name: 'Apples', soldBy: 'weight', quantity: 2500, unitPrice: 199, taxRateBps: 0, snapEligible: true };

describe('barcode', () => {
  it('validates UPC check digit', () => {
    expect(isValidGtin('036000291452')).toBe(true);
    expect(isValidGtin('036000291453')).toBe(false);
  });
  it('detects PLU', () => expect(parseBarcode('94011')).toEqual({ kind: 'plu', plu: '94011' }));
  it('parses price-embedded deli barcode', () => {
    // 2 12345 0 0599 K -> $5.99
    const body = '21234500599';
    const code = body + gs1CheckDigit(body);
    expect(parseBarcode(code)).toEqual({ kind: 'price-embedded', itemCode: '12345', price: 599 });
  });
});

describe('cart totals', () => {
  it('computes weight, deposits and tax', () => {
    const t = computeTotals([milk, soda, soap, apples]);
    expect(t.subtotal).toBe(798 + 599 + 1000 + 498);
    expect(t.deposits).toBe(30);
    expect(t.tax).toBe(42 + 70);
    expect(t.snapEligibleTotal).toBe(798 + 599 + 498);
  });
  it('forgives tax on SNAP-paid eligible items', () => {
    expect(taxAfterSnap([soda, soap], 599)).toBe(70);
    expect(taxAfterSnap([soda, soap], 0)).toBe(112);
  });
  it('ignores voided lines', () => {
    expect(computeTotals([{ ...soap, voided: true }]).total).toBe(0);
  });
});

describe('permissions', () => {
  it('cashier cannot refund', () => expect(hasPermission('cashier', 'sale.refund')).toBe(false));
  it('supervisor can refund', () => expect(hasPermission('supervisor', 'sale.refund')).toBe(true));
});

describe('promotions & multi-buy', () => {
  it('applies multi-buy discount on avocados (2 for $2.00, regular $1.29 each)', async () => {
    const { applyPromotions } = await import('./cart.js');
    const avoLine: CartLine = {
      id: 'a1',
      productId: 'p_avo',
      name: 'Hass Avocado',
      soldBy: 'each',
      quantity: 2,
      unitPrice: 129,
      taxRateBps: 0,
      snapEligible: true,
    };
    const [promoted] = applyPromotions([avoLine]);
    expect(promoted.discount).toBe(58); // 258 - 200 = 58
    expect(promoted.promoName).toContain('2 for $2.00');
  });

  it('preserves supervisor override and does not overwrite with automated promo', async () => {
    const { applyPromotions } = await import('./cart.js');
    const avoLine: CartLine = {
      id: 'a1',
      productId: 'p_avo',
      name: 'Hass Avocado',
      soldBy: 'each',
      quantity: 2,
      unitPrice: 50,
      taxRateBps: 0,
      snapEligible: true,
      isOverridden: true,
      overrideReason: 'Damaged item',
      overrideSupervisor: 'Sam Supervisor',
    };
    const [promoted] = applyPromotions([avoLine]);
    expect(promoted.unitPrice).toBe(50);
    expect(promoted.discount).toBeUndefined();
    expect(promoted.isOverridden).toBe(true);
  });
});

