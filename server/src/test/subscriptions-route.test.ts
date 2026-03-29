import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createCheckoutSession: vi.fn(),
  cancelSubscription: vi.fn(),
  isStripeConfigured: vi.fn(),
  getActiveSubscription: vi.fn(),
  getPharmacySubscriptions: vi.fn(),
  updateSubscriptionStatus: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (
    req: { user?: { id: number; email: string; isAdmin: boolean } },
    _res: unknown,
    next: () => void,
  ) => {
    req.user = { id: 7, email: 'owner@example.com', isAdmin: false };
    next();
  },
}));

vi.mock('../services/stripe-service', () => ({
  createCheckoutSession: mocks.createCheckoutSession,
  cancelSubscription: mocks.cancelSubscription,
  isStripeConfigured: mocks.isStripeConfigured,
  PLANS: {
    light: { name: 'ライトプラン', price: 4980 },
    standard: { name: 'スタンダードプラン', price: 9800 },
    enterprise: { name: 'エンタープライズプラン', price: 19800 },
  },
}));

vi.mock('../services/subscription-service', () => ({
  getActiveSubscription: mocks.getActiveSubscription,
  getPharmacySubscriptions: mocks.getPharmacySubscriptions,
  updateSubscriptionStatus: mocks.updateSubscriptionStatus,
}));

vi.mock('../services/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

async function createApp() {
  vi.resetModules();
  const { default: router } = await import('../routes/subscriptions');
  const app = express();
  app.use(express.json());
  app.use('/api/subscriptions', router);
  return app;
}

describe('subscriptions routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isStripeConfigured.mockReturnValue(true);
    mocks.getPharmacySubscriptions.mockResolvedValue([]);
    mocks.getActiveSubscription.mockResolvedValue(null);
    mocks.createCheckoutSession.mockResolvedValue({
      success: true,
      sessionId: 'cs_123',
      url: 'https://checkout.stripe.test/cs_123',
    });
    mocks.cancelSubscription.mockResolvedValue({ success: true });
    process.env.FRONTEND_URL = 'https://app.deadstock.test';
  });

  it('returns available plans and Stripe configuration state', async () => {
    const app = await createApp();

    const res = await request(app).get('/api/subscriptions/plans');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      plans: [
        { id: 'light', name: 'ライトプラン', price: 4980, priceFormatted: '¥4,980' },
        { id: 'standard', name: 'スタンダードプラン', price: 9800, priceFormatted: '¥9,800' },
        { id: 'enterprise', name: 'エンタープライズプラン', price: 19800, priceFormatted: '¥19,800' },
      ],
      stripeConfigured: true,
    });
  });

  it('rejects checkout when Stripe is not configured', async () => {
    mocks.isStripeConfigured.mockReturnValue(false);
    const app = await createApp();

    const res = await request(app).post('/api/subscriptions/checkout').send({ plan: 'standard' });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('STRIPE_NOT_CONFIGURED');
  });

  it('validates checkout request payloads', async () => {
    const app = await createApp();

    const res = await request(app).post('/api/subscriptions/checkout').send({ plan: 'invalid-plan' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('無効なリクエストです');
    expect(mocks.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('prevents checkout when an active subscription already exists', async () => {
    mocks.getActiveSubscription.mockResolvedValue({
      stripeSubscriptionId: 'sub_existing',
      status: 'active',
    });
    const app = await createApp();

    const res = await request(app).post('/api/subscriptions/checkout').send({ plan: 'standard' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ACTIVE_SUBSCRIPTION_EXISTS');
  });

  it('creates a checkout session with default URLs and pharmacy metadata', async () => {
    const app = await createApp();

    const res = await request(app).post('/api/subscriptions/checkout').send({ plan: 'enterprise' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      sessionId: 'cs_123',
      url: 'https://checkout.stripe.test/cs_123',
    });
    expect(mocks.createCheckoutSession).toHaveBeenCalledWith({
      plan: 'enterprise',
      successUrl: 'https://app.deadstock.test/subscription/success?session_id={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://app.deadstock.test/subscription/cancel',
      metadata: {
        pharmacyId: '7',
        userEmail: 'owner@example.com',
      },
    });
  });

  it('returns 404 when cancelling without an active subscription', async () => {
    const app = await createApp();

    const res = await request(app).post('/api/subscriptions/cancel').send({ immediately: true });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NO_ACTIVE_SUBSCRIPTION');
  });

  it('cancels immediately and persists the canceled status', async () => {
    mocks.getActiveSubscription.mockResolvedValue({
      stripeSubscriptionId: 'sub_live',
      status: 'active',
    });
    const app = await createApp();

    const res = await request(app).post('/api/subscriptions/cancel').send({ immediately: true });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.cancelAtPeriodEnd).toBe(false);
    expect(mocks.cancelSubscription).toHaveBeenCalledWith('sub_live', true);
    expect(mocks.updateSubscriptionStatus).toHaveBeenCalledWith(
      'sub_live',
      'canceled',
      false,
      expect.any(String),
    );
  });
});
