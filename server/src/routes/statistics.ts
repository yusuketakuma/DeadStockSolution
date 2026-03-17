import { Router, Response } from 'express';
import { eq, and, or, count, sum, max, countDistinct, isNull, sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
  uploadJobs,
  deadStockItems,
  exchangeProposals,
  exchangeHistory,
  matchCandidateSnapshots,
  pharmacies,
  exchangeFeedback,
  pharmacyRelationships,
  predictiveAlerts,
} from '../db/schema';
import { requireLogin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { getPharmacyRiskDetail } from '../services/expiry-risk-service';
import { logger } from '../services/logger';

import {
  invalidateStatisticsSummaryCache,
  invalidateStatisticsSummaryCacheForPharmacies,
  clearStatisticsSummaryCacheForTests,
  getCachedStatisticsSummary,
  setCachedStatisticsSummary,
} from '../services/statistics-cache-service';

export {
  invalidateStatisticsSummaryCache,
  invalidateStatisticsSummaryCacheForPharmacies,
  clearStatisticsSummaryCacheForTests,
};

const router = Router();

function buildStatisticsSummaryPayload(params: {
  uploadStats: Array<{ uploadType: string; count: number; lastDate: string | null }>;
  deadStockStats: Array<{ count: number; totalValue: string | number | null }>;
  riskDetail: Awaited<ReturnType<typeof getPharmacyRiskDetail>> | null;
  proposalStats: Array<{ sent: unknown; received: unknown; completed: unknown; pendingAction: unknown }>;
  exchangeStats: Array<{ totalCount: number; totalValue: string | number | null; partnerCount: number }>;
  matchSnapshot: Array<{ candidateCount: number | string | null }>;
  trustScore: Array<{ trustScore: string | number | null; ratingCount: number | null; positiveRate: string | number | null }>;
  feedbackReceived: Array<{ avgRating: number | null; count: number }>;
  favoriteCount: Array<{ count: number }>;
  activeAlertCount: Array<{ count: number }>;
}) {
  const dsUpload = params.uploadStats.find((upload) => upload.uploadType === 'dead_stock');
  const umUpload = params.uploadStats.find((upload) => upload.uploadType === 'used_medication');
  const ts = params.trustScore[0];
  const fb = params.feedbackReceived[0];
  const ps = params.proposalStats[0];
  const es = params.exchangeStats[0];

  return {
    uploads: {
      deadStockCount: dsUpload?.count ?? 0,
      usedMedicationCount: umUpload?.count ?? 0,
      lastDeadStockUpload: dsUpload?.lastDate ?? null,
      lastUsedMedicationUpload: umUpload?.lastDate ?? null,
    },
    inventory: {
      deadStockItems: params.deadStockStats[0]?.count ?? 0,
      deadStockTotalValue: Number(params.deadStockStats[0]?.totalValue ?? 0),
      riskScore: params.riskDetail?.riskScore ?? 0,
      bucketCounts: params.riskDetail?.bucketCounts ?? null,
    },
    proposals: {
      sent: Number(ps?.sent ?? 0),
      received: Number(ps?.received ?? 0),
      completed: Number(ps?.completed ?? 0),
      pendingAction: Number(ps?.pendingAction ?? 0),
    },
    exchanges: {
      totalCount: es?.totalCount ?? 0,
      totalValue: Number(es?.totalValue ?? 0),
    },
    matching: {
      candidateCount: params.matchSnapshot[0]?.candidateCount ?? 0,
    },
    trust: {
      score: Number(ts?.trustScore ?? 60),
      ratingCount: ts?.ratingCount ?? 0,
      positiveRate: Number(ts?.positiveRate ?? 0),
      avgRatingReceived: fb?.avgRating ?? 0,
      feedbackCount: fb?.count ?? 0,
    },
    network: {
      favoriteCount: params.favoriteCount[0]?.count ?? 0,
      tradingPartnerCount: es?.partnerCount ?? 0,
    },
    alerts: {
      activeCount: params.activeAlertCount[0]?.count ?? 0,
    },
  };
}

router.use(requireLogin);

router.get('/summary', async (req: AuthRequest, res: Response) => {
  const pharmacyId = req.user!.id;
  const nowMs = Date.now();
  const cached = getCachedStatisticsSummary(pharmacyId, nowMs);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const [
      uploadStats,
      deadStockStats,
      riskDetail,
      proposalStats,
      exchangeStats,
      matchSnapshot,
      trustScore,
      feedbackReceived,
      favoriteCount,
      activeAlertCount,
    ] = await Promise.all([
      // アップロード回数 + 最終日（種別ごと）— 1クエリに統合
      db
        .select({
          uploadType: uploadJobs.uploadType,
          count: count(),
          lastDate: max(uploadJobs.createdAt),
        })
        .from(uploadJobs)
        .where(eq(uploadJobs.pharmacyId, pharmacyId))
        .groupBy(uploadJobs.uploadType),

      // デッドストック品目数 + 総薬価 — 1クエリに統合
      db
        .select({
          count: count(),
          totalValue: sum(deadStockItems.yakkaTotal),
        })
        .from(deadStockItems)
        .where(
          and(
            eq(deadStockItems.pharmacyId, pharmacyId),
            eq(deadStockItems.isAvailable, true),
          ),
        ),

      // リスク詳細（バケット含む）
      getPharmacyRiskDetail(pharmacyId).catch(() => null),

      // 提案統計 — 条件付き集計で1クエリに統合
      db
        .select({
          sent: sql<number>`SUM(CASE WHEN ${exchangeProposals.pharmacyAId} = ${pharmacyId} THEN 1 ELSE 0 END)`,
          received: sql<number>`SUM(CASE WHEN ${exchangeProposals.pharmacyBId} = ${pharmacyId} THEN 1 ELSE 0 END)`,
          completed: sql<number>`SUM(CASE WHEN (${exchangeProposals.pharmacyAId} = ${pharmacyId} OR ${exchangeProposals.pharmacyBId} = ${pharmacyId}) AND ${exchangeProposals.status} = 'completed' THEN 1 ELSE 0 END)`,
          pendingAction: sql<number>`SUM(CASE WHEN (
            (${exchangeProposals.status} = 'proposed' AND ${exchangeProposals.pharmacyBId} = ${pharmacyId})
            OR (${exchangeProposals.status} = 'accepted_a' AND ${exchangeProposals.pharmacyBId} = ${pharmacyId})
            OR (${exchangeProposals.status} = 'accepted_b' AND ${exchangeProposals.pharmacyAId} = ${pharmacyId})
          ) THEN 1 ELSE 0 END)`,
        })
        .from(exchangeProposals)
        .where(
          or(
            eq(exchangeProposals.pharmacyAId, pharmacyId),
            eq(exchangeProposals.pharmacyBId, pharmacyId),
          ),
        ),

      // 交換完了件数・累計薬価・ユニーク取引先数 — 1クエリに統合
      db
        .select({
          totalCount: count(),
          totalValue: sum(exchangeHistory.totalValue),
          partnerCount: countDistinct(
            sql`CASE WHEN ${exchangeHistory.pharmacyAId} = ${pharmacyId} THEN ${exchangeHistory.pharmacyBId} ELSE ${exchangeHistory.pharmacyAId} END`,
          ),
        })
        .from(exchangeHistory)
        .where(
          or(
            eq(exchangeHistory.pharmacyAId, pharmacyId),
            eq(exchangeHistory.pharmacyBId, pharmacyId),
          ),
        ),

      // マッチング候補数
      db
        .select({ candidateCount: matchCandidateSnapshots.candidateCount })
        .from(matchCandidateSnapshots)
        .where(eq(matchCandidateSnapshots.pharmacyId, pharmacyId)),

      // 信頼スコア
      db
        .select({
          trustScore: pharmacies.trustScore,
          ratingCount: pharmacies.ratingCount,
          positiveRate: pharmacies.positiveRate,
        })
        .from(pharmacies)
        .where(eq(pharmacies.id, pharmacyId)),

      // 受け取った評価の平均
      db
        .select({
          avgRating: sql<number>`ROUND(AVG(${exchangeFeedback.rating}), 1)`,
          count: count(),
        })
        .from(exchangeFeedback)
        .where(eq(exchangeFeedback.toPharmacyId, pharmacyId)),

      // お気に入り薬局数
      db
        .select({ count: count() })
        .from(pharmacyRelationships)
        .where(
          and(
            eq(pharmacyRelationships.pharmacyId, pharmacyId),
            eq(pharmacyRelationships.relationshipType, 'favorite'),
          ),
        ),

      // 未解決の予測アラート数
      db
        .select({ count: count() })
        .from(predictiveAlerts)
        .where(
          and(
            eq(predictiveAlerts.pharmacyId, pharmacyId),
            isNull(predictiveAlerts.resolvedAt),
          ),
        ),
    ]);

    const payload = buildStatisticsSummaryPayload({
      uploadStats,
      deadStockStats,
      riskDetail,
      proposalStats,
      exchangeStats,
      matchSnapshot,
      trustScore,
      feedbackReceived,
      favoriteCount,
      activeAlertCount,
    });
    setCachedStatisticsSummary(pharmacyId, payload, nowMs);
    res.json(payload);
  } catch (err) {
    logger.error('Statistics summary error:', { error: (err as Error).message });
    res.status(500).json({ error: '統計情報の取得に失敗しました' });
  }
});

export default router;
