/**
 * Subscriptions API Route
 *
 * Handles subscription checkout and management.
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { createCheckoutSession, cancelSubscription as stripeCancelSubscription, PlanType, PLANS, isStripeConfigured } from '../services/stripe-service';
import { getActiveSubscription, getPharmacySubscriptions, updateSubscriptionStatus } from '../services/subscription-service';
import { logger } from '../services/logger';
import { requireLogin } from '../middleware/auth';
import { AuthRequest } from '../types';

const router = Router();

// Validation schema for checkout request
const checkoutSchema = z.object({
  plan: z.enum(['light', 'standard', 'enterprise']),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

// Validation schema for cancel request
const cancelSchema = z.object({
  immediately: z.boolean().optional().default(false),
});

// GET /api/subscriptions/plans - Get available plans
router.get('/plans', (_req, res: Response): void => {
  res.json({
    plans: Object.entries(PLANS).map(([key, config]) => ({
      id: key,
      name: config.name,
      price: config.price,
      priceFormatted: `¥${config.price.toLocaleString()}`,
    })),
    stripeConfigured: isStripeConfigured(),
  });
});

// GET /api/subscriptions - Get current user's subscriptions
router.get(
  '/',
  requireLogin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    const user = req.user!;

    try {
      const subscriptions = await getPharmacySubscriptions(user.id);

      res.json({
        subscriptions: subscriptions.map(sub => ({
          id: sub.id,
          planType: sub.planType,
          status: sub.status,
          currentPeriodStart: sub.currentPeriodStart,
          currentPeriodEnd: sub.currentPeriodEnd,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          canceledAt: sub.canceledAt,
          createdAt: sub.createdAt,
        })),
        activeSubscription: subscriptions.find(s => s.status === 'active') ?? null,
      });
    } catch (error) {
      logger.error('Failed to get subscriptions', {
        error: error instanceof Error ? error.message : String(error),
        userId: user.id,
      });
      res.status(500).json({ error: 'サブスクリプション情報の取得に失敗しました' });
    }
  }
);

// POST /api/subscriptions/checkout - Create checkout session
router.post(
  '/checkout',
  requireLogin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    if (!isStripeConfigured()) {
      res.status(503).json({
        error: 'サブスクリプション機能は現在準備中です',
        code: 'STRIPE_NOT_CONFIGURED',
      });
      return;
    }

    // Validate request body
    const parseResult = checkoutSchema.safeParse(req.body);

    if (!parseResult.success) {
      res.status(400).json({
        error: '無効なリクエストです',
        details: parseResult.error.issues,
      });
      return;
    }

    const { plan, successUrl, cancelUrl } = parseResult.data;
    const user = req.user!;

    // Check if user already has an active subscription
    const activeSub = await getActiveSubscription(user.id);
    if (activeSub) {
      res.status(400).json({
        error: '既に有効なサブスクリプションがあります',
        code: 'ACTIVE_SUBSCRIPTION_EXISTS',
      });
      return;
    }

    // Build URLs
    const baseUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    const finalSuccessUrl = successUrl ?? `${baseUrl}/subscription/success?session_id={CHECKOUT_SESSION_ID}`;
    const finalCancelUrl = cancelUrl ?? `${baseUrl}/subscription/cancel`;

    logger.info('Creating checkout session', {
      userId: user.id,
      plan,
    });

    const result = await createCheckoutSession({
      plan: plan as PlanType,
      successUrl: finalSuccessUrl,
      cancelUrl: finalCancelUrl,
      metadata: {
        pharmacyId: String(user.id),
        userEmail: user.email ?? '',
      },
    });

    if (!result.success) {
      res.status(500).json({
        error: 'チェックアウトセッションの作成に失敗しました',
        details: result.error,
      });
      return;
    }

    res.json({
      sessionId: result.sessionId,
      url: result.url,
    });
  }
);

// POST /api/subscriptions/cancel - Cancel subscription
router.post(
  '/cancel',
  requireLogin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    if (!isStripeConfigured()) {
      res.status(503).json({
        error: 'サブスクリプション機能は現在準備中です',
        code: 'STRIPE_NOT_CONFIGURED',
      });
      return;
    }

    // Validate request body
    const parseResult = cancelSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: '無効なリクエストです',
        details: parseResult.error.issues,
      });
      return;
    }

    const { immediately } = parseResult.data;
    const user = req.user!;

    // Get active subscription
    const activeSub = await getActiveSubscription(user.id);
    if (!activeSub) {
      res.status(404).json({
        error: '有効なサブスクリプションがありません',
        code: 'NO_ACTIVE_SUBSCRIPTION',
      });
      return;
    }

    logger.info('Canceling subscription', {
      userId: user.id,
      subscriptionId: activeSub.stripeSubscriptionId,
      immediately,
    });

    // Cancel in Stripe
    const result = await stripeCancelSubscription(activeSub.stripeSubscriptionId, immediately);

    if (!result.success) {
      res.status(500).json({
        error: 'サブスクリプションのキャンセルに失敗しました',
        details: result.error,
      });
      return;
    }

    // Update database
    const newStatus = immediately ? 'canceled' : activeSub.status;
    await updateSubscriptionStatus(
      activeSub.stripeSubscriptionId,
      newStatus,
      !immediately, // cancelAtPeriodEnd is true if not immediate
      immediately ? new Date().toISOString() : null
    );

    res.json({
      success: true,
      message: immediately
        ? 'サブスクリプションを即時キャンセルしました'
        : 'サブスクリプションは期間終了時にキャンセルされます',
      canceledAt: immediately ? new Date().toISOString() : null,
      cancelAtPeriodEnd: !immediately,
    });
  }
);

export default router;
