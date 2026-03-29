import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyWebhookSignature: vi.fn(),
  getSubscription: vi.fn(),
  upsertSubscription: vi.fn(),
  updateSubscriptionStatus: vi.fn(),
  deleteSubscription: vi.fn(),
  db: {
    select: vi.fn(),
  },
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../services/stripe-service', () => ({
  verifyWebhookSignature: mocks.verifyWebhookSignature,
  getSubscription: mocks.getSubscription,
  getCustomer: vi.fn(),
  PLANS: {
    light: {
      name: 'ライトプラン',
      price: 4980,
      priceIdEnvKey: 'STRIPE_PRICE_ID_LIGHT',
      priceIdLiveEnvKey: 'STRIPE_PRICE_ID_LIGHT_LIVE',
    },
    standard: {
      name: 'スタンダードプラン',
      price: 9800,
      priceIdEnvKey: 'STRIPE_PRICE_ID_STANDARD',
      priceIdLiveEnvKey: 'STRIPE_PRICE_ID_STANDARD_LIVE',
    },
    enterprise: {
      name: 'エンタープライズプラン',
      price: 19800,
      priceIdEnvKey: 'STRIPE_PRICE_ID_ENTERPRISE',
      priceIdLiveEnvKey: 'STRIPE_PRICE_ID_ENTERPRISE_LIVE',
    },
  },
}));

vi.mock('../services/subscription-service', () => ({
  upsertSubscription: mocks.upsertSubscription,
  updateSubscriptionStatus: mocks.updateSubscriptionStatus,
  deleteSubscription: mocks.deleteSubscription,
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../db/schema', () => ({
  pharmacies: {
    id: 'id',
    email: 'email',
  },
}));

vi.mock('../services/logger', () => ({
  logger: mocks.logger,
}));

async function createApp() {
  vi.resetModules();
  const { default: router } = await import('../routes/stripe-webhook');
  const app = express();
  app.use(express.json());
  app.use('/api/stripe', router);
  return app;
}

describe('stripe-webhook route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    process.env.STRIPE_PRICE_ID_STANDARD = 'price_standard_test';
  });

  it('returns 400 when stripe-signature header is missing', async () => {
    const app = await createApp();

    const res = await request(app).post('/api/stripe/webhook').send({ id: 'evt_missing' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Missing stripe-signature header' });
    expect(mocks.verifyWebhookSignature).not.toHaveBeenCalled();
  });

  it('returns 400 when signature verification fails', async () => {
    mocks.verifyWebhookSignature.mockReturnValue({
      success: false,
      error: 'bad signature',
    });
    const app = await createApp();

    const res = await request(app)
      .post('/api/stripe/webhook')
      .set('stripe-signature', 'invalid')
      .send({ id: 'evt_invalid' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid signature' });
  });

  it('handles checkout.session.completed and upserts the subscription', async () => {
    mocks.verifyWebhookSignature.mockReturnValue({
      success: true,
      event: {
        id: 'evt_checkout',
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test',
            customer: 'cus_test',
            subscription: 'sub_test',
            metadata: { pharmacyId: '42' },
          },
        },
      },
    });
    mocks.getSubscription.mockResolvedValue({
      id: 'sub_test',
      customer: 'cus_test',
      status: 'active',
      items: {
        data: [{ price: { id: 'price_standard_test' } }],
      },
      current_period_start: 1710000000,
      current_period_end: 1712592000,
      cancel_at_period_end: false,
    });
    const app = await createApp();

    const res = await request(app)
      .post('/api/stripe/webhook')
      .set('stripe-signature', 'sig_ok')
      .send({ id: 'evt_checkout' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    expect(mocks.upsertSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        pharmacyId: 42,
        stripeSubscriptionId: 'sub_test',
        stripeCustomerId: 'cus_test',
        planType: 'standard',
        status: 'active',
        cancelAtPeriodEnd: false,
      }),
    );
  });

  it('updates subscription status for customer.subscription.updated events', async () => {
    mocks.verifyWebhookSignature.mockReturnValue({
      success: true,
      event: {
        id: 'evt_updated',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_updated',
            customer: 'cus_test',
            status: 'past_due',
            cancel_at_period_end: true,
            canceled_at: 1710000000,
          },
        },
      },
    });
    const app = await createApp();

    const res = await request(app)
      .post('/api/stripe/webhook')
      .set('stripe-signature', 'sig_ok')
      .send({ id: 'evt_updated' });

    expect(res.status).toBe(200);
    expect(mocks.updateSubscriptionStatus).toHaveBeenCalledWith(
      'sub_updated',
      'past_due',
      true,
      '2024-03-09T16:00:00.000Z',
    );
  });

  it('acknowledges unhandled event types without side effects', async () => {
    mocks.verifyWebhookSignature.mockReturnValue({
      success: true,
      event: {
        id: 'evt_unhandled',
        type: 'payment_intent.created',
        data: { object: { id: 'pi_test' } },
      },
    });
    const app = await createApp();

    const res = await request(app)
      .post('/api/stripe/webhook')
      .set('stripe-signature', 'sig_ok')
      .send({ id: 'evt_unhandled' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    expect(mocks.upsertSubscription).not.toHaveBeenCalled();
    expect(mocks.updateSubscriptionStatus).not.toHaveBeenCalled();
  });
});
