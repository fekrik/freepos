import { applyBps, roundCents, type Cents } from './money.js';

export type SoldBy = 'each' | 'weight';

export interface CartLine {
  id: string;
  productId: string;
  name: string;
  soldBy: SoldBy;
  /** Units for 'each', or thousandths of a lb for 'weight'. */
  quantity: number;
  /** Price per unit or per lb, in cents. */
  unitPrice: Cents;
  /** If set (price-embedded barcode), overrides quantity * unitPrice. */
  fixedTotal?: Cents;
  taxRateBps: number;
  snapEligible: boolean;
  /** Bottle deposit per unit (CRV etc.) - never taxed, never SNAP-eligible in most states. */
  depositPerUnit?: Cents;
  discount?: Cents;
  voided?: boolean;

  /** Supervisor price/discount override metadata */
  isOverridden?: boolean;
  overrideReason?: string;
  overrideSupervisor?: string;
  originalUnitPrice?: Cents;

  /** Automatic promotional deal metadata */
  promoName?: string;
}

export interface PromotionRule {
  id: string;
  name: string;
  productId?: string;
  productNameIncludes?: string;
  type: 'multi_buy' | 'bogo_pct';
  qualifyingQty: number;
  dealPriceCents?: Cents;
  discountPct?: number;
}

export const DEMO_PROMOTIONS: PromotionRule[] = [
  {
    id: 'promo-avocados',
    name: 'Avocados: 2 for $2.00',
    productNameIncludes: 'Avocado',
    type: 'multi_buy',
    qualifyingQty: 2,
    dealPriceCents: 200,
  },
  {
    id: 'promo-soda',
    name: 'Cola 12pk: 3 for $18.00',
    productNameIncludes: 'Cola',
    type: 'multi_buy',
    qualifyingQty: 3,
    dealPriceCents: 1800,
  },
  {
    id: 'promo-bread',
    name: 'Bread: Buy 2 Get 1 Free',
    productNameIncludes: 'Bread',
    type: 'multi_buy',
    qualifyingQty: 3,
  },
];

/**
 * Evaluates active promotions against non-overridden cart lines.
 * Applies multi-buy and volume discounts deterministically.
 */
export function applyPromotions(lines: CartLine[], promos: PromotionRule[] = DEMO_PROMOTIONS): CartLine[] {
  return lines.map((line) => {
    // Never overwrite an explicit manager/supervisor price or discount override
    if (line.isOverridden || line.voided || line.soldBy !== 'each' || line.fixedTotal !== undefined) {
      return line;
    }

    const matchingPromo = promos.find((p) => {
      if (p.productId && p.productId === line.productId) return true;
      if (p.productNameIncludes && line.name.toLowerCase().includes(p.productNameIncludes.toLowerCase())) return true;
      return false;
    });

    if (!matchingPromo) {
      // Remove any previously applied automated promotion if quantity no longer matches
      if (line.promoName) {
        const { promoName, discount, ...rest } = line;
        return rest as CartLine;
      }
      return line;
    }

    const bundles = Math.floor(line.quantity / matchingPromo.qualifyingQty);
    if (bundles <= 0) {
      if (line.promoName) {
        const { promoName, discount, ...rest } = line;
        return rest as CartLine;
      }
      return line;
    }

    let promoDiscount: Cents = 0;
    if (matchingPromo.type === 'multi_buy') {
      if (matchingPromo.dealPriceCents !== undefined) {
        const regularBundleCost = line.unitPrice * matchingPromo.qualifyingQty;
        const savingsPerBundle = Math.max(0, regularBundleCost - matchingPromo.dealPriceCents);
        promoDiscount = bundles * savingsPerBundle;
      } else {
        // e.g. Buy 2 Get 1 Free (pay for 2, 1 free in each bundle of 3)
        promoDiscount = bundles * line.unitPrice;
      }
    }

    if (promoDiscount > 0) {
      return {
        ...line,
        discount: promoDiscount,
        promoName: matchingPromo.name,
      };
    }

    return line;
  });
}

export function lineGross(line: CartLine): Cents {
  if (line.fixedTotal !== undefined) return line.fixedTotal;
  if (line.soldBy === 'weight') return roundCents((line.unitPrice * line.quantity) / 1000);
  return line.unitPrice * line.quantity;
}

export function lineNet(line: CartLine): Cents {
  return Math.max(0, lineGross(line) - (line.discount ?? 0));
}

export function lineDeposit(line: CartLine): Cents {
  return line.soldBy === 'each' ? (line.depositPerUnit ?? 0) * line.quantity : 0;
}

export interface CartTotals {
  subtotal: Cents;
  discounts: Cents;
  deposits: Cents;
  /** Tax if the whole order is paid with non-SNAP tenders. */
  tax: Cents;
  total: Cents;
  /** Max amount payable with SNAP (eligible items, untaxed). */
  snapEligibleTotal: Cents;
}

export function computeTotals(lines: CartLine[]): CartTotals {
  const active = lines.filter((l) => !l.voided);
  let subtotal = 0, discounts = 0, deposits = 0, tax = 0, snap = 0;
  for (const l of active) {
    const net = lineNet(l);
    subtotal += lineGross(l);
    discounts += l.discount ?? 0;
    deposits += lineDeposit(l);
    tax += applyBps(net, l.taxRateBps);
    if (l.snapEligible) snap += net;
  }
  return { subtotal, discounts, deposits, tax, total: subtotal - discounts + deposits + tax, snapEligibleTotal: snap };
}

/**
 * Federal SNAP rule (7 CFR 272.1): items bought with SNAP benefits may not be taxed.
 * Given a SNAP tender amount, recompute tax by forgiving tax on the SNAP-paid portion
 * of eligible items (allocated proportionally across eligible lines).
 */
export function taxAfterSnap(lines: CartLine[], snapPaid: Cents): Cents {
  const active = lines.filter((l) => !l.voided);
  const eligibleNet = active.filter((l) => l.snapEligible).reduce((s, l) => s + lineNet(l), 0);
  const snapApplied = Math.min(snapPaid, eligibleNet);
  let tax = 0;
  for (const l of active) {
    const net = lineNet(l);
    if (l.snapEligible && eligibleNet > 0) {
      const covered = (net / eligibleNet) * snapApplied;
      tax += applyBps(net - covered, l.taxRateBps);
    } else {
      tax += applyBps(net, l.taxRateBps);
    }
  }
  return tax;
}

