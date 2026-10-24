import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

@Injectable()
export class AuditService {
  constructor(private db: PrismaService) {}

  log(tenantId: string, action: string, opts: { userId?: string; storeId?: string; entity?: string; entityId?: string; data?: Prisma.InputJsonValue } = {}) {
    return this.db.auditLog.create({ data: { tenantId, action, ...opts } });
  }
}
