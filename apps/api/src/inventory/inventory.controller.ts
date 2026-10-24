import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit.service';
import { CurrentUser, RequirePermission, type AuthUser } from '../auth/auth.guard';
import { parse } from '../auth/auth.controller';

const SupplierInput = z.object({
  name: z.string().min(1),
  code: z.string().optional().nullable(),
  contactName: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  paymentTerms: z.string().optional().nullable().default('Net 30'),
  active: z.boolean().optional().default(true),
});

const SupplierPaymentInput = z.object({
  amountCents: z.number().int().positive(),
  reference: z.string().optional(),
  note: z.string().optional(),
});

const SupplierProductLinkInput = z.object({
  supplierId: z.string(),
  productId: z.string(),
  rank: z.number().int().min(1).max(3).default(1),
  vendorSku: z.string().optional().nullable(),
  unitCostCents: z.number().int().nonnegative(),
  casePackQty: z.number().int().positive().default(1),
});

const InventoryAdjustInput = z.object({
  productId: z.string(),
  storeId: z.string().optional(),
  onHand: z.number().int(),
  reorderPoint: z.number().int().nonnegative().nullable().optional(),
  reason: z.string().optional().default('Manual stock adjustment'),
});

const CreatePOLineInput = z.object({
  productId: z.string(),
  orderedQty: z.number().int().positive(),
  unitCostCents: z.number().int().nonnegative(),
});

const CreatePOInput = z.object({
  supplierId: z.string(),
  storeId: z.string().optional(),
  expectedAt: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  lines: z.array(CreatePOLineInput).min(1),
});

const ReceivePOLineInput = z.object({
  lineId: z.string(),
  receivedQty: z.number().int().nonnegative(),
  unitCostCents: z.number().int().nonnegative().optional(),
});

const ReceivePOInput = z.object({
  invoiceNo: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  paidCents: z.number().int().nonnegative().optional().default(0),
  lines: z.array(ReceivePOLineInput).optional(),
});

@Controller('inventory')
export class InventoryController {
  constructor(private db: PrismaService, private audit: AuditService) {}

  private async resolveStoreId(u: AuthUser, explicitStoreId?: string): Promise<string> {
    if (explicitStoreId) return explicitStoreId;
    if (u.storeId) return u.storeId;
    const store = await this.db.store.findFirst({ where: { tenantId: u.tenantId } });
    if (!store) throw new BadRequestException('No store found for tenant');
    return store.id;
  }

  // ---------- Inventory Stock & Low-Stock Alerts ----------

  @Get('stock')
  @RequirePermission('catalog.read')
  async getStock(
    @CurrentUser() u: AuthUser,
    @Query('storeId') storeId?: string,
    @Query('supplierId') supplierId?: string,
    @Query('lowStockOnly') lowStockOnly?: string,
    @Query('q') q?: string,
  ) {
    const resolvedStoreId = await this.resolveStoreId(u, storeId);

    // Ensure defaults exist if no suppliers/inventory seeded yet on this tenant
    await this.ensureSeededSuppliersAndInventory(u.tenantId, resolvedStoreId);

    const products = await this.db.product.findMany({
      where: {
        tenantId: u.tenantId,
        active: true,
        ...(supplierId
          ? { supplierProducts: { some: { supplierId } } }
          : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { brand: { contains: q, mode: 'insensitive' } },
                { plu: q },
                { barcodes: { some: { code: { endsWith: q } } } },
              ],
            }
          : {}),
      },
      include: {
        department: true,
        barcodes: true,
        inventory: { where: { storeId: resolvedStoreId } },
        supplierProducts: {
          include: { supplier: true },
          orderBy: { rank: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    });

    const items = products.map((p) => {
      const inv = p.inventory[0];
      const onHand = inv?.onHand ?? 0;
      const reorderPoint = inv?.reorderPoint ?? (p.soldBy === 'weight' ? 15000 : 25);
      const isLowStock = reorderPoint !== null && onHand <= reorderPoint;
      const primarySupplier = p.supplierProducts.find((sp) => sp.rank === 1) ?? p.supplierProducts[0] ?? null;
      const unitCostCents = primarySupplier?.unitCostCents ?? p.cost ?? Math.round(p.price * 0.65);

      return {
        productId: p.id,
        name: p.name,
        brand: p.brand,
        plu: p.plu,
        upc: p.barcodes[0]?.code.replace(/^0+/, '') ?? null,
        department: p.department,
        soldBy: p.soldBy,
        retailPriceCents: p.price,
        unitCostCents,
        onHand,
        reorderPoint,
        isLowStock,
        suppliers: p.supplierProducts.map((sp) => ({
          id: sp.id,
          supplierId: sp.supplierId,
          supplierName: sp.supplier.name,
          rank: sp.rank,
          vendorSku: sp.vendorSku,
          unitCostCents: sp.unitCostCents,
          casePackQty: sp.casePackQty,
        })),
      };
    });

    const filtered = lowStockOnly === 'true' ? items.filter((i) => i.isLowStock) : items;
    const lowStockCount = items.filter((i) => i.isLowStock).length;
    const totalValuationCents = items.reduce((sum, i) => {
      const qtyUnits = i.soldBy === 'weight' ? i.onHand / 1000 : i.onHand;
      return sum + Math.max(0, Math.round(qtyUnits * i.unitCostCents));
    }, 0);

    return {
      storeId: resolvedStoreId,
      items: filtered,
      totalItems: items.length,
      lowStockCount,
      totalValuationCents,
    };
  }

  @Post('adjust')
  @RequirePermission('catalog.write')
  async adjustStock(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    const input = parse(InventoryAdjustInput, body);
    const storeId = await this.resolveStoreId(u, input.storeId);

    const inv = await this.db.inventory.upsert({
      where: { storeId_productId: { storeId, productId: input.productId } },
      update: {
        onHand: input.onHand,
        ...(input.reorderPoint !== undefined ? { reorderPoint: input.reorderPoint } : {}),
      },
      create: {
        storeId,
        productId: input.productId,
        onHand: input.onHand,
        reorderPoint: input.reorderPoint ?? 25,
      },
    });

    await this.audit.log(u.tenantId, 'inventory.adjust', {
      userId: u.sub,
      storeId,
      entity: 'Inventory',
      entityId: input.productId,
      data: {
        onHand: input.onHand,
        reorderPoint: input.reorderPoint,
        reason: input.reason,
      },
    });

    return inv;
  }

  // ---------- Suppliers & Vendor Catalog ----------

  @Get('suppliers')
  @RequirePermission('catalog.read')
  async listSuppliers(@CurrentUser() u: AuthUser) {
    const storeId = await this.resolveStoreId(u);
    await this.ensureSeededSuppliersAndInventory(u.tenantId, storeId);

    return this.db.supplier.findMany({
      where: { tenantId: u.tenantId },
      include: {
        products: {
          include: {
            product: { select: { id: true, name: true, price: true, soldBy: true, plu: true } },
          },
          orderBy: { rank: 'asc' },
        },
        _count: { select: { purchaseOrders: true, products: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  @Post('suppliers')
  @RequirePermission('catalog.write')
  async createSupplier(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    const input = parse(SupplierInput, body);
    const supplier = await this.db.supplier.create({
      data: {
        tenantId: u.tenantId,
        name: input.name,
        code: input.code,
        contactName: input.contactName,
        phone: input.phone,
        email: input.email,
        address: input.address,
        paymentTerms: input.paymentTerms ?? 'Net 30',
        active: input.active ?? true,
      },
    });

    await this.audit.log(u.tenantId, 'supplier.create', {
      userId: u.sub,
      entity: 'Supplier',
      entityId: supplier.id,
      data: { name: supplier.name, code: supplier.code },
    });

    return supplier;
  }

  @Patch('suppliers/:id')
  @RequirePermission('catalog.write')
  async updateSupplier(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(SupplierInput.partial(), body);
    const existing = await this.db.supplier.findFirst({ where: { id, tenantId: u.tenantId } });
    if (!existing) throw new NotFoundException('Supplier not found');

    const updated = await this.db.supplier.update({
      where: { id },
      data: input,
    });

    await this.audit.log(u.tenantId, 'supplier.update', {
      userId: u.sub,
      entity: 'Supplier',
      entityId: id,
    });

    return updated;
  }

  @Post('suppliers/:id/pay')
  @RequirePermission('catalog.write')
  async paySupplier(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const input = parse(SupplierPaymentInput, body);
    const existing = await this.db.supplier.findFirst({ where: { id, tenantId: u.tenantId } });
    if (!existing) throw new NotFoundException('Supplier not found');

    const newBalance = Math.max(0, existing.balanceCents - input.amountCents);
    const updated = await this.db.supplier.update({
      where: { id },
      data: { balanceCents: newBalance },
    });

    await this.audit.log(u.tenantId, 'supplier.payment', {
      userId: u.sub,
      entity: 'Supplier',
      entityId: id,
      data: {
        supplierName: existing.name,
        amountPaidCents: input.amountCents,
        previousBalanceCents: existing.balanceCents,
        newBalanceCents: newBalance,
        reference: input.reference,
        note: input.note,
      },
    });

    return updated;
  }

  @Post('supplier-products')
  @RequirePermission('catalog.write')
  async linkSupplierProduct(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    const input = parse(SupplierProductLinkInput, body);

    const link = await this.db.supplierProduct.upsert({
      where: {
        supplierId_productId: {
          supplierId: input.supplierId,
          productId: input.productId,
        },
      },
      update: {
        rank: input.rank,
        vendorSku: input.vendorSku,
        unitCostCents: input.unitCostCents,
        casePackQty: input.casePackQty,
      },
      create: {
        supplierId: input.supplierId,
        productId: input.productId,
        rank: input.rank,
        vendorSku: input.vendorSku,
        unitCostCents: input.unitCostCents,
        casePackQty: input.casePackQty,
      },
      include: { supplier: true, product: true },
    });

    // Update product default cost if rank 1 (Primary supplier)
    if (input.rank === 1) {
      await this.db.product.update({
        where: { id: input.productId },
        data: { cost: input.unitCostCents },
      });
    }

    await this.audit.log(u.tenantId, 'supplier.link_product', {
      userId: u.sub,
      entity: 'SupplierProduct',
      entityId: link.id,
      data: {
        supplier: link.supplier.name,
        product: link.product.name,
        rank: link.rank,
        unitCostCents: link.unitCostCents,
      },
    });

    return link;
  }

  @Delete('supplier-products/:id')
  @RequirePermission('catalog.write')
  async unlinkSupplierProduct(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.db.supplierProduct.delete({ where: { id } });
    return { deleted: true };
  }

  // ---------- Purchase Orders & Receiving ----------

  @Get('purchase-orders')
  @RequirePermission('catalog.read')
  async listPurchaseOrders(@CurrentUser() u: AuthUser, @Query('status') status?: string) {
    const storeId = await this.resolveStoreId(u);
    await this.ensureSeededSuppliersAndInventory(u.tenantId, storeId);

    return this.db.purchaseOrder.findMany({
      where: {
        tenantId: u.tenantId,
        ...(status ? { status: status as any } : {}),
      },
      include: {
        supplier: true,
        store: true,
        lines: {
          include: {
            product: { select: { id: true, name: true, soldBy: true, plu: true, price: true } },
          },
        },
      },
      orderBy: { orderedAt: 'desc' },
      take: 100,
    });
  }

  @Post('purchase-orders')
  @RequirePermission('catalog.write')
  async createPurchaseOrder(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    const input = parse(CreatePOInput, body);
    const storeId = await this.resolveStoreId(u, input.storeId);

    const supplier = await this.db.supplier.findFirst({
      where: { id: input.supplierId, tenantId: u.tenantId },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');

    const productIds = input.lines.map((l) => l.productId);
    const products = await this.db.product.findMany({
      where: { tenantId: u.tenantId, id: { in: productIds } },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));

    const linesData = input.lines.map((l) => {
      const p = productMap.get(l.productId);
      if (!p) throw new BadRequestException(`Product ${l.productId} not found`);
      const qtyMultiplier = p.soldBy === 'weight' ? l.orderedQty / 1000 : l.orderedQty;
      const lineTotalCents = Math.round(qtyMultiplier * l.unitCostCents);
      return {
        productId: p.id,
        name: p.name,
        orderedQty: l.orderedQty,
        receivedQty: 0,
        unitCostCents: l.unitCostCents,
        lineTotalCents,
      };
    });

    const subtotalCents = linesData.reduce((s, l) => s + l.lineTotalCents, 0);
    const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const poNumber = `PO-${datePrefix}-${Math.floor(1000 + Math.random() * 9000)}`;

    const po = await this.db.purchaseOrder.create({
      data: {
        tenantId: u.tenantId,
        storeId,
        supplierId: supplier.id,
        poNumber,
        status: 'ordered',
        subtotalCents,
        totalCents: subtotalCents,
        notes: input.notes,
        expectedAt: input.expectedAt ? new Date(input.expectedAt) : null,
        createdById: u.sub,
        lines: {
          create: linesData,
        },
      },
      include: {
        supplier: true,
        lines: { include: { product: true } },
      },
    });

    await this.audit.log(u.tenantId, 'purchase_order.create', {
      userId: u.sub,
      storeId,
      entity: 'PurchaseOrder',
      entityId: po.id,
      data: {
        poNumber: po.poNumber,
        supplier: supplier.name,
        totalCents: po.totalCents,
        lineCount: linesData.length,
      },
    });

    return po;
  }

  @Post('purchase-orders/:id/receive')
  @RequirePermission('catalog.write')
  async receivePurchaseOrder(
    @CurrentUser() u: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const input = parse(ReceivePOInput, body);

    const po = await this.db.purchaseOrder.findFirst({
      where: { id, tenantId: u.tenantId },
      include: {
        lines: { include: { product: true } },
        supplier: true,
      },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    if (po.status === 'received') {
      throw new BadRequestException('Purchase order has already been received');
    }

    const receivedMap = new Map(
      (input.lines ?? []).map((l) => [l.lineId, l]),
    );

    const updatedPo = await this.db.$transaction(async (tx) => {
      let finalTotalCents = 0;

      for (const line of po.lines) {
        const override = receivedMap.get(line.id);
        const receivedQty = override ? override.receivedQty : line.orderedQty;
        const unitCostCents = override?.unitCostCents ?? line.unitCostCents;
        const qtyMultiplier = line.product.soldBy === 'weight' ? receivedQty / 1000 : receivedQty;
        const lineTotalCents = Math.round(qtyMultiplier * unitCostCents);
        finalTotalCents += lineTotalCents;

        await tx.purchaseOrderLine.update({
          where: { id: line.id },
          data: {
            receivedQty,
            unitCostCents,
            lineTotalCents,
          },
        });

        // Increment store inventory onHand
        if (receivedQty > 0) {
          await tx.inventory.upsert({
            where: {
              storeId_productId: {
                storeId: po.storeId,
                productId: line.productId,
              },
            },
            update: { onHand: { increment: receivedQty } },
            create: {
              storeId: po.storeId,
              productId: line.productId,
              onHand: receivedQty,
              reorderPoint: line.product.soldBy === 'weight' ? 15000 : 25,
            },
          });

          // Update product latest cost
          await tx.product.update({
            where: { id: line.productId },
            data: { cost: unitCostCents },
          });
        }
      }

      const paidNow = Math.min(finalTotalCents, input.paidCents ?? 0);
      const unpaidBalance = Math.max(0, finalTotalCents - paidNow);

      // Increment supplier AP balance for unpaid invoice amount
      if (unpaidBalance > 0) {
        await tx.supplier.update({
          where: { id: po.supplierId },
          data: { balanceCents: { increment: unpaidBalance } },
        });
      }

      return tx.purchaseOrder.update({
        where: { id: po.id },
        data: {
          status: 'received',
          receivedAt: new Date(),
          receivedById: u.sub,
          invoiceNo: input.invoiceNo || po.invoiceNo,
          notes: input.notes ?? po.notes,
          subtotalCents: finalTotalCents,
          totalCents: finalTotalCents,
          paidCents: paidNow,
        },
        include: {
          supplier: true,
          lines: { include: { product: true } },
        },
      });
    });

    await this.audit.log(u.tenantId, 'purchase_order.receive', {
      userId: u.sub,
      storeId: po.storeId,
      entity: 'PurchaseOrder',
      entityId: po.id,
      data: {
        poNumber: po.poNumber,
        supplier: po.supplier.name,
        invoiceNo: updatedPo.invoiceNo,
        totalCents: updatedPo.totalCents,
        paidCents: updatedPo.paidCents,
      },
    });

    return updatedPo;
  }

  /**
   * Auto-seeds realistic supermarket wholesalers, primary/secondary supplier links,
   * and reorder thresholds if the tenant has no suppliers yet (so production DB
   * works out-of-the-box without requiring a destructive re-seed).
   */
  private async ensureSeededSuppliersAndInventory(tenantId: string, storeId: string) {
    const existingCount = await this.db.supplier.count({ where: { tenantId } });
    if (existingCount > 0) return;

    const suppliersData = [
      {
        name: 'UNFI (United Natural Foods)',
        code: 'UNFI',
        contactName: 'Marcus Vance',
        phone: '800-555-0191',
        email: 'orders@unfi-wholesale.example.com',
        paymentTerms: 'Net 30',
        balanceCents: 145000, // $1,450.00 current AP balance
      },
      {
        name: 'C&S Wholesale Grocers',
        code: 'CSWG',
        contactName: 'Diana Prince',
        phone: '800-555-0144',
        email: 'dispatch@cswg.example.com',
        paymentTerms: 'Net 15',
        balanceCents: 289000, // $2,890.00 current AP balance
      },
      {
        name: 'Local Valley Produce & Dairy Co-op',
        code: 'LVPD',
        contactName: 'hector@valleycoop.example.com',
        phone: '413-555-0188',
        email: 'hector@valleycoop.example.com',
        paymentTerms: 'COD / Net 7',
        balanceCents: 42500, // $425.00
      },
      {
        name: 'Northeast Beverage & Craft Distributors',
        code: 'NEBD',
        contactName: 'Frank Castle',
        phone: '617-555-0122',
        email: 'sales@nebev.example.com',
        paymentTerms: 'Net 30',
        balanceCents: 0,
      },
    ];

    const createdSuppliers = [];
    for (const s of suppliersData) {
      createdSuppliers.push(
        await this.db.supplier.create({
          data: { tenantId, ...s },
        }),
      );
    }

    const [unfi, cswg, valley, nebev] = createdSuppliers;

    const products = await this.db.product.findMany({
      where: { tenantId },
      include: { department: true, inventory: { where: { storeId } } },
    });

    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      const deptCode = p.department.code;
      const primaryCost = Math.max(25, Math.round(p.price * 0.62));
      const secondaryCost = Math.max(28, Math.round(p.price * 0.68));

      let primarySupplier = cswg;
      let secondarySupplier = unfi;

      if (deptCode === 'PRD' || deptCode === 'DRY' || deptCode === 'BKY') {
        primarySupplier = valley;
        secondarySupplier = unfi;
      } else if (deptCode === 'BEV' || deptCode === 'ALC') {
        primarySupplier = nebev;
        secondarySupplier = cswg;
      } else if (p.name.toLowerCase().includes('organic') || deptCode === 'SNK') {
        primarySupplier = unfi;
        secondarySupplier = cswg;
      }

      // Primary supplier (rank 1)
      await this.db.supplierProduct.upsert({
        where: { supplierId_productId: { supplierId: primarySupplier.id, productId: p.id } },
        update: {},
        create: {
          supplierId: primarySupplier.id,
          productId: p.id,
          rank: 1,
          vendorSku: `${primarySupplier.code}-${1000 + i}`,
          unitCostCents: primaryCost,
          casePackQty: p.soldBy === 'weight' ? 1 : 12,
        },
      });

      // Secondary supplier (rank 2)
      await this.db.supplierProduct.upsert({
        where: { supplierId_productId: { supplierId: secondarySupplier.id, productId: p.id } },
        update: {},
        create: {
          supplierId: secondarySupplier.id,
          productId: p.id,
          rank: 2,
          vendorSku: `${secondarySupplier.code}-${2000 + i}`,
          unitCostCents: secondaryCost,
          casePackQty: p.soldBy === 'weight' ? 1 : 24,
        },
      });

      // Ensure realistic inventory & some low-stock items so alerts trigger immediately
      const isDemoLowStock = i % 7 === 0;
      const defaultReorder = p.soldBy === 'weight' ? 20000 : 30;
      const demoOnHand = isDemoLowStock
        ? (p.soldBy === 'weight' ? 8500 : 12)
        : (p.soldBy === 'weight' ? 65000 : 85);

      await this.db.inventory.upsert({
        where: { storeId_productId: { storeId, productId: p.id } },
        update: {
          reorderPoint: defaultReorder,
          ...(isDemoLowStock ? { onHand: demoOnHand } : {}),
        },
        create: {
          storeId,
          productId: p.id,
          onHand: demoOnHand,
          reorderPoint: defaultReorder,
        },
      });
    }

    // Create 1 sample open Purchase Order ready for 1-click receiving
    const sampleProducts = products.slice(0, 4);
    if (sampleProducts.length > 0) {
      const poLines = sampleProducts.map((p) => {
        const orderedQty = p.soldBy === 'weight' ? 25000 : 24;
        const unitCostCents = Math.round(p.price * 0.62);
        const mult = p.soldBy === 'weight' ? orderedQty / 1000 : orderedQty;
        return {
          productId: p.id,
          name: p.name,
          orderedQty,
          receivedQty: 0,
          unitCostCents,
          lineTotalCents: Math.round(mult * unitCostCents),
        };
      });
      const subtotal = poLines.reduce((s, l) => s + l.lineTotalCents, 0);

      await this.db.purchaseOrder.create({
        data: {
          tenantId,
          storeId,
          supplierId: valley.id,
          poNumber: 'PO-20261024-1001',
          status: 'ordered',
          subtotalCents: subtotal,
          totalCents: subtotal,
          notes: 'Weekly produce & dairy restock delivery',
          expectedAt: new Date(Date.now() + 86400000),
          lines: { create: poLines },
        },
      });
    }
  }
}
