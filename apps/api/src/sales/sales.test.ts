import { describe, expect, it } from 'vitest';
import { computeTotals, taxAfterSnap, type CartLine } from '@freshpos/shared';

describe('Sales & Checkout Logic', () => {
  const milk: CartLine = {
    id: '1', productId: 'p1', name: 'Milk', soldBy: 'each', quantity: 1,
    unitPrice: 429, taxRateBps: 0, snapEligible: true,
  };
  const soda: CartLine = {
    id: '2', productId: 'p2', name: 'Cola 12pk', soldBy: 'each', quantity: 1,
    unitPrice: 749, taxRateBps: 700, snapEligible: true, depositPerUnit: 60,
  };
  const paperTowels: CartLine = {
    id: '3', productId: 'p3', name: 'Bounty Paper Towels', soldBy: 'each', quantity: 1,
    unitPrice: 1299, taxRateBps: 700, snapEligible: false,
  };

  it('calculates supermarket cart totals accurately', () => {
    const totals = computeTotals([milk, soda, paperTowels]);
    expect(totals.subtotal).toBe(429 + 749 + 1299); // 2477 cents ($24.77)
    expect(totals.deposits).toBe(60); // $0.60
    expect(totals.snapEligibleTotal).toBe(429 + 749); // 1178 cents ($11.78)
  });

  it('forgives sales tax on SNAP-tendered items according to federal USDA FNS rules', () => {
    // When paid with non-SNAP: taxable amount is soda ($7.49) + paper towels ($12.99) = $20.48 * 7% = $1.43
    const standardTax = taxAfterSnap([milk, soda, paperTowels], 0);
    expect(standardTax).toBe(143);

    // When all SNAP eligible items ($11.78) are paid with EBT SNAP:
    // Tax on soda ($7.49) is completely forgiven! Only paper towels ($12.99 * 7% = $0.91) is taxed.
    const snapTax = taxAfterSnap([milk, soda, paperTowels], 1178);
    expect(snapTax).toBe(91); // Exactly $0.91
  });
});
