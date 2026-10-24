import type { Cents } from '@freshpos/shared';

export interface CFDLine {
  id: string;
  name: string;
  soldBy: 'each' | 'weight';
  quantity: number;
  unitPrice: Cents;
  fixedTotal?: Cents;
  taxRateBps: number;
  snapEligible: boolean;
  depositPerUnit?: Cents;
  discount?: Cents;
  promoName?: string;
  isOverridden?: boolean;
  overrideReason?: string;
  lineTotal: Cents;
}

export interface CFDTotals {
  itemCount: number;
  subtotal: Cents;
  discounts: Cents;
  deposits: Cents;
  tax: Cents;
  total: Cents;
  snapEligibleTotal: Cents;
}

export type CFDState =
  | {
      type: 'idle';
      storeName: string;
      registerName: string;
      promoMessages?: string[];
    }
  | {
      type: 'cart';
      storeName: string;
      registerName: string;
      cashierName: string;
      customer?: {
        name: string;
        phone: string;
        points: number;
        earnedPoints?: number;
      };
      lines: CFDLine[];
      lastScanned?: {
        name: string;
        quantityStr: string;
        priceStr: string;
        promoDiscount?: string;
      };
      totals: CFDTotals;
    }
  | {
      type: 'payment';
      storeName: string;
      registerName: string;
      tenderType: string;
      totalDue: Cents;
      amountPaid: Cents;
      remainingDue: Cents;
    }
  | {
      type: 'complete';
      saleNumber: string;
      storeName: string;
      total: Cents;
      changeGiven: Cents;
      customer?: {
        name: string;
        points: number;
        earnedPoints: number;
      };
    };

const CFD_CHANNEL = 'freshpos_cfd_channel';
const CFD_STORAGE_KEY = 'freshpos_cfd_state';

let channel: BroadcastChannel | null = null;
try {
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(CFD_CHANNEL);
  }
} catch {
  // BroadcastChannel not available in environment
}

export function broadcastCFD(state: CFDState) {
  try {
    localStorage.setItem(CFD_STORAGE_KEY, JSON.stringify(state));
    channel?.postMessage(state);
  } catch {
    // Local storage or broadcast failed
  }
}

export function subscribeCFD(callback: (state: CFDState) => void): () => void {
  // Get initial state if present
  try {
    const raw = localStorage.getItem(CFD_STORAGE_KEY);
    if (raw) {
      callback(JSON.parse(raw));
    }
  } catch {
    // Ignore parse error
  }

  const handleMessage = (e: MessageEvent) => {
    if (e.data) {
      callback(e.data);
    }
  };

  const handleStorage = (e: StorageEvent) => {
    if (e.key === CFD_STORAGE_KEY && e.newValue) {
      try {
        callback(JSON.parse(e.newValue));
      } catch {
        // Ignore parse error
      }
    }
  };

  channel?.addEventListener('message', handleMessage);
  window.addEventListener('storage', handleStorage);

  return () => {
    channel?.removeEventListener('message', handleMessage);
    window.removeEventListener('storage', handleStorage);
  };
}
