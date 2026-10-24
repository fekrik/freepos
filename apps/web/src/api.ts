export interface Session {
  token: string;
  user: { sub: string; tenantId: string; role: string; name: string; storeId?: string; permissions: string[] };
}

export type SessionScope = 'lane' | 'admin';

export function getActiveScope(): SessionScope {
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')) {
    return 'admin';
  }
  return 'lane';
}

export const session = {
  get(scope?: SessionScope): Session | null {
    const s = scope ?? getActiveScope();
    const raw = localStorage.getItem(`freshpos.session.${s}`);
    if (raw) {
      try {
        return JSON.parse(raw) as Session;
      } catch {}
    }
    // Backward compatibility fallback to single key
    const legacy = localStorage.getItem('freshpos.session');
    if (legacy) {
      try {
        const parsed = JSON.parse(legacy) as Session;
        if ((s === 'admin' && parsed.user.role === 'admin') || (s === 'lane' && parsed.user.role !== 'admin')) {
          return parsed;
        }
      } catch {}
    }
    return null;
  },

  set(s: Session, scope?: SessionScope) {
    const targetScope = scope ?? (s.user.role === 'admin' || getActiveScope() === 'admin' ? 'admin' : 'lane');
    localStorage.setItem(`freshpos.session.${targetScope}`, JSON.stringify(s));
  },

  clear(scope?: SessionScope) {
    const targetScope = scope ?? getActiveScope();
    localStorage.removeItem(`freshpos.session.${targetScope}`);
  },

  can(perm: string, scope?: SessionScope) {
    return !!session.get(scope)?.user.permissions.includes(perm);
  },
};

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown; scope?: SessionScope } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  const s = session.get(init.scope);
  if (s) headers.Authorization = `Bearer ${s.token}`;
  if (init.json !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`/api${path}`, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
  if (res.status === 401 && s) session.clear(init.scope);
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) {
    const msg = typeof body?.message === 'string' ? body.message : body?.message?.fieldErrors ? 'Please check the form fields' : res.statusText;
    throw new ApiError(res.status, msg);
  }
  return body as T;
}

export interface Product {
  id: string; name: string; brand?: string | null; price: number; soldBy: 'each' | 'weight';
  snapEligible: boolean; wicEligible: boolean; minAge?: number | null; depositCents?: number | null; plu?: string | null;
  active: boolean; departmentId: string; taxClassId: string;
  department: { id: string; name: string }; taxClass: { id: string; name: string; rateBps: number };
  barcodes: { code: string }[];
}
