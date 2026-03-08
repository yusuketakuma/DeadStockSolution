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
import { recordAuditLog } from '../services/audit-log-service';
import { logger } from '../services/logger';

const router = Router();

// ── バリデーションスキーマ ─────────────────────────────

const finiteNumber = z.number().finite();

const updateMatchingRuleSchema = z.object({
  expectedVersion: z.number().int({ message: 'expectedVersionは整数で指定してください' })
    .positive({ message: 'expectedVersionは1以上で指定してください' })
    .optional(),
  nameMatchThreshold: finiteNumber
    .min(0, { message: 'nameMatchThresholdは0以上で指定してください' })
    .max(1, { message: 'nameMatchThresholdは1以下で指定してください' })
    .optional(),
  valueScoreMax: finiteNumber
    .min(0, { message: 'valueScoreMaxは0以上で指定してください' })
    .max(200, { message: 'valueScoreMaxは200以下で指定してください' })
    .optional(),
  valueScoreDivisor: finiteNumber
    .positive({ message: 'valueScoreDivisorは0より大きい値で指定してください' })
    .max(1_000_000, { message: 'valueScoreDivisorは1000000以下で指定してください' })
    .optional(),
  balanceScoreMax: finiteNumber
    .min(0, { message: 'balanceScoreMaxは0以上で指定してください' })
    .max(200, { message: 'balanceScoreMaxは200以下で指定してください' })
    .optional(),
  balanceScoreDiffFactor: finiteNumber
    .min(0, { message: 'balanceScoreDiffFactorは0以上で指定してください' })
    .max(1_000, { message: 'balanceScoreDiffFactorは1000以下で指定してください' })
    .optional(),
  distanceScoreMax: finiteNumber
    .min(0, { message: 'distanceScoreMaxは0以上で指定してください' })
    .max(200, { message: 'distanceScoreMaxは200以下で指定してください' })
    .optional(),
  distanceScoreDivisor: finiteNumber
    .positive({ message: 'distanceScoreDivisorは0より大きい値で指定してください' })
    .max(1_000_000, { message: 'distanceScoreDivisorは1000000以下で指定してください' })
    .optional(),
  distanceScoreFallback: finiteNumber
    .min(0, { message: 'distanceScoreFallbackは0以上で指定してください' })
    .max(200, { message: 'distanceScoreFallbackは200以下で指定してください' })
    .optional(),
  nearExpiryScoreMax: finiteNumber
    .min(0, { message: 'nearExpiryScoreMaxは0以上で指定してください' })
    .max(200, { message: 'nearExpiryScoreMaxは200以下で指定してください' })
    .optional(),
  nearExpiryItemFactor: finiteNumber
    .min(0, { message: 'nearExpiryItemFactorは0以上で指定してください' })
    .max(100, { message: 'nearExpiryItemFactorは100以下で指定してください' })
    .optional(),
  nearExpiryDays: z.number().int({ message: 'nearExpiryDaysは整数で指定してください' })
    .min(1, { message: 'nearExpiryDaysは1以上で指定してください' })
    .max(365, { message: 'nearExpiryDaysは365以下で指定してください' })
    .optional(),
  diversityScoreMax: finiteNumber
    .min(0, { message: 'diversityScoreMaxは0以上で指定してください' })
    .max(200, { message: 'diversityScoreMaxは200以下で指定してください' })
    .optional(),
  diversityItemFactor: finiteNumber
    .min(0, { message: 'diversityItemFactorは0以上で指定してください' })
    .max(100, { message: 'diversityItemFactorは100以下で指定してください' })
    .optional(),
  favoriteBonus: finiteNumber
    .min(0, { message: 'favoriteBonusは0以上で指定してください' })
    .max(200, { message: 'favoriteBonusは200以下で指定してください' })
    .optional(),
  groupBonus: z.number().int({ message: 'groupBonusは整数で指定してください' })
    .min(0, { message: 'groupBonusは0以上で指定してください' })
    .max(50, { message: 'groupBonusは50以下で指定してください' })
    .optional(),
  nearExpiryDecayCurve: finiteNumber
    .min(0, { message: 'nearExpiryDecayCurveは0以上で指定してください' })
    .max(10, { message: 'nearExpiryDecayCurveは10以下で指定してください' })
    .optional(),
  successRateBonus: z.number().int({ message: 'successRateBonusは整数で指定してください' })
    .min(0, { message: 'successRateBonusは0以上で指定してください' })
    .max(50, { message: 'successRateBonusは50以下で指定してください' })
    .optional(),
  maxCandidates: z.number().int({ message: 'maxCandidatesは整数で指定してください' })
    .min(1, { message: 'maxCandidatesは1以上で指定してください' })
    .max(200, { message: 'maxCandidatesは200以下で指定してください' })
    .optional(),
}).strict();

// ── クロスフィールドバリデーション ─────────────────

function validateCrossFieldRules(data: z.infer<typeof updateMatchingRuleSchema>): string | null {
  // distanceScoreFallback が distanceScoreMax を超えないこと
  if (
    data.distanceScoreFallback !== undefined &&
    data.distanceScoreMax !== undefined &&
    data.distanceScoreFallback > data.distanceScoreMax
  ) {
    return 'distanceScoreFallbackはdistanceScoreMax以下で指定してください';
  }
  return null;
}

const RULE_FIELD_KEYS: ReadonlyArray<keyof z.infer<typeof updateMatchingRuleSchema>> = [
  'nameMatchThreshold', 'valueScoreMax', 'valueScoreDivisor',
  'balanceScoreMax', 'balanceScoreDiffFactor',
  'distanceScoreMax', 'distanceScoreDivisor', 'distanceScoreFallback',
  'nearExpiryScoreMax', 'nearExpiryItemFactor', 'nearExpiryDays',
  'diversityScoreMax', 'diversityItemFactor',
  'favoriteBonus', 'groupBonus', 'nearExpiryDecayCurve', 'successRateBonus', 'maxCandidates',
];

function hasRuleUpdateField(body: z.infer<typeof updateMatchingRuleSchema>): boolean {
  return RULE_FIELD_KEYS.some((key) => body[key] !== undefined);
}

// ── ルート ─────────────────────────────────────

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

async function handleMatchingRuleUpdate(req: AuthRequest, res: Response): Promise<void> {
  const parsed = updateMatchingRuleSchema.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    res.status(400).json({
      error: issue?.message ?? 'リクエスト形式が不正です',
      field: issue?.path?.[0] ?? null,
    });
    return;
  }

  if (!hasRuleUpdateField(parsed.data)) {
    res.status(400).json({ error: '更新対象のスコア設定を1つ以上指定してください' });
    return;
  }

  const crossFieldError = validateCrossFieldRules(parsed.data);
  if (crossFieldError) {
    res.status(400).json({ error: crossFieldError });
    return;
  }

  try {
    const updated = await updateActiveMatchingRuleProfile(parsed.data);

    // 監査ログ記録（ルール変更はファイア&フォーゲット）
    if (req.user) {
      void recordAuditLog({
        adminId: req.user.id,
        targetPharmacyId: 0, // システム全体の設定変更
        action: 'verify', // matching-rule-update の代替として verify を使用
        previousStatus: String(parsed.data.expectedVersion ?? 'unknown'),
        newStatus: String(updated.version),
        reason: `マッチングルール更新: ${Object.keys(parsed.data).filter((k) => k !== 'expectedVersion').join(', ')}`,
      }).catch((err) => {
        logger.error('Failed to record audit log for matching rule update', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

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
}

router.put('/matching-rules/profile', adminWriteLimiter, handleMatchingRuleUpdate);
router.patch('/matching-rules/profile', adminWriteLimiter, handleMatchingRuleUpdate);

export default router;
