import { asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { exchangeFeedback, pharmacyTrustScores, pharmacies } from '../db/schema';
import { logger } from './logger';

export interface TrustScoreRow {
  pharmacyId: number;
  trustScore: number;
  ratingCount: number;
  positiveRate: number;
  updatedAt: string | null;
}

interface AggregateRow {
  toPharmacyId: number;
  avgRating: number;
  ratingCount: number;
  positiveCount: number;
}

const PRIOR_MEAN = 3;
const PRIOR_WEIGHT = 5;
let trustScoreRecalcJob: { startedAt: string; promise: Promise<void> } | null = null;

function to2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toTrustScore(avgRating: number, ratingCount: number): number {
  const shrinked = ((avgRating * ratingCount) + (PRIOR_MEAN * PRIOR_WEIGHT)) / (ratingCount + PRIOR_WEIGHT);
  return to2((shrinked / 5) * 100);
}

function toPositiveRate(positiveCount: number, ratingCount: number): number {
  if (ratingCount <= 0) return 0;
  return to2((positiveCount / ratingCount) * 100);
}

async function fetchAggregatesForTargets(targetIds?: number[]): Promise<AggregateRow[]> {
  const query = db.select({
    toPharmacyId: exchangeFeedback.toPharmacyId,
    avgRating: sql<number>`coalesce(avg(${exchangeFeedback.rating}), 0)`,
    ratingCount: sql<number>`count(*)`,
    positiveCount: sql<number>`sum(case when ${exchangeFeedback.rating} >= 4 then 1 else 0 end)`,
  })
    .from(exchangeFeedback)
    .groupBy(exchangeFeedback.toPharmacyId);

  if (!targetIds || targetIds.length === 0) {
    return query;
  }

  return query.where(inArray(exchangeFeedback.toPharmacyId, targetIds));
}

export async function recalculateTrustScores(targetPharmacyIds?: number[]): Promise<void> {
  const targetIds = targetPharmacyIds && targetPharmacyIds.length > 0
    ? [...new Set(targetPharmacyIds)]
    : null;

  const [activePharmacyRows, aggregateRows] = await Promise.all([
    targetIds
      ? db.select({ id: pharmacies.id })
        .from(pharmacies)
        .where(inArray(pharmacies.id, targetIds))
      : db.select({ id: pharmacies.id }).from(pharmacies),
    fetchAggregatesForTargets(targetIds ?? undefined),
  ]);

  const aggregateMap = new Map<number, AggregateRow>();
  for (const row of aggregateRows) {
    aggregateMap.set(row.toPharmacyId, row);
  }

  const now = new Date().toISOString();
  for (const pharmacy of activePharmacyRows) {
    const aggregate = aggregateMap.get(pharmacy.id);
    const ratingCount = Number(aggregate?.ratingCount ?? 0);
    const avgRating = Number(aggregate?.avgRating ?? 0);
    const positiveCount = Number(aggregate?.positiveCount ?? 0);

    const trustScore = ratingCount > 0 ? toTrustScore(avgRating, ratingCount) : 60;
    const positiveRate = ratingCount > 0 ? toPositiveRate(positiveCount, ratingCount) : 0;

    await db.insert(pharmacyTrustScores).values({
      pharmacyId: pharmacy.id,
      trustScore: String(trustScore),
      ratingCount,
      positiveRate: String(positiveRate),
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [pharmacyTrustScores.pharmacyId],
      set: {
        trustScore: String(trustScore),
        ratingCount,
        positiveRate: String(positiveRate),
        updatedAt: now,
      },
    });
  }
}

export async function recalculateTrustScoreForPharmacy(pharmacyId: number): Promise<void> {
  await recalculateTrustScores([pharmacyId]);
}

export function triggerTrustScoreRecalculation(): { started: boolean; startedAt: string } {
  if (trustScoreRecalcJob) {
    return { started: false, startedAt: trustScoreRecalcJob.startedAt };
  }

  const startedAt = new Date().toISOString();
  const jobPromise = recalculateTrustScores()
    .then(() => {
      logger.info('Trust score recalculation completed');
    })
    .catch((err) => {
      logger.error('Trust score recalculation failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    })
    .finally(() => {
      if (trustScoreRecalcJob?.promise === jobPromise) {
        trustScoreRecalcJob = null;
      }
    });

  trustScoreRecalcJob = {
    startedAt,
    promise: jobPromise,
  };

  return { started: true, startedAt };
}

export async function listTrustScores(page: number, limit: number): Promise<{ data: Array<{
  id: number;
  email: string;
  name: string;
  prefecture: string;
  phone: string;
  fax: string;
  isActive: boolean;
  isAdmin: boolean;
  isTestAccount: boolean;
  createdAt: string | null;
  trustScore: number;
  ratingCount: number;
  positiveRate: number;
}>; total: number }> {
  const offset = (page - 1) * limit;
  const trustScoreOrder = sql<number>`coalesce(${pharmacyTrustScores.trustScore}, 60)`;
  const ratingCountOrder = sql<number>`coalesce(${pharmacyTrustScores.ratingCount}, 0)`;

  const [rows, [totalRow]] = await Promise.all([
    db.select({
      id: pharmacies.id,
      email: pharmacies.email,
      name: pharmacies.name,
      prefecture: pharmacies.prefecture,
      phone: pharmacies.phone,
      fax: pharmacies.fax,
      isActive: pharmacies.isActive,
      isAdmin: pharmacies.isAdmin,
      isTestAccount: pharmacies.isTestAccount,
      createdAt: pharmacies.createdAt,
      trustScore: pharmacyTrustScores.trustScore,
      ratingCount: pharmacyTrustScores.ratingCount,
      positiveRate: pharmacyTrustScores.positiveRate,
    })
      .from(pharmacies)
      .leftJoin(pharmacyTrustScores, eq(pharmacyTrustScores.pharmacyId, pharmacies.id))
      .orderBy(desc(trustScoreOrder), desc(ratingCountOrder), asc(pharmacies.id))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(pharmacies),
  ]);

  return {
    data: rows.map((row) => ({
      ...row,
      isActive: Boolean(row.isActive),
      isAdmin: Boolean(row.isAdmin),
      isTestAccount: Boolean(row.isTestAccount),
      trustScore: Number(row.trustScore ?? 60),
      ratingCount: Number(row.ratingCount ?? 0),
      positiveRate: Number(row.positiveRate ?? 0),
    })),
    total: Number(totalRow?.count ?? 0),
  };
}
