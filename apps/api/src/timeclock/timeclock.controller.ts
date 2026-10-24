import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../audit.service';
import { CurrentUser, Public, type AuthUser } from '../auth/auth.guard';
import { parse } from '../auth/auth.controller';

const PunchInput = z.object({
  tenant: z.string().optional().default('demo'),
  storeId: z.string().optional(),
  employeeNo: z.string(),
  pin: z.string().regex(/^\d{4,8}$/),
  note: z.string().optional(),
});

@Controller('time-clock')
export class TimeClockController {
  constructor(private db: PrismaService, private audit: AuditService) {}

  @Public()
  @Post('punch')
  async punch(@Body() body: unknown) {
    const input = parse(PunchInput, body);

    const tenantFilter = input.tenant
      ? {
          OR: [
            { tenantId: input.tenant },
            { tenant: { slug: input.tenant } },
          ],
        }
      : {};

    const user = await this.db.user.findFirst({
      where: {
        employeeNo: input.employeeNo,
        active: true,
        ...tenantFilter,
      },
      include: {
        stores: true,
      },
    });

    if (!user || !(await bcrypt.compare(input.pin, user.pinHash))) {
      throw new UnauthorizedException('Invalid employee # or PIN');
    }

    const storeId =
      input.storeId ||
      user.stores.find((s) => s.storeId === input.storeId)?.storeId ||
      user.stores[0]?.storeId;

    if (!storeId) {
      throw new BadRequestException('Employee is not assigned to any store');
    }

    // Check if employee has an active (unclosed) clock-in
    const activePunch = await this.db.timeClock.findFirst({
      where: {
        tenantId: user.tenantId,
        userId: user.id,
        clockOut: null,
      },
      orderBy: { clockIn: 'desc' },
    });

    const now = new Date();

    if (!activePunch) {
      // CLOCK IN
      const punch = await this.db.timeClock.create({
        data: {
          tenantId: user.tenantId,
          storeId,
          userId: user.id,
          clockIn: now,
          note: input.note,
        },
      });

      await this.audit.log(user.tenantId, 'time_clock.clock_in', {
        userId: user.id,
        storeId,
        entity: 'TimeClock',
        entityId: punch.id,
      });

      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      return {
        action: 'clock_in',
        employeeId: user.id,
        employeeName: user.name,
        clockIn: punch.clockIn,
        message: `Clocked in at ${timeStr}. Have a great shift, ${user.name.split(' ')[0]}!`,
      };
    } else {
      // CLOCK OUT
      const durationHours = Math.max(
        0,
        Number(((now.getTime() - new Date(activePunch.clockIn).getTime()) / (1000 * 60 * 60)).toFixed(2)),
      );

      const punch = await this.db.timeClock.update({
        where: { id: activePunch.id },
        data: {
          clockOut: now,
          hoursWorked: durationHours,
          note: input.note ?? activePunch.note,
        },
      });

      await this.audit.log(user.tenantId, 'time_clock.clock_out', {
        userId: user.id,
        storeId: input.storeId,
        entity: 'TimeClock',
        entityId: punch.id,
        data: { hoursWorked: durationHours },
      });

      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const hoursText =
        durationHours >= 1
          ? `${durationHours} hours`
          : `${Math.round(durationHours * 60)} minutes`;

      return {
        action: 'clock_out',
        employeeId: user.id,
        employeeName: user.name,
        clockIn: punch.clockIn,
        clockOut: punch.clockOut,
        hoursWorked: durationHours,
        message: `Clocked out at ${timeStr}. Total time worked: ${hoursText}. Great job today!`,
      };
    }
  }

  @Get('status')
  async getStatus(@CurrentUser() user: AuthUser) {
    const activePunch = await this.db.timeClock.findFirst({
      where: {
        tenantId: user.tenantId,
        userId: user.sub,
        clockOut: null,
      },
      orderBy: { clockIn: 'desc' },
    });

    return {
      isClockedIn: Boolean(activePunch),
      activePunch,
    };
  }

  @Get('entries')
  async getEntries(
    @CurrentUser() user: AuthUser,
    @Query('take') take = '100',
    @Query('skip') skip = '0',
  ) {
    const where = { tenantId: user.tenantId };
    const [items, total] = await Promise.all([
      this.db.timeClock.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, employeeNo: true, role: true } },
          store: { select: { id: true, name: true } },
        },
        orderBy: { clockIn: 'desc' },
        take: Math.min(200, Number(take)),
        skip: Number(skip),
      }),
      this.db.timeClock.count({ where }),
    ]);

    const totalHoursWorked = items
      .filter((i) => i.hoursWorked !== null)
      .reduce((sum, i) => sum + (i.hoursWorked || 0), 0);

    return {
      items,
      total,
      totalHoursWorked: Number(totalHoursWorked.toFixed(2)),
    };
  }
}
