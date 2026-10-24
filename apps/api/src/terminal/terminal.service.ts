import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../prisma.service';

@Injectable()
export class TerminalService {
  private stripe: Stripe | null = null;
  private logger = new Logger(TerminalService.name);

  constructor(private db: PrismaService) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (key && key.startsWith('sk_')) {
      this.stripe = new Stripe(key);
      this.logger.log('Stripe Terminal initialized with STRIPE_SECRET_KEY');
    } else {
      this.logger.warn('STRIPE_SECRET_KEY not provided. Running in simulated fallback mode.');
    }
  }

  isConfigured(): boolean {
    return Boolean(this.stripe);
  }

  async getStatus(storeId?: string) {
    if (!this.stripe) {
      return {
        configured: false,
        mode: 'simulated_fallback',
        message: 'Add STRIPE_SECRET_KEY to enable live Stripe Terminal processing.',
        reader: {
          id: 'simulated-reader-demo',
          label: 'Simulated WisePOS E (In-Memory)',
          status: 'online',
          deviceType: 'simulated_wisepos_e',
        },
      };
    }

    try {
      const reader = await this.getOrCreateSimulatedReader(storeId);
      return {
        configured: true,
        mode: 'stripe',
        reader: {
          id: reader.id,
          label: reader.label || reader.serial_number,
          status: reader.status,
          deviceType: reader.device_type,
          ipAddress: reader.ip_address,
        },
      };
    } catch (e) {
      return {
        configured: true,
        mode: 'stripe_error',
        error: (e as Error).message,
        reader: {
          id: 'simulated-reader-demo',
          label: 'Simulated WisePOS E (Fallback)',
          status: 'online',
          deviceType: 'simulated_wisepos_e',
        },
      };
    }
  }

  async getOrCreateSimulatedReader(storeId?: string) {
    if (!this.stripe) throw new Error('Stripe not configured');

    // 1. Ensure location exists
    const locations = await this.stripe.terminal.locations.list({ limit: 5 });
    let locationId = locations.data[0]?.id;
    if (!locationId) {
      const loc = await this.stripe.terminal.locations.create({
        display_name: 'Main Street Supermarket',
        address: {
          line1: '100 Main St',
          city: 'Springfield',
          state: 'MA',
          postal_code: '01103',
          country: 'US',
        },
      });
      locationId = loc.id;
    }

    // 2. Check if a reader is already registered
    const readers = await this.stripe.terminal.readers.list({ location: locationId, limit: 10 });
    let reader = readers.data.find((r) => r.status === 'online') || readers.data[0];

    // 3. If no reader, register a simulated WisePOS E reader using Stripe's simulated registration code
    if (!reader) {
      reader = await this.stripe.terminal.readers.create({
        location: locationId,
        registration_code: 'simulated-wpos-1',
        label: 'Lane 1 - Simulated WisePOS E',
      });
    }

    // If storeId is provided and register has no stripeReaderId, save it
    if (storeId && reader) {
      const reg = await this.db.register.findFirst({ where: { storeId, active: true } });
      if (reg && !reg.stripeReaderId) {
        await this.db.register.update({
          where: { id: reg.id },
          data: { stripeReaderId: reader.id },
        });
      }
    }

    return reader;
  }

  async createPaymentIntent(amountCents: number, storeId?: string) {
    if (!this.stripe) {
      // Mock flow
      const mockId = `pi_sim_${Date.now()}`;
      return {
        mode: 'simulated_fallback',
        paymentIntentId: mockId,
        readerId: 'simulated-reader-demo',
        status: 'requires_payment_method',
      };
    }

    const reader = await this.getOrCreateSimulatedReader(storeId);

    // Create payment intent for in-person card present transaction
    const pi = await this.stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'usd',
      payment_method_types: ['card_present'],
      capture_method: 'automatic',
      description: `FreshPOS Lane Checkout - $${(amountCents / 100).toFixed(2)}`,
    } as any);

    // Send payment intent to the terminal reader to prompt customer
    const processedReader = await this.stripe.terminal.readers.processPaymentIntent(reader.id, {
      payment_intent: pi.id,
    });

    return {
      mode: 'stripe',
      paymentIntentId: pi.id,
      clientSecret: pi.client_secret,
      readerId: reader.id,
      status: processedReader.action?.status || 'in_progress',
    };
  }

  async simulateCustomerCard(readerId: string, paymentIntentId: string) {
    if (!this.stripe || readerId === 'simulated-reader-demo' || paymentIntentId.startsWith('pi_sim_')) {
      return {
        status: 'succeeded',
        cardBrand: 'Visa',
        last4: '4242',
        authCode: `AUTH-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
      };
    }

    // Use Stripe testHelpers to simulate card tap / swipe / insert on reader
    await this.stripe.testHelpers.terminal.readers.presentPaymentMethod(readerId);

    // Poll payment intent status
    const pi = (await this.stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['charges.data.payment_method_details'],
    })) as any;

    const charge = pi.charges?.data?.[0];
    const cardPresent = charge?.payment_method_details?.card_present;

    return {
      status: pi.status,
      cardBrand: cardPresent?.brand ? cardPresent.brand.toUpperCase() : 'VISA',
      last4: cardPresent?.last4 || '4242',
      authCode: cardPresent?.receipt?.authorization_code || `AUTH-${pi.id.slice(-6).toUpperCase()}`,
    };
  }

  async getPaymentStatus(paymentIntentId: string) {
    if (!this.stripe || paymentIntentId.startsWith('pi_sim_')) {
      return {
        status: 'succeeded',
        cardBrand: 'Visa',
        last4: '4242',
        authCode: `AUTH-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
      };
    }

    const pi = (await this.stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['charges.data.payment_method_details'],
    })) as any;

    const charge = pi.charges?.data?.[0];
    const cardPresent = charge?.payment_method_details?.card_present;

    return {
      status: pi.status,
      amountCents: pi.amount,
      cardBrand: cardPresent?.brand ? cardPresent.brand.toUpperCase() : 'VISA',
      last4: cardPresent?.last4 || '4242',
      authCode: cardPresent?.receipt?.authorization_code || `AUTH-${pi.id.slice(-6).toUpperCase()}`,
    };
  }

  async cancelAction(readerId?: string, paymentIntentId?: string) {
    if (!this.stripe) {
      return { canceled: true };
    }

    try {
      if (readerId && readerId !== 'simulated-reader-demo') {
        await this.stripe.terminal.readers.cancelAction(readerId);
      }
      if (paymentIntentId && !paymentIntentId.startsWith('pi_sim_')) {
        await this.stripe.paymentIntents.cancel(paymentIntentId);
      }
    } catch (e) {
      this.logger.warn(`Failed to cancel terminal action: ${(e as Error).message}`);
    }

    return { canceled: true };
  }
}
