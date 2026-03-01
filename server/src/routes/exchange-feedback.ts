import { Router, Response } from 'express';
import { and, eq, or } from 'drizzle-orm';
import { db } from '../config/database';
import {
  exchangeProposals,
  exchangeFeedback,
} from '../db/schema';
import { AuthRequest } from '../types';
import { recalculateTrustScoreForPharmacy } from '../services/trust-score-service';
import { logger } from '../services/logger';
import { parseExchangeIdOrBadRequest } from './exchange-utils';

const router = Router();

// Submit exchange feedback (participants only, completed proposals only)
router.post('/proposals/:id/feedback', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseExchangeIdOrBadRequest(res, req.params.id);
    if (!id) return;

    const rating = Number(req.body?.rating);
    const commentRaw = typeof req.body?.comment === 'string' ? req.body.comment : '';
    const comment = commentRaw.trim();
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      res.status(400).json({ error: '評価は1〜5で入力してください' });
      return;
    }
    if (comment.length > 300) {
      res.status(400).json({ error: 'コメントは300文字以内で入力してください' });
      return;
    }

    const [proposal] = await db.select({
      id: exchangeProposals.id,
      status: exchangeProposals.status,
      pharmacyAId: exchangeProposals.pharmacyAId,
      pharmacyBId: exchangeProposals.pharmacyBId,
    })
      .from(exchangeProposals)
      .where(and(
        eq(exchangeProposals.id, id),
        or(
          eq(exchangeProposals.pharmacyAId, req.user!.id),
          eq(exchangeProposals.pharmacyBId, req.user!.id),
        ),
      ))
      .limit(1);

    if (!proposal) {
      res.status(404).json({ error: 'マッチングが見つかりません' });
      return;
    }
    if (proposal.status !== 'completed') {
      res.status(400).json({ error: '完了済みマッチングのみ評価できます' });
      return;
    }

    const actorId = req.user!.id;
    const isA = proposal.pharmacyAId === actorId;

    const targetPharmacyId = isA ? proposal.pharmacyBId : proposal.pharmacyAId;
    const now = new Date().toISOString();

    await db.insert(exchangeFeedback).values({
      proposalId: proposal.id,
      fromPharmacyId: actorId,
      toPharmacyId: targetPharmacyId,
      rating,
      comment: comment.length > 0 ? comment : null,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [exchangeFeedback.proposalId, exchangeFeedback.fromPharmacyId],
      set: {
        rating,
        comment: comment.length > 0 ? comment : null,
        updatedAt: now,
      },
    });

    await recalculateTrustScoreForPharmacy(targetPharmacyId);

    res.status(201).json({ message: '取引評価を登録しました' });
  } catch (err) {
    logger.error('Proposal feedback error', { error: (err as Error).message });
    res.status(500).json({ error: '取引評価の登録に失敗しました' });
  }
});

export default router;
