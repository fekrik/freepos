export const PERMISSIONS = [
  'sale.create',
  'sale.void_line',
  'sale.void_transaction',
  'sale.price_override',
  'sale.discount',
  'sale.refund',
  'sale.age_override',
  'cash.drawer_open',
  'cash.pickup',
  'cash.close_shift',
  'catalog.read',
  'catalog.write',
  'inventory.write',
  'reports.read',
  'users.manage',
  'store.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export type RoleName = 'cashier' | 'supervisor' | 'manager' | 'admin';

export const ROLE_PERMISSIONS: Record<RoleName, readonly Permission[]> = {
  cashier: ['sale.create', 'sale.void_line', 'catalog.read', 'cash.drawer_open', 'cash.close_shift'],
  supervisor: [
    'sale.create', 'sale.void_line', 'sale.void_transaction', 'sale.price_override',
    'sale.discount', 'sale.refund', 'sale.age_override', 'cash.drawer_open', 'cash.pickup',
    'cash.close_shift', 'catalog.read',
  ],
  manager: PERMISSIONS.filter((p) => p !== 'store.manage'),
  admin: PERMISSIONS,
};

export function hasPermission(role: RoleName, perm: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(perm);
}
