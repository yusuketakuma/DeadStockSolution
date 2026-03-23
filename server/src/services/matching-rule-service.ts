import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '../config/database';
import { matchingRuleProfiles } from '../db/schema';
import { DEFAULT_MATCHING_SCORING_RULES } from './matching-score-service';
import { logger } from './logger';
import { createCache } from './cache-service';
import type { MatchingRuleProfile, MatchingRuleProfileUpdateInput, MatchingScoringRules } from '../types/matching';

const ACTIVE_PROFILE_CACHE_KEY = 'active_profile';
const DEFAULT_PROFILE_NAME = 'default';
const VERSION_CONFLICT_ERROR_MESSAGE = 'マッチングルールが更新済みです。再取得してから再実行してください';

interface PostgresErrorLike {
  code?: string;
}

interface RuleFieldSpec {
  min: number;
  max: number;
  integer?: boolean;
}

type MatchingRuleProfileRow = typeof matchingRuleProfiles.$inferSelect;
type MatchingRuleProfileInsertValues = typeof matchingRuleProfiles.$inferInsert;
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class MatchingRuleValidationError extends Error {}
export class MatchingRuleVersionConflictError extends Error {}

const activeProfileCache = createCache<MatchingRuleProfile>({
  ttlMs: 3_600_000,
  maxEntries: 10,
  name: 'matching_rule_active_profile',
});

const MATCHING_RULE_FIELD_SPECS: Record<keyof MatchingScoringRules, RuleFieldSpec> = {
  nameMatchThreshold: { min: 0, max: 1 },
  valueScoreMax: { min: 0, max: 200 },
  valueScoreDivisor: { min: 0.0001, max: 1_000_000 },
  balanceScoreMax: { min: 0, max: 200 },
  balanceScoreDiffFactor: { min: 0, max: 1_000 },
  distanceScoreMax: { min: 0, max: 200 },
  distanceScoreDivisor: { min: 0.0001, max: 1_000_000 },
  distanceScoreFallback: { min: 0, max: 200 },
  nearExpiryScoreMax: { min: 0, max: 200 },
  nearExpiryItemFactor: { min: 0, max: 100 },
  nearExpiryDays: { min: 1, max: 365, integer: true },
  diversityScoreMax: { min: 0, max: 200 },
  diversityItemFactor: { min: 0, max: 100 },
  favoriteBonus: { min: 0, max: 200 },
  groupBonus: { min: 0, max: 50, integer: true },
  nearExpiryDecayCurve: { min: 0, max: 10 },
  successRateBonus: { min: 0, max: 50, integer: true },
  maxCandidates: { min: 1, max: 200, integer: true },
} satisfies Record<keyof MatchingScoringRules, RuleFieldSpec>;

const MATCHING_RULE_FIELDS = Object.keys(MATCHING_RULE_FIELD_SPECS) as Array<keyof MatchingScoringRules>;

function isUndefinedTableError(err: unknown): err is PostgresErrorLike {
  return typeof err === 'object' && err !== null && (err as PostgresErrorLike).code === '42P01';
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function validateRange(
  name: string,
  value: unknown,
  min: number,
  max: number,
  integer: boolean = false,
): number {
  const numericValue = typeof value === 'number' ? value : Number.NaN;

  if (!Number.isFinite(numericValue)) {
    throw new MatchingRuleValidationError(`${name} は数値で指定してください`);
  }
  if (integer && !Number.isInteger(numericValue)) {
    throw new MatchingRuleValidationError(`${name} は整数で指定してください`);
  }
  if (numericValue < min || numericValue > max) {
    throw new MatchingRuleValidationError(`${name} は ${min} 以上 ${max} 以下で指定してください`);
  }
  return numericValue;
}

function buildFallbackProfile(): MatchingRuleProfile {
  return {
    id: 0,
    profileName: DEFAULT_PROFILE_NAME,
    isActive: true,
    version: 1,
    createdAt: null,
    updatedAt: null,
    source: 'default_fallback',
    ...DEFAULT_MATCHING_SCORING_RULES,
  };
}

function validateRuleField(
  field: keyof MatchingScoringRules,
  value: unknown,
  coerceNumber: boolean,
): number {
  const spec = MATCHING_RULE_FIELD_SPECS[field];
  const numericValue = coerceNumber ? (toFiniteNumber(value) ?? Number.NaN) : value;
  return validateRange(field, numericValue, spec.min, spec.max, spec.integer ?? false);
}

function buildDefaultProfileInsertValues(now: string): MatchingRuleProfileInsertValues {
  return {
    profileName: DEFAULT_PROFILE_NAME,
    isActive: true,
    ...DEFAULT_MATCHING_SCORING_RULES,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeRulesFromDbRow(
  row: MatchingRuleProfileRow,
): MatchingScoringRules | null {
  try {
    const normalized: MatchingScoringRules = { ...DEFAULT_MATCHING_SCORING_RULES };
    for (const field of MATCHING_RULE_FIELDS) {
      normalized[field] = validateRuleField(field, row[field], true);
    }
    return normalized;
  } catch (err) {
    logger.error('Matching rule profile row validation failed', {
      error: err instanceof Error ? err.message : String(err),
      profileId: row.id,
    });
    return null;
  }
}

function toProfile(
  row: MatchingRuleProfileRow,
  rules: MatchingScoringRules,
): MatchingRuleProfile {
  return {
    id: row.id,
    profileName: row.profileName,
    isActive: row.isActive,
    version: row.version,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
    source: 'database',
    ...rules,
  };
}

function storeCache(profile: MatchingRuleProfile): MatchingRuleProfile {
  activeProfileCache.set(ACTIVE_PROFILE_CACHE_KEY, profile);
  return profile;
}

function normalizeRulesForUpdate(input: Partial<MatchingScoringRules>): Partial<MatchingScoringRules> {
  const normalized: Partial<MatchingScoringRules> = {};

  for (const field of MATCHING_RULE_FIELDS) {
    const value = input[field];
    if (value === undefined) {
      continue;
    }
    normalized[field] = validateRuleField(field, value, false);
  }

  return normalized;
}

function hasAnyRuleField(input: MatchingRuleProfileUpdateInput): boolean {
  return MATCHING_RULE_FIELDS.some((field) => input[field] !== undefined);
}

async function selectActiveProfileRow(reader: Pick<DbTransaction, 'select'>): Promise<MatchingRuleProfileRow | null> {
  const [currentActive] = await reader.select()
    .from(matchingRuleProfiles)
    .where(and(
      eq(matchingRuleProfiles.isActive, true),
      isNull(matchingRuleProfiles.pharmacyId),
    ))
    .limit(1);

  return currentActive ?? null;
}

async function selectActiveProfileRowForPharmacy(
  reader: Pick<DbTransaction, 'select'>,
  pharmacyId: number,
): Promise<MatchingRuleProfileRow | null> {
  const [row] = await reader.select()
    .from(matchingRuleProfiles)
    .where(and(
      eq(matchingRuleProfiles.isActive, true),
      eq(matchingRuleProfiles.pharmacyId, pharmacyId),
    ))
    .limit(1);

  return row ?? null;
}

async function selectFirstProfileRow(reader: Pick<DbTransaction, 'select'>): Promise<MatchingRuleProfileRow | null> {
  const [firstRow] = await reader.select()
    .from(matchingRuleProfiles)
    .where(isNull(matchingRuleProfiles.pharmacyId))
    .orderBy(asc(matchingRuleProfiles.id))
    .limit(1);

  return firstRow ?? null;
}

async function insertDefaultProfileIfMissing(writer: Pick<DbTransaction, 'insert'>): Promise<void> {
  await writer.insert(matchingRuleProfiles)
    .values(buildDefaultProfileInsertValues(new Date().toISOString()))
    .onConflictDoNothing({ target: matchingRuleProfiles.profileName });
}

function validateExpectedVersion(expectedVersion: number | undefined): void {
  if (expectedVersion === undefined) {
    return;
  }

  validateRange('expectedVersion', expectedVersion, 1, 1_000_000, true);
}

function ensureExpectedVersionMatches(currentVersion: number, expectedVersion: number | undefined): void {
  if (expectedVersion === undefined) {
    return;
  }
  if (currentVersion !== expectedVersion) {
    throw new MatchingRuleVersionConflictError(VERSION_CONFLICT_ERROR_MESSAGE);
  }
}

function rethrowKnownUpdateErrors(err: unknown): never {
  if (err instanceof MatchingRuleValidationError || err instanceof MatchingRuleVersionConflictError) {
    throw err;
  }

  logger.error('Failed to update matching rule profile', {
    error: err instanceof Error ? err.message : String(err),
  });
  throw new Error('マッチングルールの更新に失敗しました');
}

async function ensureActiveProfileRow(): Promise<MatchingRuleProfileRow | null> {
  const currentActive = await selectActiveProfileRow(db);

  if (currentActive) {
    return currentActive;
  }

  await insertDefaultProfileIfMissing(db);

  const activeAfterInsert = await selectActiveProfileRow(db);
  if (activeAfterInsert) {
    return activeAfterInsert;
  }

  const firstRow = await selectFirstProfileRow(db);

  if (!firstRow) {
    return null;
  }

  const [updatedFirst] = await db.update(matchingRuleProfiles)
    .set({
      isActive: true,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(matchingRuleProfiles.id, firstRow.id))
    .returning();

  return updatedFirst ?? firstRow;
}

async function ensureActiveProfileRowInTransaction(tx: DbTransaction): Promise<MatchingRuleProfileRow | null> {
  const currentActive = await selectActiveProfileRow(tx);
  if (currentActive) {
    return currentActive;
  }

  await insertDefaultProfileIfMissing(tx);
  return selectActiveProfileRow(tx);
}

export async function getActiveMatchingRuleProfile(
  options?: { pharmacyId?: number; forceRefresh?: boolean } | boolean,
): Promise<MatchingRuleProfile> {
  // 後方互換: boolean を渡された場合は forceRefresh として扱う
  const normalizedOptions = typeof options === 'boolean'
    ? { forceRefresh: options }
    : (options ?? {});
  const { pharmacyId, forceRefresh = false } = normalizedOptions;

  // pharmacyId が指定された場合:
  // 1. 実験サービスをチェック
  // 2. 薬局別アクティブプロファイルをチェック
  // 3. グローバルプロファイルにフォールバック
  if (pharmacyId !== undefined) {
    const { getProfileForPharmacy } = await import('./matching-experiment-service');
    const experimentProfile = await getProfileForPharmacy(pharmacyId);
    if (experimentProfile) {
      return experimentProfile;
    }

    try {
      const pharmacyRow = await selectActiveProfileRowForPharmacy(db, pharmacyId);
      if (pharmacyRow) {
        const rules = normalizeRulesFromDbRow(pharmacyRow);
        if (rules) {
          return toProfile(pharmacyRow, rules);
        }
      }
    } catch (err) {
      logger.error('Failed to load pharmacy-specific matching rule profile', {
        pharmacyId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    // グローバルプロファイルへフォールバック（キャッシュ経由）
  }

  if (!forceRefresh) {
    const cached = activeProfileCache.get(ACTIVE_PROFILE_CACHE_KEY);
    if (cached) {
      return cached;
    }
  }

  try {
    const row = await ensureActiveProfileRow();
    if (!row) {
      logger.warn('No matching rule profile row found, using fallback defaults');
      return storeCache(buildFallbackProfile());
    }

    const rules = normalizeRulesFromDbRow(row);
    if (!rules) {
      return storeCache(buildFallbackProfile());
    }

    return storeCache(toProfile(row, rules));
  } catch (err) {
    if (!isUndefinedTableError(err)) {
      logger.error('Failed to load matching rule profile', {
        error: err instanceof Error ? err.message : String(err),
      });
    } else {
      logger.warn('matching_rule_profiles table is missing; using fallback defaults');
    }
    return storeCache(buildFallbackProfile());
  }
}

export async function updateActiveMatchingRuleProfile(input: MatchingRuleProfileUpdateInput): Promise<MatchingRuleProfile> {
  if (!hasAnyRuleField(input)) {
    throw new MatchingRuleValidationError('更新対象のスコア設定が指定されていません');
  }

  validateExpectedVersion(input.expectedVersion);

  const normalizedPatch = normalizeRulesForUpdate(input);

  try {
    const updated = await db.transaction(async (tx) => {
      const current = await ensureActiveProfileRowInTransaction(tx);

      if (!current) {
        throw new MatchingRuleValidationError('有効なマッチングルールプロファイルが存在しません');
      }

      ensureExpectedVersionMatches(current.version, input.expectedVersion);

      const [updatedRow] = await tx.update(matchingRuleProfiles)
        .set({
          ...normalizedPatch,
          version: current.version + 1,
          updatedAt: new Date().toISOString(),
        })
        .where(and(
          eq(matchingRuleProfiles.id, current.id),
          eq(matchingRuleProfiles.version, current.version),
        ))
        .returning();

      if (!updatedRow) {
        throw new MatchingRuleVersionConflictError(VERSION_CONFLICT_ERROR_MESSAGE);
      }

      return updatedRow;
    });

    const normalizedRules = normalizeRulesFromDbRow(updated);
    if (!normalizedRules) {
      throw new Error('更新後のマッチングルールが不正です');
    }

    activeProfileCache.invalidate(ACTIVE_PROFILE_CACHE_KEY);
    return storeCache(toProfile(updated, normalizedRules));
  } catch (err) {
    rethrowKnownUpdateErrors(err);
  }
}

export function resetMatchingRuleProfileCacheForTest(): void {
  activeProfileCache.invalidateAll();
}
