import { Router, Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import { requireLogin } from '../middleware/auth';
import * as pushSubscriptionService from '../services/push-subscription-service';
import { logger } from '../services/logger';

const router = Router();

// ── Zod Schemas ──────────────────────────────────

const SubscribeBody = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
});

const UnsubscribeBody = z.object({
  endpoint: z.string().url(),
});

// ── GET /vapid-public-key — VAPID公開鍵取得（認証不要） ──────────────────────────────────

router.get('/vapid-public-key', (_req, res: Response) => {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  if (!publicKey) {
    res.status(404).json({ error: 'VAPID公開鍵が設定されていません' });
    return;
  }
  res.json({ publicKey });
});

// ── POST /subscribe — 購読登録（認証必要） ──────────────────────────────────

router.post('/subscribe', requireLogin, async (req: AuthRequest, res: Response) => {
  try {
    const parsed = SubscribeBody.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      res.status(400).json({ error: issue?.message ?? 'リクエスト形式が不正です' });
      return;
    }

    const pharmacyId = req.user!.id;
    const userAgent = req.headers['user-agent'] ?? '';

    const result = await pushSubscriptionService.subscribe(
      pharmacyId,
      parsed.data,
      userAgent,
    );

    res.status(201).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Push subscribe error', { error: message });
    res.status(500).json({ error: message });
  }
});

// ── DELETE /subscribe — 購読解除（認証必要） ──────────────────────────────────

router.delete('/subscribe', requireLogin, async (req: AuthRequest, res: Response) => {
  try {
    const parsed = UnsubscribeBody.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      res.status(400).json({ error: issue?.message ?? 'リクエスト形式が不正です' });
      return;
    }

    const pharmacyId = req.user!.id;
    const removed = await pushSubscriptionService.unsubscribe(pharmacyId, parsed.data.endpoint);

    if (!removed) {
      res.status(404).json({ error: '購読が見つかりません' });
      return;
    }

    res.status(204).send();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Push unsubscribe error', { error: message });
    res.status(500).json({ error: message });
  }
});

export default router;
