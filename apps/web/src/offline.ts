// Simple IndexedDB-backed offline sales queue for grocery lanes

export interface OfflineSalePayload {
  id: string; // local client UUID
  offlineSaleNumber: string;
  createdAt: string;
  lines: Array<{
    productId: string;
    name: string;
    soldBy: 'each' | 'weight';
    quantity: number;
    unitPrice: number;
    fixedTotal?: number;
    taxRateBps: number;
    snapEligible: boolean;
    depositPerUnit?: number;
    discount?: number;
  }>;
  payments: Array<{
    tenderType: 'cash' | 'card' | 'ebt_snap' | 'ebt_cash';
    amountCents: number;
    tenderedCents?: number;
    changeCents?: number;
    cardBrand?: string;
    last4?: string;
    authCode?: string;
  }>;
}

const DB_NAME = 'freshpos_lane_db';
const STORE_NAME = 'offline_sales';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function queueOfflineSale(sale: OfflineSalePayload): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(sale);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPendingOfflineSales(): Promise<OfflineSalePayload[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function removeOfflineSale(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
