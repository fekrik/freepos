import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CurrentUser, Public, RequirePermission, type AuthUser } from '../auth/auth.guard';

@Controller()
export class StoresController {
  constructor(private db: PrismaService) {}

  /** Used by the lane setup screen to pick a store before PIN login. */
  @Public() @Get('tenants/:slug/stores')
  async publicStores(@Param('slug') slug: string) {
    const t = await this.db.tenant.findUnique({ where: { slug }, select: { name: true, stores: { select: { id: true, name: true } } } });
    if (!t) throw new NotFoundException('Unknown tenant');
    return t;
  }

  @Get('stores') @RequirePermission('catalog.read')
  stores(@CurrentUser() u: AuthUser) {
    return this.db.store.findMany({ where: { tenantId: u.tenantId }, include: { registers: true } });
  }

  @Get('audit') @RequirePermission('reports.read')
  audit(@CurrentUser() u: AuthUser) {
    return this.db.auditLog.findMany({ where: { tenantId: u.tenantId }, orderBy: { createdAt: 'desc' }, take: 100 });
  }
}
