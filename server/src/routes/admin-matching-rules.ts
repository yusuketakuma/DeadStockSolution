import { Router, Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../types';
import { adminWriteLimiter } from './admin-write-limiter';
import {
  getActiveMatchingRuleProfile,
  updateActiveMatchingRuleProfile,
  MatchingRuleValidationError,
  MatchingRuleVersionConflictError,
} from '../services/matching-rule-service';
import { logger } from '../services/logger';

const router = Router();

const updateMatchingRuleSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
  nameMatchThreshold: z.number().min(0).max(1).optional(),
  valueScoreMax: z.number().min(0).max(200).optional(),
  valueScoreDivisor: z.number().positive().max(1_000_000).optional(),
  balanceScoreMax: z.number().min(0).max(200).optional(),
  balanceScoreDiffFactor: z.number().min(0).max(1_000).optional(),
  distanceScoreMax: z.number().min(0).max(200).optional(),
  distanceScoreDivisor: z.number().positive().max(1_000_000).optional(),
  distanceScoreFallback: z.number().min(0).max(200).optional(),
  nearExpiryScoreMax: z.number().min(0).max(200).optional(),
  nearExpiryItemFactor: z.number().min(0).max(100).optional(),
  nearExpiryDays: z.number().int().min(1).max(365).optional(),
  diversityScoreMax: z.number().min(0).max(200).optional(),
  diversityItemFactor: z.number().min(0).max(100).optional(),
  favoriteBonus: z.number().min(0).max(200).optional(),
}).strict();

function hasRuleUpdateField(body: z.infer<typeof updateMatchingRuleSchema>): boolean {
  return [
    body.nameMatchThreshold,
    body.valueScoreMax,
    body.valueScoreDivisor,
    body.balanceScoreMax,
    body.balanceScoreDiffFactor,
    body.distanceScoreMax,
    body.distanceScoreDivisor,
    body.distanceScoreFallback,
    body.nearExpiryScoreMax,
    body.nearExpiryItemFactor,
    body.nearExpiryDays,
    body.diversityScoreMax,
    body.diversityItemFactor,
    body.favoriteBonus,
  ].some((value) => value !== undefined);
}

router.get('/matching-rules/profile', async (_req: AuthRequest, res: Response) => {
  try {
    const profile = await getActiveMatchingRuleProfile();
    res.json({ data: profile });
  } catch (err) {
    logger.error('Admin matching rule profile fetch error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'マッチングルールプロファイルの取得に失敗しました' });
  }
});

router.put('/matching-rules/profile', adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  const parsed = updateMatchingRuleSchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    res.status(400).json({ error: issue?.message ?? 'リクエスト形式が不正です' });
    return;
  }

  if (!hasRuleUpdateField(parsed.data)) {
    res.status(400).json({ error: '更新対象のスコア設定を1つ以上指定してください' });
    return;
  }

  try {
    const updated = await updateActiveMatchingRuleProfile(parsed.data);
    res.json({
      message: 'マッチングルールプロファイルを更新しました',
      data: updated,
    });
  } catch (err) {
    if (err instanceof MatchingRuleValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }

    if (err instanceof MatchingRuleVersionConflictError) {
      res.status(409).json({ error: err.message });
      return;
    }

    logger.error('Admin matching rule profile update error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'マッチングルールプロファイルの更新に失敗しました' });
  }
});

export default router;
