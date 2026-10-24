/**
 * Money is always handled as integer cents to avoid floating point errors.
 */
export type Cents = number;

export function toCents(dollars: number): Cents {
  return Math.round(dollars * 100);
}

export function formatCents(cents: Cents, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

/** Banker-safe rounding of a fractional cent value (half away from zero). */
export function roundCents(value: number): Cents {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/** Multiply a cents amount by a rate expressed in basis points (1% = 100 bps). */
export function applyBps(amount: Cents, bps: number): Cents {
  return roundCents((amount * bps) / 10_000);
}
