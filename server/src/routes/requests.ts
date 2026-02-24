import { Router, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../config/database';
import { userRequests } from '../db/schema';
import { requireLogin, requireAdmin } from '../middleware/auth';
import { logger } from '../services/logger';
import { handoffToOpenClaw } from '../services/openclaw-service';
import { AuthRequest } from '../types';

const router = Router();

router.use(requireLogin);
router.use(requireAdmin);

router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.id) {
      res.status(401).json({ error: 'ログインが必要です' });
      return;
    }

    const requestText = typeof req.body.message === 'string' ? req.body.message.trim() : '';
    if (!requestText || requestText.length > 2000) {
      res.status(400).json({ error: '要望は1〜2000文字で入力してください' });
      return;
    }

    const [created] = await db.insert(userRequests)
      .values({
        pharmacyId: req.user.id,
        requestText,
        openclawStatus: 'pending_handoff',
      })
      .returning({
        id: userRequests.id,
        openclawStatus: userRequests.openclawStatus,
        createdAt: userRequests.createdAt,
      });

    const handoff = await handoffToOpenClaw({
      requestId: created.id,
      pharmacyId: req.user.id,
      requestText,
    });

    let openclawStatus = created.openclawStatus;
    if (handoff.accepted) {
      await db.update(userRequests)
        .set({
          openclawStatus: handoff.status,
          openclawThreadId: handoff.threadId,
          openclawSummary: handoff.summary,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(userRequests.id, created.id));
      openclawStatus = handoff.status;
    }

    res.status(201).json({
      message: '要望を受け付けました',
      nextStep: handoff.note,
      handoff: {
        accepted: handoff.accepted,
        connectorConfigured: handoff.connectorConfigured,
        implementationBranch: handoff.implementationBranch,
        status: handoff.status,
      },
      request: {
        ...created,
        openclawStatus,
      },
    });
  } catch (err) {
    logger.error('User request submit error', { error: (err as Error).message });
    res.status(500).json({ error: '要望の送信に失敗しました' });
  }
});

export default router;
