import {
  BadRequestException, Body, Controller, Get, NotFoundException, Param, Post, Query, UnauthorizedException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { computeTotals, hasPermission, taxAfterSnap, type CartLine, type Cents } from '@freshpos/shared';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit.service';
import { CurrentUser, RequirePermission, type AuthUser } from '../auth/auth.guard';
import { parse } from '../auth/auth.controller';

const PaymentInput = z.object({
  tenderType: z.enum(['cash', 'card', 'ebt_snap', 'ebt_cash']),
  amountCents: z.number().int().positive(),
  tenderedCents: z.number().int().nonnegative().optional(),
  changeCents: z.number().int().nonnegative().optional(),
  cardBrand: z.string().optional(),
  last4: z.string().optional(),
  authCode: z.string().optional(),
});

const LineInput = z.object({
  productId: z.string(),
  name: z.string(),
  soldBy: z.enum(['each', 'weight']),
  quantity: z.number().int().positive(),
  unitPrice: z.number().int().nonnegative(),
  fixedTotal: z.number().int().nonnegative().optional(),
  taxRateBps: z.number().int().nonnegative(),
  snapEligible: z.boolean(),
  depositPerUnit: z.number().int().nonnegative().optional(),
  discount: z.number().int().nonnegative().optional(),
  overrideReason: z.string().optional(),
});

const CreateSaleInput = z.object({
  lines: z.array(LineInput).min(1),
  payments: z.array(PaymentInput).min(1),
  customerId: z.string().optional(),
  offlineCreated: z.boolean().optional(),
  offlineSaleNumber: z.string().optional(),
});

const OpenShiftInput = z.object({
  openingFloatCents: z.number().int().nonnegative().default(20000), // Default $200.00 float
});

const CloseShiftInput = z.object({
  closingCashCents: z.number().int().nonnegative(),
});

const DrawerMovementInput = z.object({
  type: z.enum(['no_sale', 'cash_drop', 'paid_in', 'paid_out']),
  amountCents: z.number().int().nonnegative().default(0),
  reason: z.string().min(1),
  payee: z.string().optional(),
});

const CreateCustomerInput = z.object({
  name: z.string().min(1),
  phone: z.string().min(7),
  email: z.string().email().optional(),
});

const ReturnLineInput = z.object({
  saleLineId: z.string(),
  productId: z.string(),
  quantity: z.number().int().positive(),
  reason: z.string().min(1),
  action: z.enum(['restock', 'spoilage_writeoff']),
});

const RefundSaleInput = z.object({
  originalSaleId: z.string(),
  returnLines: z.array(ReturnLineInput).min(1),
  refundTenderType: z.enum(['cash', 'card', 'ebt_snap']),
  supervisorPin: z.string().optional(),
});

@Controller()
export class SalesController {
  constructor(private db: PrismaService, private audit: AuditService) {}

  // ---------- Customers & Loyalty ----------

  @Get('customers/lookup') @RequirePermission('sale.create')
  async lookupCustomer(@CurrentUser() u: AuthUser, @Query('phone') rawPhone: string) {
    if (!rawPhone) throw new BadRequestException('Phone number required');
    const cleanPhone = rawPhone.replace(/\D/g, '');
    const customer = await this.db.customer.findFirst({
      where: {
        tenantId: u.tenantId,
        OR: [{ phone: cleanPhone }, { phone: rawPhone }],
      },
    });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  @Post('customers') @RequirePermission('sale.create')
  async createCustomer(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    const input = parse(CreateCustomerInput, body);
    const cleanPhone = input.phone.replace(/\D/g, '');

    const existing = await this.db.customer.findFirst({
      where: { tenantId: u.tenantId, phone: cleanPhone },
    });
    if (existing) return existing;

    const customer = await this.db.customer.create({
      data: {
        tenantId: u.tenantId,
        name: input.name,
        phone: cleanPhone,
        email: input.email,
        points: 25, // 25 welcome bonus points!
      },
    });

    await this.audit.log(u.tenantId, 'customer.create', {
      userId: u.sub,
      entity: 'Customer',
      entityId: customer.id,
      data: { name: customer.name, phone: customer.phone },
    });

    return customer;
  }

  // ---------- Shifts & Cash Drawer Operations ----------

  @Get('shifts/current') @RequirePermission('sale.create')
  async currentShift(@CurrentUser() u: AuthUser) {
    if (!u.storeId) return null;
    return this.db.shift.findFirst({
      where: { tenantId: u.tenantId, storeId: u.storeId, userId: u.sub, status: 'open' },
      orderBy: { openedAt: 'desc' },
      include: { register: true, drawerMovements: true },
    });
  }

  @Post('shifts/open') @RequirePermission('cash.drawer_open')
  async openShift(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    if (!u.storeId) throw new BadRequestException('Store context required');
    const input = parse(OpenShiftInput, body);

    const reg = await this.db.register.findFirst({ where: { storeId: u.storeId, active: true } });
    if (!reg) throw new BadRequestException('No register available for this store');

    // Close any previous dangling open shifts for this user
    await this.db.shift.updateMany({
      where: { tenantId: u.tenantId, storeId: u.storeId, userId: u.sub, status: 'open' },
      data: { status: 'closed', closedAt: new Date() },
    });

    const shift = await this.db.shift.create({
      data: {
        tenantId: u.tenantId,
        storeId: u.storeId,
        registerId: reg.id,
        userId: u.sub,
        openingFloatCents: input.openingFloatCents,
        status: 'open',
      },
      include: { register: true, drawerMovements: true },
    });

    await this.audit.log(u.tenantId, 'shift.open', {
      userId: u.sub, storeId: u.storeId, entity: 'Shift', entityId: shift.id,
      data: { openingFloatCents: input.openingFloatCents },
    });

    return shift;
  }

  @Post('shifts/drawer-movement') @RequirePermission('cash.drawer_open')
  async drawerMovement(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    if (!u.storeId) throw new BadRequestException('Store context required');
    const input = parse(DrawerMovementInput, body);

    const shift = await this.db.shift.findFirst({
      where: { tenantId: u.tenantId, storeId: u.storeId, userId: u.sub, status: 'open' },
    });
    if (!shift) throw new NotFoundException('No active open shift found for this cashier');

    const movement = await this.db.drawerMovement.create({
      data: {
        tenantId: u.tenantId,
        shiftId: shift.id,
        userId: u.sub,
        type: input.type,
        amountCents: input.amountCents,
        reason: input.reason,
        payee: input.payee,
      },
    });

    await this.audit.log(u.tenantId, `drawer.${input.type}`, {
      userId: u.sub,
      storeId: u.storeId,
      entity: 'DrawerMovement',
      entityId: movement.id,
      data: { ...input, shiftId: shift.id },
    });

    return movement;
  }

  @Post('shifts/close') @RequirePermission('cash.close_shift')
  async closeShift(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    if (!u.storeId) throw new BadRequestException('Store context required');
    const input = parse(CloseShiftInput, body);

    const shift = await this.db.shift.findFirst({
      where: { tenantId: u.tenantId, storeId: u.storeId, userId: u.sub, status: 'open' },
      orderBy: { openedAt: 'desc' },
      include: {
        sales: { include: { payments: true } },
        drawerMovements: true,
        register: true,
        user: { select: { name: true, employeeNo: true } },
        store: true,
      },
    });
    if (!shift) throw new NotFoundException('No active open shift found');

    // Calculate sales metrics & tenders
    let cashSalesCents = 0;
    let cardSalesCents = 0;
    let ebtSalesCents = 0;
    let grossSalesCents = 0;
    let totalTaxCents = 0;
    let totalDepositsCents = 0;
    let completedTransactionsCount = 0;

    for (const sale of shift.sales) {
      if (sale.status === 'completed') {
        completedTransactionsCount++;
        grossSalesCents += sale.totalCents;
        totalTaxCents += sale.taxCents;
        totalDepositsCents += sale.depositCents;

        for (const p of sale.payments) {
          if (p.tenderType === 'cash') cashSalesCents += p.amountCents;
          else if (p.tenderType === 'card') cardSalesCents += p.amountCents;
          else if (p.tenderType === 'ebt_snap' || p.tenderType === 'ebt_cash') ebtSalesCents += p.amountCents;
        }
      }
    }

    // Calculate drawer cash movements
    let paidInCents = 0;
    let paidOutCents = 0;
    let cashDropsCents = 0;

    for (const m of shift.drawerMovements) {
      if (m.type === 'paid_in') paidInCents += m.amountCents;
      else if (m.type === 'paid_out') paidOutCents += m.amountCents;
      else if (m.type === 'cash_drop') cashDropsCents += m.amountCents;
    }

    const expectedCashCents =
      shift.openingFloatCents + cashSalesCents + paidInCents - paidOutCents - cashDropsCents;
    const differenceCents = input.closingCashCents - expectedCashCents;

    const updated = await this.db.shift.update({
      where: { id: shift.id },
      data: {
        status: 'closed',
        closedAt: new Date(),
        closingCashCents: input.closingCashCents,
        expectedCashCents,
      },
    });

    const zReport = {
      shiftId: shift.id,
      storeName: shift.store.name,
      registerName: shift.register.name,
      cashierName: shift.user.name,
      openedAt: shift.openedAt.toISOString(),
      closedAt: new Date().toISOString(),
      salesSummary: {
        transactionsCount: completedTransactionsCount,
        grossSalesCents,
        taxCents: totalTaxCents,
        depositCents: totalDepositsCents,
      },
      tendersSummary: {
        cashCents: cashSalesCents,
        cardCents: cardSalesCents,
        ebtCents: ebtSalesCents,
      },
      drawerReconciliation: {
        openingFloatCents: shift.openingFloatCents,
        cashSalesCents,
        paidInCents,
        paidOutCents,
        cashDropsCents,
        expectedCashCents,
        countedCashCents: input.closingCashCents,
        differenceCents,
        status: differenceCents === 0 ? 'balanced' : differenceCents > 0 ? 'over' : 'short',
      },
    };

    await this.audit.log(u.tenantId, 'shift.close_z_report', {
      userId: u.sub,
      storeId: u.storeId,
      entity: 'Shift',
      entityId: shift.id,
      data: zReport as any,
    });

    return { shift: updated, zReport };
  }

  // ---------- Transactions (Sales) ----------

  @Post('sales') @RequirePermission('sale.create')
  async createSale(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    if (!u.storeId) throw new BadRequestException('Store context required for checkout');
    const input = parse(CreateSaleInput, body);

    const cartLines: CartLine[] = input.lines.map((l, i) => ({
      id: String(i),
      productId: l.productId,
      name: l.name,
      soldBy: l.soldBy,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      fixedTotal: l.fixedTotal,
      taxRateBps: l.taxRateBps,
      snapEligible: l.snapEligible,
      depositPerUnit: l.depositPerUnit,
      discount: l.discount,
    }));

    const standardTotals = computeTotals(cartLines);

    // Sum SNAP tenders to apply 7 CFR 272.1 SNAP tax forgiveness rule
    const snapTenderPaid = input.payments
      .filter((p) => p.tenderType === 'ebt_snap')
      .reduce((sum, p) => sum + p.amountCents, 0);

    const adjustedTax = taxAfterSnap(cartLines, snapTenderPaid);
    const expectedTotal = standardTotals.subtotal - standardTotals.discounts + standardTotals.deposits + adjustedTax;

    const totalPaid = input.payments.reduce((sum, p) => sum + p.amountCents, 0);
    if (totalPaid < expectedTotal) {
      throw new BadRequestException(
        `Insufficient payment: Total due is $${(expectedTotal / 100).toFixed(2)}, received $${(totalPaid / 100).toFixed(2)}`,
      );
    }

    const register = await this.db.register.findFirst({ where: { storeId: u.storeId, active: true } });
    if (!register) throw new BadRequestException('No register configured for this store');

    let shift = await this.db.shift.findFirst({
      where: { tenantId: u.tenantId, storeId: u.storeId, userId: u.sub, status: 'open' },
    });

    // Auto-create shift with $200 float if cashier began checkout without explicit shift open
    shift ??= await this.db.shift.create({
      data: {
        tenantId: u.tenantId,
        storeId: u.storeId,
        registerId: register.id,
        userId: u.sub,
        openingFloatCents: 20000,
        status: 'open',
      },
    });

    const store = await this.db.store.findUnique({ where: { id: u.storeId } });
    const now = new Date();
    const datePrefix = now.toISOString().slice(0, 10).replace(/-/g, '');
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const saleNumber = input.offlineSaleNumber || `TX-${datePrefix}-${randomSuffix}`;

    // Execute in Prisma transaction
    const sale = await this.db.$transaction(async (tx) => {
      const createdSale = await tx.sale.create({
        data: {
          tenantId: u.tenantId,
          storeId: u.storeId!,
          registerId: register.id,
          userId: u.sub,
          shiftId: shift!.id,
          customerId: input.customerId,
          saleNumber,
          status: 'completed',
          subtotalCents: standardTotals.subtotal,
          discountCents: standardTotals.discounts,
          depositCents: standardTotals.deposits,
          taxCents: adjustedTax,
          totalCents: expectedTotal,
          snapPaidCents: snapTenderPaid,
          snapEligibleCents: standardTotals.snapEligibleTotal,
          offlineCreated: !!input.offlineCreated,
          completedAt: now,
          lines: {
            create: input.lines.map((l) => ({
              productId: l.productId,
              name: l.name,
              soldBy: l.soldBy,
              quantity: l.quantity,
              unitPriceCents: l.unitPrice,
              fixedTotalCents: l.fixedTotal,
              taxRateBps: l.taxRateBps,
              taxCents: Math.round((((l.fixedTotal ?? l.unitPrice * (l.soldBy === 'weight' ? l.quantity / 1000 : l.quantity)) * l.taxRateBps) / 10000)),
              snapEligible: l.snapEligible,
              depositCents: (l.depositPerUnit ?? 0) * (l.soldBy === 'each' ? l.quantity : 1),
              discountCents: l.discount ?? 0,
              overrideReason: l.overrideReason,
            })),
          },
          payments: {
            create: input.payments.map((p) => ({
              tenderType: p.tenderType,
              amountCents: p.amountCents,
              tenderedCents: p.tenderedCents,
              changeCents: p.changeCents,
              cardBrand: p.cardBrand,
              last4: p.last4,
              authCode: p.authCode || `AUTH-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
            })),
          },
        },
        include: {
          lines: true,
          payments: true,
          register: true,
          user: { select: { id: true, name: true, employeeNo: true } },
          customer: true,
        },
      });

      // Award loyalty points (1 point per whole dollar spent)
      if (input.customerId) {
        const earnedPoints = Math.floor(expectedTotal / 100);
        await tx.customer.update({
          where: { id: input.customerId },
          data: { points: { increment: earnedPoints } },
        });
      }

      // Decrement inventory stock
      for (const line of input.lines) {
        const decrementAmount = line.soldBy === 'weight' ? line.quantity : line.quantity;
        await tx.inventory.upsert({
          where: { storeId_productId: { storeId: u.storeId!, productId: line.productId } },
          update: { onHand: { decrement: decrementAmount } },
          create: { storeId: u.storeId!, productId: line.productId, onHand: -decrementAmount },
        });
      }

      return createdSale;
    });

    await this.audit.log(u.tenantId, 'sale.complete', {
      userId: u.sub,
      storeId: u.storeId,
      entity: 'Sale',
      entityId: sale.id,
      data: {
        saleNumber: sale.saleNumber,
        totalCents: sale.totalCents,
        customerId: input.customerId,
        tenders: input.payments.map((p) => p.tenderType),
      },
    });

    return {
      sale,
      store: {
        name: store?.name || 'Fresh Market',
        address: store?.address || '',
        fnsNumber: store?.fnsNumber || '',
      },
    };
  }

  @Get('sales') @RequirePermission('catalog.read')
  async listSales(
    @CurrentUser() u: AuthUser,
    @Query('take') take = '30',
    @Query('skip') skip = '0',
  ) {
    const where = { tenantId: u.tenantId, ...(u.storeId ? { storeId: u.storeId } : {}) };
    const [sales, total] = await Promise.all([
      this.db.sale.findMany({
        where,
        orderBy: { completedAt: 'desc' },
        take: Math.min(+take, 100),
        skip: +skip,
        include: {
          payments: true,
          user: { select: { name: true, employeeNo: true } },
          lines: true,
          customer: true,
        },
      }),
      this.db.sale.count({ where }),
    ]);
    return { sales, total };
  }

  @Get('sales/:id') @RequirePermission('sale.create')
  async getSale(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const sale = await this.db.sale.findFirst({
      where: {
        tenantId: u.tenantId,
        OR: [{ id }, { saleNumber: id }],
      },
      include: {
        lines: true,
        payments: true,
        register: true,
        user: { select: { id: true, name: true, employeeNo: true } },
        store: true,
        customer: true,
      },
    });
    if (!sale) throw new NotFoundException('Transaction not found');
    return sale;
  }

  @Post('sales/refund') @RequirePermission('sale.create')
  async refundSale(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    const input = parse(RefundSaleInput, body);

    // 1. Fetch original sale
    const originalSale = await this.db.sale.findFirst({
      where: {
        tenantId: u.tenantId,
        OR: [{ id: input.originalSaleId }, { saleNumber: input.originalSaleId }],
      },
      include: {
        lines: true,
        payments: true,
        customer: true,
        store: true,
        register: true,
      },
    });
    if (!originalSale) throw new NotFoundException('Original transaction not found');

    // 2. Supervisor Authorization check
    let supervisor: { id: string; name: string } | null = null;
    const userCanRefund = hasPermission(u.role, 'sale.refund');
    if (!userCanRefund) {
      if (!input.supervisorPin) {
        throw new BadRequestException('Supervisor authorization PIN required to process refunds');
      }
      const users = await this.db.user.findMany({ where: { tenantId: u.tenantId, active: true } });
      for (const sup of users) {
        if (await bcrypt.compare(input.supervisorPin, sup.pinHash)) {
          if (hasPermission(sup.role, 'sale.refund')) {
            supervisor = { id: sup.id, name: sup.name };
            break;
          }
        }
      }
      if (!supervisor) {
        throw new UnauthorizedException('Invalid supervisor PIN or supervisor lacks refund authority');
      }
    }

    // 3. Federal SNAP compliance check (7 CFR 272.1)
    if (originalSale.snapPaidCents > 0 && input.refundTenderType === 'cash') {
      const containsSnapItem = input.returnLines.some((rl) => {
        const origLine = originalSale.lines.find((l) => l.id === rl.saleLineId || l.productId === rl.productId);
        return origLine?.snapEligible;
      });
      if (containsSnapItem) {
        throw new BadRequestException(
          'Federal SNAP rule (7 CFR 272.1): Items purchased with SNAP benefits cannot be refunded in Cash. Refund must be processed to EBT.',
        );
      }
    }

    // 4. Calculate itemized refunds
    let subtotalRefund = 0;
    let taxRefund = 0;
    let depositRefund = 0;

    const returnLinesData: Array<{
      productId: string;
      name: string;
      soldBy: 'each' | 'weight';
      quantity: number;
      unitPrice: number;
      fixedTotal?: number;
      taxRateBps: number;
      snapEligible: boolean;
      depositPerUnit?: number;
      lineTotal: number;
      action: 'restock' | 'spoilage_writeoff';
      reason: string;
    }> = [];

    for (const rl of input.returnLines) {
      const origLine = originalSale.lines.find((l) => l.id === rl.saleLineId || l.productId === rl.productId);
      if (!origLine) throw new BadRequestException(`Item ${rl.productId} is not on original transaction`);
      if (rl.quantity > origLine.quantity) {
        throw new BadRequestException(`Return quantity cannot exceed purchased quantity for ${origLine.name}`);
      }

      // Calculate line net refund
      let lineNetCents: number;
      if (origLine.soldBy === 'weight') {
        const fullPrice = origLine.fixedTotalCents ?? Math.round((origLine.unitPriceCents * origLine.quantity) / 1000);
        lineNetCents = Math.round(fullPrice * (rl.quantity / origLine.quantity));
      } else {
        const unitNet = Math.round((origLine.unitPriceCents * origLine.quantity - origLine.discountCents) / origLine.quantity);
        lineNetCents = unitNet * rl.quantity;
      }

      const itemTax = Math.round((lineNetCents * origLine.taxRateBps) / 10000);
      const unitDeposit = origLine.soldBy === 'each' && origLine.quantity > 0 ? Math.round(origLine.depositCents / origLine.quantity) : 0;
      const itemDeposit = unitDeposit * rl.quantity;

      subtotalRefund += lineNetCents;
      taxRefund += itemTax;
      depositRefund += itemDeposit;

      returnLinesData.push({
        productId: origLine.productId,
        name: origLine.name,
        soldBy: origLine.soldBy,
        quantity: rl.quantity,
        unitPrice: origLine.unitPriceCents,
        fixedTotal: origLine.fixedTotalCents ?? undefined,
        taxRateBps: origLine.taxRateBps,
        snapEligible: origLine.snapEligible,
        depositPerUnit: unitDeposit || undefined,
        lineTotal: lineNetCents,
        action: rl.action,
        reason: rl.reason,
      });
    }

    const totalRefundCents = subtotalRefund + taxRefund + depositRefund;

    // 5. Execute in Prisma Transaction
    const result = await this.db.$transaction(async (tx) => {
      // Find active cashier shift for drawer movements
      const activeShift = await tx.shift.findFirst({
        where: { tenantId: u.tenantId, storeId: u.storeId || originalSale.storeId, userId: u.sub, status: 'open' },
      });

      const refundSaleNumber = `REF-${originalSale.saleNumber.replace(/^TX-/, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

      // Create refund sale record
      const refundSale = await tx.sale.create({
        data: {
          tenantId: u.tenantId,
          storeId: originalSale.storeId,
          registerId: originalSale.registerId,
          userId: u.sub,
          shiftId: activeShift?.id,
          customerId: originalSale.customerId,
          saleNumber: refundSaleNumber,
          status: 'refunded',
          subtotalCents: subtotalRefund,
          discountCents: 0,
          depositCents: depositRefund,
          taxCents: taxRefund,
          totalCents: totalRefundCents,
          snapPaidCents: input.refundTenderType === 'ebt_snap' ? totalRefundCents : 0,
          completedAt: new Date(),
          lines: {
            create: returnLinesData.map((l) => ({
              productId: l.productId,
              name: l.name,
              soldBy: l.soldBy,
              quantity: l.quantity,
              unitPriceCents: l.unitPrice,
              fixedTotalCents: l.fixedTotal,
              taxRateBps: l.taxRateBps,
              taxCents: Math.round((l.lineTotal * l.taxRateBps) / 10000),
              snapEligible: l.snapEligible,
              depositCents: (l.depositPerUnit ?? 0) * (l.soldBy === 'each' ? l.quantity : 1),
              discountCents: 0,
              overrideReason: `Refund (${l.action === 'restock' ? 'Restocked' : 'Spoilage Discard'}): ${l.reason}`,
            })),
          },
          payments: {
            create: [
              {
                tenderType: input.refundTenderType,
                amountCents: totalRefundCents,
                authCode: `REFUND-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
              },
            ],
          },
        },
        include: { lines: true, payments: true },
      });

      // Inventory adjustment: restock vs. spoilage write-off
      for (const item of returnLinesData) {
        if (item.action === 'restock') {
          await tx.inventory.upsert({
            where: { storeId_productId: { storeId: originalSale.storeId, productId: item.productId } },
            update: { onHand: { increment: item.quantity } },
            create: { storeId: originalSale.storeId, productId: item.productId, onHand: item.quantity },
          });
        }
      }

      // Cash drawer adjustment for cash refunds
      if (input.refundTenderType === 'cash' && activeShift) {
        await tx.drawerMovement.create({
          data: {
            tenantId: u.tenantId,
            shiftId: activeShift.id,
            userId: u.sub,
            type: 'paid_out',
            amountCents: totalRefundCents,
            reason: `Customer return refund on ${originalSale.saleNumber}`,
          },
        });
      }

      // Loyalty points deduction (if points were earned)
      if (originalSale.customerId) {
        const pointsToDeduct = Math.floor(totalRefundCents / 100);
        if (pointsToDeduct > 0) {
          await tx.customer.update({
            where: { id: originalSale.customerId },
            data: { points: { decrement: pointsToDeduct } },
          });
        }
      }

      return refundSale;
    });

    // 6. Audit logging
    await this.audit.log(u.tenantId, 'sale.refund', {
      userId: u.sub,
      storeId: originalSale.storeId,
      entity: 'Sale',
      entityId: result.id,
      data: {
        originalSaleNumber: originalSale.saleNumber,
        refundSaleNumber: result.saleNumber,
        refundTotalCents: totalRefundCents,
        tenderType: input.refundTenderType,
        authorizedBy: supervisor ? supervisor.name : u.name,
        lines: returnLinesData.map((l) => ({ name: l.name, qty: l.quantity, action: l.action, reason: l.reason })),
      },
    });

    return {
      refundSale: result,
      originalSale,
      store: originalSale.store,
      refundReceipt: {
        saleNumber: result.saleNumber,
        completedAt: result.completedAt.toISOString(),
        store: {
          name: originalSale.store.name,
          address: originalSale.store.address,
          fnsNumber: originalSale.store.fnsNumber,
        },
        registerName: originalSale.register.name,
        cashierName: u.name,
        customer: originalSale.customer
          ? {
              name: originalSale.customer.name,
              phone: originalSale.customer.phone,
              points: originalSale.customer.points,
              earnedPoints: -Math.floor(totalRefundCents / 100),
            }
          : undefined,
        lines: returnLinesData.map((l) => ({
          name: `REFUND: ${l.name}`,
          soldBy: l.soldBy,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          fixedTotal: l.fixedTotal,
          taxRateBps: l.taxRateBps,
          snapEligible: l.snapEligible,
          depositPerUnit: l.depositPerUnit,
          lineTotal: l.lineTotal,
          overrideReason: `${l.action === 'restock' ? 'Restocked' : 'Spoilage Discard'} · ${l.reason}`,
        })),
        totals: {
          subtotal: subtotalRefund,
          deposits: depositRefund,
          tax: taxRefund,
          total: totalRefundCents,
          snapPaid: input.refundTenderType === 'ebt_snap' ? totalRefundCents : 0,
          snapEligible: 0,
        },
        payments: [
          {
            tenderType: `REFUND ${input.refundTenderType.toUpperCase()}`,
            amountCents: totalRefundCents,
          },
        ],
      },
    };
  }
}
