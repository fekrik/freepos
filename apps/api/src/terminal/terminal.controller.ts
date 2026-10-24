import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { TerminalService } from './terminal.service';
import { CurrentUser, RequirePermission, type AuthUser } from '../auth/auth.guard';
import { parse } from '../auth/auth.controller';

const CreateIntentInput = z.object({
  amountCents: z.number().int().positive(),
  storeId: z.string().optional(),
});

const SimulateCardInput = z.object({
  readerId: z.string(),
  paymentIntentId: z.string(),
});

const CancelActionInput = z.object({
  readerId: z.string().optional(),
  paymentIntentId: z.string().optional(),
});

@Controller('terminal')
export class TerminalController {
  constructor(private terminal: TerminalService) {}

  @Get('status')
  @RequirePermission('sale.create')
  async getStatus(@CurrentUser() user: AuthUser, @Query('storeId') storeId?: string) {
    const targetStore = storeId || user.storeId;
    return this.terminal.getStatus(targetStore);
  }

  @Post('create-payment-intent')
  @RequirePermission('sale.create')
  async createPaymentIntent(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const input = parse(CreateIntentInput, body);
    const storeId = input.storeId || user.storeId;
    return this.terminal.createPaymentIntent(input.amountCents, storeId);
  }

  @Post('simulate-card')
  @RequirePermission('sale.create')
  async simulateCard(@Body() body: unknown) {
    const input = parse(SimulateCardInput, body);
    return this.terminal.simulateCustomerCard(input.readerId, input.paymentIntentId);
  }

  @Get('payment-status/:id')
  @RequirePermission('sale.create')
  async getPaymentStatus(@Param('id') paymentIntentId: string) {
    return this.terminal.getPaymentStatus(paymentIntentId);
  }

  @Post('cancel')
  @RequirePermission('sale.create')
  async cancelAction(@Body() body: unknown) {
    const input = parse(CancelActionInput, body);
    return this.terminal.cancelAction(input.readerId, input.paymentIntentId);
  }
}
