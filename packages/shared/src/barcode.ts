import type { Cents } from './money.js';

export type ParsedBarcode =
  | { kind: 'product'; code: string }
  | { kind: 'plu'; plu: string }
  | { kind: 'price-embedded'; itemCode: string; price: Cents }
  | { kind: 'weight-embedded'; itemCode: string; weightThousandths: number }
  | { kind: 'invalid'; reason: string };

/** GS1 modulo-10 check digit for UPC-A / EAN-8 / EAN-13 / GTIN-14. */
export function gs1CheckDigit(body: string): number {
  let sum = 0;
  const digits = body.split('').reverse();
  digits.forEach((d, i) => {
    sum += Number(d) * (i % 2 === 0 ? 3 : 1);
  });
  return (10 - (sum % 10)) % 10;
}

export function isValidGtin(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  return gs1CheckDigit(code.slice(0, -1)) === Number(code.at(-1));
}

/** Normalise any GTIN to 14 digits so lookups are consistent. */
export function normalizeGtin(code: string): string {
  return code.padStart(14, '0');
}

export interface BarcodeOptions {
  /** How variable-measure (prefix 2) UPCs encode their value in this store. */
  variableMeasureMode: 'price' | 'weight';
}

/**
 * Parses scanner input.
 * - 4-5 digit codes are produce PLUs (5-digit starting with 9 = organic).
 * - UPC-A starting with "2" are variable-measure (deli/meat): 2 IIIII C VVVV K.
 */
export function parseBarcode(raw: string, opts: BarcodeOptions = { variableMeasureMode: 'price' }): ParsedBarcode {
  const code = raw.trim();
  if (/^\d{4,5}$/.test(code)) return { kind: 'plu', plu: code };
  if (!/^\d+$/.test(code)) return { kind: 'invalid', reason: 'Barcode must be numeric' };
  if (!isValidGtin(code)) return { kind: 'invalid', reason: 'Bad check digit' };

  if (code.length === 12 && code.startsWith('2')) {
    const itemCode = code.slice(1, 6);
    const value = Number(code.slice(7, 11));
    return opts.variableMeasureMode === 'price'
      ? { kind: 'price-embedded', itemCode, price: value }
      : { kind: 'weight-embedded', itemCode, weightThousandths: value * 10 };
  }
  return { kind: 'product', code: normalizeGtin(code) };
}
