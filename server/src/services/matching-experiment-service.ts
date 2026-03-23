import crypto from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { matchingExperiments, matchingExperimentAssignments, matchingRuleProfiles } from '../db/schema';
import { createCache } from './cache-service';
import { logger } from './logger';
import type { MatchingRuleProfile } from '../types/matching';
import { DEFAULT_MATCHING_SCORING_RULES } from './matching-score-service';

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

export type ExperimentStatus = 'draft' | 'running' | 'completed' | 'cancelled';
export type AssignedGroup = 'control' | 'treatment';

export interface MatchingExperiment {
  id: number;
  name: string;
  controlProfileId: number;
  treatmentProfileId: number;
  trafficPercentage: number;
  status: ExperimentStatus;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

export interface ExperimentCreateInput {
  name: string;
  controlProfileId: number;
  treatmentProfileId: number;
  trafficPercentage?: number;
}

export interface ExperimentResults {
  experimentId: number;
  totalAssignments: number;
  controlCount: number;
  treatmentCount: number;
}

// ---------------------------------------------------------------------------
// キャッシュ
// ---------------------------------------------------------------------------

const ACTIVE_EXPERIMENT_CACHE_KEY = 'active_experiment';
const ACTIVE_EXPERIMENT_CACHE_TTL_MS = 5 * 60 * 1000; // 5分
const MATCHING_EXPERIMENT_START_LOCK_KEY = 41001;

const activeExperimentCache = createCache<MatchingExperiment | null>({
  ttlMs: ACTIVE_EXPERIMENT_CACHE_TTL_MS,
  maxEntries: 1,
  name: 'matching_active_experiment',
});

export function resetExperimentCacheForTest(): void {
  activeExperimentCache.invalidateAll();
}

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

type MatchingRuleProfileRow = typeof matchingRuleProfiles.$inferSelect;

function rowToProfile(row: MatchingRuleProfileRow): MatchingRuleProfile {
  return {
    id: row.id,
    profileName: row.profileName,
    isActive: row.isActive,
    version: row.version,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
    source: 'database',
    nameMatchThreshold: typeof row.nameMatchThreshold === 'number' ? row.nameMatchThreshold : DEFAULT_MATCHING_SCORING_RULES.nameMatchThreshold,
    valueScoreMax: typeof row.valueScoreMax === 'number' ? row.valueScoreMax : DEFAULT_MATCHING_SCORING_RULES.valueScoreMax,
    valueScoreDivisor: typeof row.valueScoreDivisor === 'number' ? row.valueScoreDivisor : DEFAULT_MATCHING_SCORING_RULES.valueScoreDivisor,
    balanceScoreMax: typeof row.balanceScoreMax === 'number' ? row.balanceScoreMax : DEFAULT_MATCHING_SCORING_RULES.balanceScoreMax,
    balanceScoreDiffFactor: typeof row.balanceScoreDiffFactor === 'number' ? row.balanceScoreDiffFactor : DEFAULT_MATCHING_SCORING_RULES.balanceScoreDiffFactor,
    distanceScoreMax: typeof row.distanceScoreMax === 'number' ? row.distanceScoreMax : DEFAULT_MATCHING_SCORING_RULES.distanceScoreMax,
    distanceScoreDivisor: typeof row.distanceScoreDivisor === 'number' ? row.distanceScoreDivisor : DEFAULT_MATCHING_SCORING_RULES.distanceScoreDivisor,
    distanceScoreFallback: typeof row.distanceScoreFallback === 'number' ? row.distanceScoreFallback : DEFAULT_MATCHING_SCORING_RULES.distanceScoreFallback,
    nearExpiryScoreMax: typeof row.nearExpiryScoreMax === 'number' ? row.nearExpiryScoreMax : DEFAULT_MATCHING_SCORING_RULES.nearExpiryScoreMax,
    nearExpiryItemFactor: typeof row.nearExpiryItemFactor === 'number' ? row.nearExpiryItemFactor : DEFAULT_MATCHING_SCORING_RULES.nearExpiryItemFactor,
    nearExpiryDays: typeof row.nearExpiryDays === 'number' ? row.nearExpiryDays : DEFAULT_MATCHING_SCORING_RULES.nearExpiryDays,
    diversityScoreMax: typeof row.diversityScoreMax === 'number' ? row.diversityScoreMax : DEFAULT_MATCHING_SCORING_RULES.diversityScoreMax,
    diversityItemFactor: typeof row.diversityItemFactor === 'number' ? row.diversityItemFactor : DEFAULT_MATCHING_SCORING_RULES.diversityItemFactor,
    favoriteBonus: typeof row.favoriteBonus === 'number' ? row.favoriteBonus : DEFAULT_MATCHING_SCORING_RULES.favoriteBonus,
    groupBonus: typeof row.groupBonus === 'number' ? row.groupBonus : DEFAULT_MATCHING_SCORING_RULES.groupBonus,
    nearExpiryDecayCurve: typeof row.nearExpiryDecayCurve === 'number' ? row.nearExpiryDecayCurve : DEFAULT_MATCHING_SCORING_RULES.nearExpiryDecayCurve,
    successRateBonus: typeof row.successRateBonus === 'number' ? row.successRateBonus : DEFAULT_MATCHING_SCORING_RULES.successRateBonus,
    maxCandidates: typeof row.maxCandidates === 'number' ? row.maxCandidates : DEFAULT_MATCHING_SCORING_RULES.maxCandidates,
  };
}

/**
 * hash-based deterministic assignment
 * experimentId + pharmacyId の MD5 ハッシュ先頭4文字を int に変換し、
 * trafficPercentage と比較して treatment/control を決定する。
 */
function computeAssignedGroup(experimentId: number, pharmacyId: number, trafficPercentage: number): AssignedGroup {
  const hash = crypto.createHash('md5').update(`${experimentId}:${pharmacyId}`).digest('hex');
  const bucket = parseInt(hash.slice(0, 4), 16) % 100;
  return bucket < trafficPercentage ? 'treatment' : 'control';
}

// ---------------------------------------------------------------------------
// 公開関数
// ---------------------------------------------------------------------------

/**
 * running 状態のアクティブな実験を取得する（5分 TTL キャッシュ付き）。
 * 実験がない場合は null を返す。
 */
export async function getActiveExperiment(): Promise<MatchingExperiment | null> {
  const cached = activeExperimentCache.get(ACTIVE_EXPERIMENT_CACHE_KEY);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const [row] = await db.select()
      .from(matchingExperiments)
      .where(eq(matchingExperiments.status, 'running'))
      .limit(1);

    const result = row
      ? {
          id: row.id,
          name: row.name,
          controlProfileId: row.controlProfileId,
          treatmentProfileId: row.treatmentProfileId,
          trafficPercentage: row.trafficPercentage,
          status: row.status as ExperimentStatus,
          startedAt: row.startedAt?.toISOString() ?? null,
          endedAt: row.endedAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
        }
      : null;

    activeExperimentCache.set(ACTIVE_EXPERIMENT_CACHE_KEY, result);
    return result;
  } catch (err) {
    logger.error('Failed to fetch active matching experiment', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * 薬局 ID に対して割り当てられたマッチングプロファイルを返す。
 * アクティブな実験がない場合は null を返す。
 * アサインメントが存在しない場合は新規作成する。
 */
export async function getProfileForPharmacy(pharmacyId: number): Promise<MatchingRuleProfile | null> {
  const experiment = await getActiveExperiment();
  if (!experiment) {
    return null;
  }

  const assignedGroup = computeAssignedGroup(experiment.id, pharmacyId, experiment.trafficPercentage);

  // pharmacyId に対応する既存のアサインメントを検索
  const assignments = await db.select()
    .from(matchingExperimentAssignments)
    .where(and(
      eq(matchingExperimentAssignments.experimentId, experiment.id),
      eq(matchingExperimentAssignments.pharmacyId, pharmacyId),
    ))
    .limit(1);

  let group: AssignedGroup;

  if (assignments.length > 0) {
    group = assignments[0].assignedGroup as AssignedGroup;
  } else {
    // 新規アサインメントを作成
    group = assignedGroup;
    try {
      await db.insert(matchingExperimentAssignments)
        .values({
          experimentId: experiment.id,
          pharmacyId,
          assignedGroup: group,
        })
        .onConflictDoNothing();
    } catch (err) {
      logger.warn('Failed to persist experiment assignment', {
        experimentId: experiment.id,
        pharmacyId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const profileId = group === 'treatment' ? experiment.treatmentProfileId : experiment.controlProfileId;

  try {
    const [profileRow] = await db.select()
      .from(matchingRuleProfiles)
      .where(eq(matchingRuleProfiles.id, profileId))
      .limit(1);

    if (!profileRow) {
      logger.warn('Experiment profile not found, falling back to default', { profileId });
      return null;
    }

    return rowToProfile(profileRow);
  } catch (err) {
    logger.error('Failed to fetch experiment profile', {
      profileId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * 新しい実験を作成する。
 */
export async function createExperiment(input: ExperimentCreateInput): Promise<MatchingExperiment> {
  const trafficPercentage = input.trafficPercentage ?? 50;

  if (trafficPercentage < 0 || trafficPercentage > 100) {
    throw new Error('trafficPercentage は 0 以上 100 以下で指定してください');
  }

  const [row] = await db.insert(matchingExperiments)
    .values({
      name: input.name,
      controlProfileId: input.controlProfileId,
      treatmentProfileId: input.treatmentProfileId,
      trafficPercentage,
      status: 'draft',
    })
    .returning();

  if (!row) {
    throw new Error('実験の作成に失敗しました');
  }

  return {
    id: row.id,
    name: row.name,
    controlProfileId: row.controlProfileId,
    treatmentProfileId: row.treatmentProfileId,
    trafficPercentage: row.trafficPercentage,
    status: row.status as ExperimentStatus,
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * 実験を開始する（status: draft → running）。
 * 既に running の実験がある場合はエラーを投げる。
 */
export async function startExperiment(experimentId: number): Promise<MatchingExperiment> {
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${MATCHING_EXPERIMENT_START_LOCK_KEY})`);

    const [current] = await tx.select()
      .from(matchingExperiments)
      .where(eq(matchingExperiments.id, experimentId))
      .limit(1);

    if (!current) {
      throw new Error('実験が見つかりません');
    }

    if (current.status !== 'draft') {
      throw new Error('実験を開始できない状態です');
    }

    // 既に running の実験があれば拒否
    const [running] = await tx.select()
      .from(matchingExperiments)
      .where(eq(matchingExperiments.status, 'running'))
      .limit(1);

    if (running && running.id !== experimentId) {
      throw new Error('既に実行中の実験があります。先に停止してください');
    }

    const [updated] = await tx.update(matchingExperiments)
      .set({
        status: 'running',
        startedAt: new Date(),
      })
      .where(and(
        eq(matchingExperiments.id, experimentId),
        eq(matchingExperiments.status, 'draft'),
      ))
      .returning();

    if (!updated) {
      throw new Error('実験を開始できない状態です');
    }

    return updated;
  });

  activeExperimentCache.invalidate(ACTIVE_EXPERIMENT_CACHE_KEY);

  return {
    id: result.id,
    name: result.name,
    controlProfileId: result.controlProfileId,
    treatmentProfileId: result.treatmentProfileId,
    trafficPercentage: result.trafficPercentage,
    status: result.status as ExperimentStatus,
    startedAt: result.startedAt?.toISOString() ?? null,
    endedAt: result.endedAt?.toISOString() ?? null,
    createdAt: result.createdAt.toISOString(),
  };
}

/**
 * 実験を停止する（status: running → completed）。
 */
export async function stopExperiment(experimentId: number): Promise<MatchingExperiment> {
  const [current] = await db.select()
    .from(matchingExperiments)
    .where(eq(matchingExperiments.id, experimentId))
    .limit(1);

  if (!current) {
    throw new Error('実験が見つかりません');
  }

  if (current.status !== 'running') {
    throw new Error('実験を停止できない状態です');
  }

  const [updated] = await db.update(matchingExperiments)
    .set({
      status: 'completed',
      endedAt: new Date(),
    })
    .where(and(
      eq(matchingExperiments.id, experimentId),
      eq(matchingExperiments.status, 'running'),
    ))
    .returning();

  if (!updated) {
    throw new Error('実験を停止できない状態です');
  }

  activeExperimentCache.invalidate(ACTIVE_EXPERIMENT_CACHE_KEY);

  return {
    id: updated.id,
    name: updated.name,
    controlProfileId: updated.controlProfileId,
    treatmentProfileId: updated.treatmentProfileId,
    trafficPercentage: updated.trafficPercentage,
    status: updated.status as ExperimentStatus,
    startedAt: updated.startedAt?.toISOString() ?? null,
    endedAt: updated.endedAt?.toISOString() ?? null,
    createdAt: updated.createdAt.toISOString(),
  };
}

/**
 * 実験の全一覧を取得する。
 */
export async function listExperiments(): Promise<MatchingExperiment[]> {
  const rows = await db.select().from(matchingExperiments);
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    controlProfileId: row.controlProfileId,
    treatmentProfileId: row.treatmentProfileId,
    trafficPercentage: row.trafficPercentage,
    status: row.status as ExperimentStatus,
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

/**
 * 実験のアサインメント集計結果を取得する。
 */
export async function getExperimentResults(experimentId: number): Promise<ExperimentResults> {
  const rows = await db
    .select({
      assignedGroup: matchingExperimentAssignments.assignedGroup,
      count: sql<number>`count(*)::int`,
    })
    .from(matchingExperimentAssignments)
    .where(eq(matchingExperimentAssignments.experimentId, experimentId))
    .groupBy(matchingExperimentAssignments.assignedGroup);

  let controlCount = 0;
  let treatmentCount = 0;
  for (const row of rows) {
    if (row.assignedGroup === 'control') controlCount = row.count;
    else if (row.assignedGroup === 'treatment') treatmentCount = row.count;
  }

  return {
    experimentId,
    totalAssignments: controlCount + treatmentCount,
    controlCount,
    treatmentCount,
  };
}
