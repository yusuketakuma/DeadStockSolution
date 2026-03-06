import { and, asc, eq } from 'drizzle-orm';
import { db } from '../config/database';
import { matchingRuleProfiles } from '../db/schema';
import { DEFAULT_MATCHING_SCORING_RULES, MatchingScoringRules } from './matching-score-service';
import { logger } from './logger';

const ACTIVE_PROFILE_CACHE_TTL_MS = 60_000;
const DEFAULT_PROFILE_NAME = 'default';

interface PostgresErrorLike {
  code?: string;
}

interface RuleFieldSpec {
  min: number;
  max: number;
  integer?: boolean;
}

export class MatchingRuleValidationError extends Error {}
export class MatchingRuleVersionConflictError extends Error {}

export interface MatchingRuleProfile extends MatchingScoringRules {
  id: number;
  profileName: string;
  isActive: boolean;
  version: number;
  createdAt: string | null;
  updatedAt: string | null;
  source: 'database' | 'default_fallback';
}

export interface MatchingRuleProfileUpdateInput extends Partial<MatchingScoringRules> {
  expectedVersion?: number;
}

let cachedProfile: MatchingRuleProfile | null = null;
let cacheExpiresAt = 0;

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
  value: number,
  min: number,
  max: number,
  integer: boolean = false,
): number {
  if (!Number.isFinite(value)) {
    throw new MatchingRuleValidationError(`${name} は数値で指定してください`);
  }
  if (integer && !Number.isInteger(value)) {
    throw new MatchingRuleValidationError(`${name} は整数で指定してください`);
  }
  if (value < min || value > max) {
    throw new MatchingRuleValidationError(`${name} は ${min} 以上 ${max} 以下で指定してください`);
  }
  return value;
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
  return validateRange(field, numericValue as number, spec.min, spec.max, spec.integer ?? false);
}

function buildDefaultProfileInsertValues(now: string): typeof matchingRuleProfiles.$inferInsert {
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
  row: typeof matchingRuleProfiles.$inferSelect,
): MatchingScoringRules | null {
  try {
    const normalized = {} as MatchingScoringRules;
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
  row: typeof matchingRuleProfiles.$inferSelect,
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
  cachedProfile = profile;
  cacheExpiresAt = Date.now() + ACTIVE_PROFILE_CACHE_TTL_MS;
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

async function ensureActiveProfileRow(): Promise<typeof matchingRuleProfiles.$inferSelect | null> {
  const [currentActive] = await db.select()
    .from(matchingRuleProfiles)
    .where(eq(matchingRuleProfiles.isActive, true))
    .limit(1);

  if (currentActive) {
    return currentActive;
  }

  await db.insert(matchingRuleProfiles)
    .values(buildDefaultProfileInsertValues(new Date().toISOString()))
    .onConflictDoNothing({ target: matchingRuleProfiles.profileName });

  const [activeAfterInsert] = await db.select()
    .from(matchingRuleProfiles)
    .where(eq(matchingRuleProfiles.isActive, true))
    .limit(1);
  if (activeAfterInsert) {
    return activeAfterInsert;
  }

  const [firstRow] = await db.select()
    .from(matchingRuleProfiles)
    .orderBy(asc(matchingRuleProfiles.id))
    .limit(1);

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

export async function getActiveMatchingRuleProfile(forceRefresh: boolean = false): Promise<MatchingRuleProfile> {
  if (!forceRefresh && cachedProfile && cacheExpiresAt > Date.now()) {
    return cachedProfile;
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

  if (input.expectedVersion !== undefined) {
    validateRange('expectedVersion', input.expectedVersion, 1, 1_000_000, true);
  }

  const normalizedPatch = normalizeRulesForUpdate(input);

  try {
    const updated = await db.transaction(async (tx) => {
      const [currentActive] = await tx.select()
        .from(matchingRuleProfiles)
        .where(eq(matchingRuleProfiles.isActive, true))
        .limit(1);

      let current = currentActive;
      if (!current) {
        const now = new Date().toISOString();
        await tx.insert(matchingRuleProfiles)
          .values(buildDefaultProfileInsertValues(now))
          .onConflictDoNothing({ target: matchingRuleProfiles.profileName });

        const [activeAfterInsert] = await tx.select()
          .from(matchingRuleProfiles)
          .where(eq(matchingRuleProfiles.isActive, true))
          .limit(1);
        current = activeAfterInsert;
      }

      if (!current) {
        throw new MatchingRuleValidationError('有効なマッチングルールプロファイルが存在しません');
      }

      if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
        throw new MatchingRuleVersionConflictError('マッチングルールが更新済みです。再取得してから再実行してください');
      }

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
        throw new MatchingRuleVersionConflictError('マッチングルールが更新済みです。再取得してから再実行してください');
      }

      return updatedRow;
    });

    const normalizedRules = normalizeRulesFromDbRow(updated);
    if (!normalizedRules) {
      throw new Error('更新後のマッチングルールが不正です');
    }

    return storeCache(toProfile(updated, normalizedRules));
  } catch (err) {
    if (err instanceof MatchingRuleValidationError || err instanceof MatchingRuleVersionConflictError) {
      throw err;
    }

    logger.error('Failed to update matching rule profile', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw new Error('マッチングルールの更新に失敗しました');
  }
}

export function resetMatchingRuleProfileCacheForTest(): void {
  cachedProfile = null;
  cacheExpiresAt = 0;
}
