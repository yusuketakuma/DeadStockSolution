import { and, count, eq, gte, lt, sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
  dailyStatistics,
  deadStockItems,
  exchangeProposals,
  matchCandidateSnapshots,
  pharmacies,
} from '../db/schema';
import { logger } from './logger';

export interface DailyMetrics {
  deadStockCount: number;
  usedMedCount: number;
  proposalsSent: number;
  proposalsReceived: number;
  proposalsCompleted: number;
  exchangeValue: number;
  matchCandidateCount: number;
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function aggregateDailyStatistics(
  targetDate?: string,
): Promise<{ processedCount: number }> {
  // デフォルトは昨日
  const resolvedDate = targetDate ?? (() => {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    return toDateString(yesterday);
  })();

  logger.info('daily-statistics: aggregation started', { date: resolvedDate });

  // アクティブな全薬局を取得
  const activePharmacies = await db
    .select({ id: pharmacies.id })
    .from(pharmacies)
    .where(and(
      eq(pharmacies.isActive, true),
      eq(pharmacies.isAdmin, false),
    ));

  if (activePharmacies.length === 0) {
    logger.info('daily-statistics: no active pharmacies found');
    return { processedCount: 0 };
  }

  // 対象日の範囲 (UTC)
  const dateStart = new Date(`${resolvedDate}T00:00:00.000Z`);
  const dateEnd = new Date(`${resolvedDate}T23:59:59.999Z`);
  const dateStartIso = dateStart.toISOString();
  const dateEndIso = dateEnd.toISOString();
  const nextDayIso = new Date(dateEnd.getTime() + 1).toISOString();

  let processedCount = 0;

  for (const pharmacy of activePharmacies) {
    const pharmacyId = pharmacy.id;

    try {
      // deadStockCount: isAvailable=true のアイテム数
      const [deadStockResult] = await db
        .select({ cnt: count() })
        .from(deadStockItems)
        .where(and(
          eq(deadStockItems.pharmacyId, pharmacyId),
          eq(deadStockItems.isAvailable, true),
        ));

      // proposalsSent: 対象日に pharmacyAId として送信した提案
      const [proposalsSentResult] = await db
        .select({ cnt: count() })
        .from(exchangeProposals)
        .where(and(
          eq(exchangeProposals.pharmacyAId, pharmacyId),
          gte(exchangeProposals.proposedAt, dateStartIso),
          lt(exchangeProposals.proposedAt, nextDayIso),
        ));

      // proposalsReceived: 対象日に pharmacyBId として受信した提案
      const [proposalsReceivedResult] = await db
        .select({ cnt: count() })
        .from(exchangeProposals)
        .where(and(
          eq(exchangeProposals.pharmacyBId, pharmacyId),
          gte(exchangeProposals.proposedAt, dateStartIso),
          lt(exchangeProposals.proposedAt, nextDayIso),
        ));

      // proposalsCompleted: 対象日に完了した提案 (sent or received)
      const [proposalsCompletedResult] = await db
        .select({ cnt: count() })
        .from(exchangeProposals)
        .where(and(
          sql`(${exchangeProposals.pharmacyAId} = ${pharmacyId} OR ${exchangeProposals.pharmacyBId} = ${pharmacyId})`,
          eq(exchangeProposals.status, 'completed'),
          gte(exchangeProposals.completedAt, dateStartIso),
          lt(exchangeProposals.completedAt, nextDayIso),
        ));

      // exchangeValue: 対象日に完了した提案の合計金額
      const [exchangeValueResult] = await db
        .select({ total: sql<string>`COALESCE(SUM(${exchangeProposals.completedTotalValue}), '0')` })
        .from(exchangeProposals)
        .where(and(
          sql`(${exchangeProposals.pharmacyAId} = ${pharmacyId} OR ${exchangeProposals.pharmacyBId} = ${pharmacyId})`,
          eq(exchangeProposals.status, 'completed'),
          gte(exchangeProposals.completedAt, dateStartIso),
          lt(exchangeProposals.completedAt, nextDayIso),
        ));

      // matchCandidateCount: 最新スナップショットの候補数
      const [matchCandidateResult] = await db
        .select({ candidateCount: matchCandidateSnapshots.candidateCount })
        .from(matchCandidateSnapshots)
        .where(eq(matchCandidateSnapshots.pharmacyId, pharmacyId));

      const metrics: DailyMetrics = {
        deadStockCount: Number(deadStockResult?.cnt ?? 0),
        usedMedCount: 0, // usedMedicationItems テーブルは未実装
        proposalsSent: Number(proposalsSentResult?.cnt ?? 0),
        proposalsReceived: Number(proposalsReceivedResult?.cnt ?? 0),
        proposalsCompleted: Number(proposalsCompletedResult?.cnt ?? 0),
        exchangeValue: parseFloat(exchangeValueResult?.total ?? '0'),
        matchCandidateCount: matchCandidateResult?.candidateCount ?? 0,
      };

      await db
        .insert(dailyStatistics)
        .values({
          date: resolvedDate,
          pharmacyId,
          metrics,
        })
        .onConflictDoUpdate({
          target: [dailyStatistics.date, dailyStatistics.pharmacyId],
          set: {
            metrics,
          },
        });

      processedCount++;
    } catch (err) {
      logger.error('daily-statistics: failed to aggregate for pharmacy', {
        pharmacyId,
        date: resolvedDate,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('daily-statistics: aggregation completed', {
    date: resolvedDate,
    processedCount,
    totalPharmacies: activePharmacies.length,
  });

  return { processedCount };
}
