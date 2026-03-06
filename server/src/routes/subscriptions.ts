/**
 * Subscriptions API Route
 * 
 * Handles subscription checkout and management.
 */

import { Router, Response } from 'express';
import { z } from 'zod';
import { createCheckoutSession, PlanType, PLANS, isStripeConfigured } from '../services/stripe-service';
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
        userId: String(user.id),
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

export default router;
