import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { normalizeGtin, parseBarcode, isValidGtin } from '@freshpos/shared';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit.service';
import { CurrentUser, RequirePermission, type AuthUser } from '../auth/auth.guard';
import { parse } from '../auth/auth.controller';

const ProductInput = z.object({
  name: z.string().min(1),
  brand: z.string().optional(),
  departmentId: z.string(),
  taxClassId: z.string(),
  soldBy: z.enum(['each', 'weight']).default('each'),
  price: z.number().int().nonnegative(),
  cost: z.number().int().nonnegative().optional(),
  snapEligible: z.boolean().default(false),
  wicEligible: z.boolean().default(false),
  minAge: z.number().int().min(18).max(21).nullable().optional(),
  depositCents: z.number().int().nonnegative().nullable().optional(),
  plu: z.string().regex(/^\d{4,5}$/).nullable().optional(),
  imageUrl: z.string().url().nullable().optional(),
  active: z.boolean().default(true),
  barcodes: z.array(z.string().refine(isValidGtin, 'Invalid GTIN')).default([]),
});

const BulkImportRow = z.object({
  name: z.string().min(1),
  brand: z.string().optional(),
  department: z.string().optional(),
  taxClass: z.string().optional(),
  soldBy: z.enum(['each', 'weight']).default('each'),
  price: z.number().int().nonnegative(),
  cost: z.number().int().nonnegative().optional(),
  snapEligible: z.boolean().default(false),
  wicEligible: z.boolean().default(false),
  minAge: z.number().int().nullable().optional(),
  depositCents: z.number().int().nullable().optional(),
  plu: z.string().nullable().optional(),
  barcodes: z.array(z.string()).default([]),
});

const BulkImportInput = z.object({
  items: z.array(BulkImportRow).min(1).max(2000),
});

const include = { barcodes: true, department: true, taxClass: true } as const;

@Controller()
export class CatalogController {
  constructor(private db: PrismaService, private audit: AuditService) {}

  @Get('departments') @RequirePermission('catalog.read')
  departments(@CurrentUser() u: AuthUser) {
    return this.db.department.findMany({ where: { tenantId: u.tenantId }, orderBy: { name: 'asc' } });
  }

  @Get('tax-classes') @RequirePermission('catalog.read')
  taxClasses(@CurrentUser() u: AuthUser) {
    return this.db.taxClass.findMany({ where: { tenantId: u.tenantId }, orderBy: { name: 'asc' } });
  }

  @Get('products') @RequirePermission('catalog.read')
  list(@CurrentUser() u: AuthUser, @Query('q') q?: string, @Query('departmentId') departmentId?: string,
       @Query('take') take = '50', @Query('skip') skip = '0') {
    const where = {
      tenantId: u.tenantId,
      ...(departmentId ? { departmentId } : {}),
      ...(q ? { OR: [
        { name: { contains: q, mode: 'insensitive' as const } },
        { brand: { contains: q, mode: 'insensitive' as const } },
        { plu: q },
        { barcodes: { some: { code: { endsWith: q } } } },
      ] } : {}),
    };
    return this.db.$transaction([
      this.db.product.findMany({ where, include, orderBy: { name: 'asc' }, take: Math.min(+take, 200), skip: +skip }),
      this.db.product.count({ where }),
    ]).then(([items, total]) => ({ items, total }));
  }

  /** Lane scan endpoint: resolves UPC / PLU / deli barcode to a product with the store's price. */
  @Get('scan/:code') @RequirePermission('sale.create')
  async scan(@CurrentUser() u: AuthUser, @Param('code') code: string) {
    const store = u.storeId ? await this.db.store.findUnique({ where: { id: u.storeId } }) : null;
    const parsed = parseBarcode(code, { variableMeasureMode: (store?.variableMeasureMode as 'price' | 'weight') ?? 'price' });
    let product;
    if (parsed.kind === 'product') {
      product = await this.db.product.findFirst({ where: { tenantId: u.tenantId, active: true, barcodes: { some: { code: parsed.code } } }, include });
    } else if (parsed.kind === 'plu') {
      product = await this.db.product.findFirst({ where: { tenantId: u.tenantId, active: true, plu: parsed.plu }, include });
    } else if (parsed.kind === 'price-embedded' || parsed.kind === 'weight-embedded') {
      product = await this.db.product.findFirst({ where: { tenantId: u.tenantId, active: true, plu: parsed.itemCode }, include });
    } else {
      throw new NotFoundException(parsed.reason);
    }
    if (!product) throw new NotFoundException('Item not found');
    const sp = u.storeId ? await this.db.storePrice.findUnique({ where: { storeId_productId: { storeId: u.storeId, productId: product.id } } }) : null;
    return { parsed, product: { ...product, price: sp?.price ?? product.price } };
  }

  @Post('products') @RequirePermission('catalog.write')
  async create(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    const { barcodes, ...data } = parse(ProductInput, body);
    const p = await this.db.product.create({
      data: { ...data, tenantId: u.tenantId, barcodes: { create: (barcodes ?? []).map((c) => ({ code: normalizeGtin(c), tenantId: u.tenantId })) } },
      include,
    });
    await this.audit.log(u.tenantId, 'product.create', { userId: u.sub, entity: 'Product', entityId: p.id });
    return p;
  }

  @Patch('products/:id') @RequirePermission('catalog.write')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const { barcodes, ...data } = parse(ProductInput.partial(), body);
    const existing = await this.db.product.findFirst({ where: { id, tenantId: u.tenantId } });
    if (!existing) throw new NotFoundException();
    const p = await this.db.$transaction(async (tx) => {
      if (barcodes) {
        await tx.barcode.deleteMany({ where: { productId: id } });
        await tx.barcode.createMany({ data: barcodes.map((c) => ({ code: normalizeGtin(c), tenantId: u.tenantId, productId: id })) });
      }
      return tx.product.update({ where: { id }, data, include });
    });
    await this.audit.log(u.tenantId, 'product.update', {
      userId: u.sub, entity: 'Product', entityId: id,
      data: existing.price !== p.price ? { priceFrom: existing.price, priceTo: p.price } : undefined,
    });
    return p;
  }

  @Post('products/bulk-import') @RequirePermission('catalog.write')
  async bulkImport(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    const { items } = parse(BulkImportInput, body);

    const departments = await this.db.department.findMany({ where: { tenantId: u.tenantId } });
    const taxClasses = await this.db.taxClass.findMany({ where: { tenantId: u.tenantId } });

    const defaultDept = departments.find((d) => d.name.toLowerCase().includes('grocery')) || departments[0];
    const zeroTax = taxClasses.find((t) => t.rateBps === 0) || taxClasses[0];
    const standardTax = taxClasses.find((t) => t.rateBps > 0) || taxClasses[0];

    let created = 0;
    let updated = 0;

    await this.db.$transaction(async (tx) => {
      for (const item of items) {
        // Resolve department
        let deptId = defaultDept?.id;
        if (item.department) {
          const matched = departments.find(
            (d) =>
              d.name.toLowerCase() === item.department!.toLowerCase() ||
              d.code.toLowerCase() === item.department!.toLowerCase() ||
              d.name.toLowerCase().includes(item.department!.toLowerCase()),
          );
          if (matched) deptId = matched.id;
        }

        // Resolve tax class
        let taxId = zeroTax?.id;
        if (item.taxClass) {
          const matched = taxClasses.find((t) => t.name.toLowerCase().includes(item.taxClass!.toLowerCase()));
          if (matched) taxId = matched.id;
        } else if (!item.snapEligible && (item.minAge || deptId !== defaultDept?.id)) {
          taxId = standardTax?.id || zeroTax?.id;
        }

        // Check if product already exists by barcode or PLU
        let existing: any = null;
        const normalizedBarcodes = (item.barcodes || [])
          .filter(Boolean)
          .map((c) => normalizeGtin(c.trim()));

        if (normalizedBarcodes.length > 0) {
          existing = await tx.product.findFirst({
            where: {
              tenantId: u.tenantId,
              barcodes: { some: { code: { in: normalizedBarcodes } } },
            },
          });
        }
        if (!existing && item.plu) {
          existing = await tx.product.findFirst({
            where: { tenantId: u.tenantId, plu: item.plu },
          });
        }

        if (existing) {
          // Update existing product
          await tx.product.update({
            where: { id: existing.id },
            data: {
              name: item.name,
              brand: item.brand || existing.brand,
              departmentId: deptId,
              taxClassId: taxId,
              soldBy: item.soldBy,
              price: item.price,
              cost: item.cost ?? existing.cost,
              snapEligible: item.snapEligible,
              wicEligible: item.wicEligible,
              minAge: item.minAge ?? existing.minAge,
              depositCents: item.depositCents ?? existing.depositCents,
              plu: item.plu ?? existing.plu,
              active: true,
            },
          });

          // Add any missing barcodes
          for (const code of normalizedBarcodes) {
            const hasBarcode = await tx.barcode.findFirst({
              where: { tenantId: u.tenantId, code },
            });
            if (!hasBarcode) {
              await tx.barcode.create({
                data: { tenantId: u.tenantId, productId: existing.id, code },
              });
            }
          }

          updated++;
        } else {
          // Create brand new product
          await tx.product.create({
            data: {
              tenantId: u.tenantId,
              name: item.name,
              brand: item.brand,
              departmentId: deptId,
              taxClassId: taxId,
              soldBy: item.soldBy,
              price: item.price,
              cost: item.cost,
              snapEligible: item.snapEligible,
              wicEligible: item.wicEligible,
              minAge: item.minAge,
              depositCents: item.depositCents,
              plu: item.plu,
              active: true,
              barcodes: {
                create: normalizedBarcodes.map((code) => ({
                  tenantId: u.tenantId,
                  code,
                })),
              },
            },
          });
          created++;
        }
      }
    });

    await this.audit.log(u.tenantId, 'products.bulk_import', {
      userId: u.sub,
      entity: 'Product',
      data: { created, updated, total: items.length },
    });

    return {
      success: true,
      created,
      updated,
      total: items.length,
    };
  }
}
