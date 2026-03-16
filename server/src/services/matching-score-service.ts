import { distance as levenshtein } from 'fastest-levenshtein';
import { normalizeString } from '../utils/string-utils';
import { MatchItem } from '../types';
import type {
  DrugMatchResult,
  MatchingScoringRules,
  PreparedDrugName,
  UsedMedIndex,
  UsedMedName,
  UsedMedRow,
} from '../types/matching';


const MAX_DRUG_MATCH_CACHE_SIZE = 2000;
const MAX_PARSED_EXPIRY_CACHE_SIZE = 5000;
const TOKEN_INDEX_MIN_LENGTH = 2;
const NAME_MATCH_EARLY_EXIT_SCORE = 0.98;
const TOKEN_CANDIDATE_LIMIT = 500;
const SPARSE_CANDIDATE_THRESHOLD = 25;
const NEAR_LENGTH_CANDIDATE_LIMIT = 200;
const NEAR_LENGTH_WINDOW = 2;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MIN_SCORE_DIVISOR = 0.0001;
const SUCCESS_RATE_LOG_CAP = 20;

export const DEFAULT_MATCHING_SCORING_RULES: MatchingScoringRules = {
  nameMatchThreshold: 0.7,
  valueScoreMax: 55,
  valueScoreDivisor: 2500,
  balanceScoreMax: 20,
  balanceScoreDiffFactor: 1.5,
  distanceScoreMax: 15,
  distanceScoreDivisor: 8,
  distanceScoreFallback: 2,
  nearExpiryScoreMax: 10,
  nearExpiryItemFactor: 1.5,
  nearExpiryDays: 120,
  diversityScoreMax: 10,
  diversityItemFactor: 1.5,
  favoriteBonus: 15,
  groupBonus: 10,
  nearExpiryDecayCurve: 0,
  successRateBonus: 0,
  maxCandidates: 30,
};

interface CandidateScoreContext {
  valueScore: number;
  balanceScore: number;
  distanceScore: number;
  nearExpiryDays: number;
  effectiveReferenceDate: Date;
  isGroupMember: boolean;
}

export function setLimitedCacheEntry<T>(cache: Map<string, T>, key: string, value: T, maxSize: number): void {
  if (!cache.has(key) && cache.size >= maxSize) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey === 'string') {
      cache.delete(oldestKey);
    }
  }
  cache.set(key, value);
}

export function roundTo2(value: number): number {
  return Math.round(value * 100) / 100;
}

function hasContainmentRelationship(left: string, right: string): boolean {
  return left.includes(right) || right.includes(left);
}

function normalizeDrugName(name: string): string {
  return normalizeString(name)
    .replace(/[0-9]+(?:\.[0-9]+)?(?:mg|ml|μg|mcg|g|％|%)/gi, '')
    .replace(/(錠|カプセル|散|シロップ|注射|外用|内服|点眼|軟膏)$/g, '')
    .trim();
}

export function prepareDrugName(name: string): PreparedDrugName {
  const normalizedDrugName = normalizeDrugName(name);
  const tokenSet = normalizedDrugName ? createTokenSet(normalizedDrugName) : new Set<string>();
  return { normalizedDrugName, tokenSet };
}

function createTokenSet(normalizedName: string): Set<string> {
  const baseTokens = normalizedName
    .replace(/[^a-z0-9ぁ-んァ-ヶ一-龠]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0);

  const tokenSet = new Set<string>(baseTokens);
  const forNgram = baseTokens.length <= 1 ? (baseTokens[0] ?? normalizedName) : '';

  if (forNgram.length >= 3) {
    for (let i = 0; i < forNgram.length - 1; i++) {
      tokenSet.add(forNgram.slice(i, i + 2));
    }
  }

  if (tokenSet.size === 0 && normalizedName) {
    tokenSet.add(normalizedName);
  }

  return tokenSet;
}

function appendIndexedValue<K>(map: Map<K, number[]>, key: K, value: number): void {
  const existing = map.get(key);
  if (existing) {
    existing.push(value);
    return;
  }

  map.set(key, [value]);
}

function addCandidates(candidateIds: Set<number>, candidates: Iterable<number>, limit: number): boolean {
  for (const candidateId of candidates) {
    candidateIds.add(candidateId);
    if (candidateIds.size >= limit) {
      return true;
    }
  }

  return false;
}

function jaccardScore(tokensA: Set<string>, tokensB: Set<string>): number {
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  const [smaller, larger] = tokensA.size <= tokensB.size
    ? [tokensA, tokensB]
    : [tokensB, tokensA];

  let intersection = 0;
  for (const token of smaller) {
    if (larger.has(token)) intersection += 1;
  }
  const union = tokensA.size + tokensB.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

function computeNameSimilarity(
  normalizedA: string,
  tokensA: Set<string>,
  nameB: UsedMedName
): number {
  const normalizedB = nameB.normalizedName;

  if (!normalizedA || !normalizedB) return 0;
  if (normalizedA === normalizedB) return 1;
  if (hasContainmentRelationship(normalizedA, normalizedB)) return 0.9;

  const tokenScore = jaccardScore(tokensA, nameB.tokenSet);
  const maxLen = Math.max(normalizedA.length, normalizedB.length);
  if (maxLen === 0) return tokenScore;

  // Token overlap and string length can reject unlikely pairs before Levenshtein.
  if (tokenScore < 0.12 && Math.abs(normalizedA.length - nameB.length) > maxLen * 0.6) {
    return tokenScore;
  }

  const levScore = maxLen === 0 ? 0 : 1 - (levenshtein(normalizedA, normalizedB) / maxLen);

  return Math.max(levScore, tokenScore);
}

export function buildUsedMedIndex(rows: UsedMedRow[]): UsedMedIndex {
  const names: UsedMedName[] = [];
  const exactNames = new Set<string>();
  const tokenIndex = new Map<string, number[]>();
  const lengthBuckets = new Map<number, number[]>();

  for (const row of rows) {
    const normalizedName = normalizeDrugName(row.drugName);
    if (!normalizedName || exactNames.has(normalizedName)) continue;
    exactNames.add(normalizedName);
    const tokenSet = createTokenSet(normalizedName);
    const index = names.length;
    names.push({
      normalizedName,
      tokenSet,
      length: normalizedName.length,
    });

    appendIndexedValue(lengthBuckets, normalizedName.length, index);

    for (const token of tokenSet) {
      if (token.length < TOKEN_INDEX_MIN_LENGTH) continue;
      appendIndexedValue(tokenIndex, token, index);
    }
  }

  return { exactNames, names, tokenIndex, lengthBuckets };
}

function collectCandidateIndices(
  normalizedDrugName: string,
  tokenSet: Set<string>,
  index: UsedMedIndex
): number[] | null {
  const candidateIds = new Set<number>();

  for (const token of tokenSet) {
    const matched = index.tokenIndex.get(token);
    if (!matched) continue;
    if (addCandidates(candidateIds, matched, TOKEN_CANDIDATE_LIMIT)) break;
  }

  // Ensure near-length alternatives are included when token hit is sparse.
  if (candidateIds.size > 0 && candidateIds.size < SPARSE_CANDIDATE_THRESHOLD) {
    const targetLength = normalizedDrugName.length;
    for (let length = Math.max(0, targetLength - NEAR_LENGTH_WINDOW); length <= targetLength + NEAR_LENGTH_WINDOW; length += 1) {
      const nearLengthCandidates = index.lengthBuckets.get(length);
      if (!nearLengthCandidates) continue;
      if (addCandidates(candidateIds, nearLengthCandidates, NEAR_LENGTH_CANDIDATE_LIMIT)) break;
    }
  }

  if (candidateIds.size === 0 || candidateIds.size >= index.names.length * 0.9) {
    return null;
  }

  return [...candidateIds];
}

function findBestNameScore(
  normalizedDrugName: string,
  tokenSet: Set<string>,
  names: Iterable<UsedMedName | undefined>,
): number {
  let bestScore = 0;

  for (const name of names) {
    if (!name) continue;

    const score = computeNameSimilarity(normalizedDrugName, tokenSet, name);
    if (score <= bestScore) continue;

    bestScore = score;
    if (bestScore >= NAME_MATCH_EARLY_EXIT_SCORE) {
      break;
    }
  }

  return bestScore;
}

export function findBestDrugMatch(
  drugName: string | PreparedDrugName,
  index: UsedMedIndex,
  cache: Map<string, DrugMatchResult>
): DrugMatchResult {
  const preparedDrugName = typeof drugName === 'string' ? prepareDrugName(drugName) : drugName;
  const { normalizedDrugName, tokenSet } = preparedDrugName;
  if (!normalizedDrugName) return { score: 0 };

  const cached = cache.get(normalizedDrugName);
  if (cached) return cached;

  if (index.exactNames.has(normalizedDrugName)) {
    const result = { score: 1 };
    setLimitedCacheEntry(cache, normalizedDrugName, result, MAX_DRUG_MATCH_CACHE_SIZE);
    return result;
  }

  const candidateIndices = collectCandidateIndices(normalizedDrugName, tokenSet, index);
  const namesToSearch = candidateIndices
    ? candidateIndices.map((candidateIndex) => index.names[candidateIndex])
    : index.names;

  const result = { score: findBestNameScore(normalizedDrugName, tokenSet, namesToSearch) };
  setLimitedCacheEntry(cache, normalizedDrugName, result, MAX_DRUG_MATCH_CACHE_SIZE);
  return result;
}

const EQUIVALENCE_MATCH_SCORE = 0.95;
const EQUIVALENCE_CANDIDATE_FLOOR_SCORE = 0.3;

function resolveEquivalenceBoostScore(
  normalizedDrugName: string,
  index: UsedMedIndex,
  cache: Map<string, DrugMatchResult>,
  equivalenceMap: Map<string, string[]>,
  initialScore: number,
): number {
  let bestScore = initialScore;

  for (const [registeredName, equivalents] of equivalenceMap) {
    if (!hasContainmentRelationship(normalizedDrugName, registeredName)) {
      continue;
    }

    for (const equivName of equivalents) {
      const equivPrepared = prepareDrugName(equivName);
      const equivResult = findBestDrugMatch(equivPrepared, index, cache);
      if (equivResult.score <= EQUIVALENCE_CANDIDATE_FLOOR_SCORE) {
        continue;
      }

      const boostedScore = Math.max(equivResult.score, EQUIVALENCE_MATCH_SCORE);
      bestScore = Math.max(bestScore, boostedScore);
    }
  }

  return bestScore;
}

/**
 * 同等性マップを考慮した薬品名マッチング。
 * equivalenceMap: 薬品名 → 同等薬品名のリスト (bidirectional)
 * 通常の文字列類似度に加え、同等性登録済みペアには高スコアを付与。
 */
export function findBestDrugMatchWithEquivalences(
  drugName: string | PreparedDrugName,
  index: UsedMedIndex,
  cache: Map<string, DrugMatchResult>,
  equivalenceMap: Map<string, string[]>,
): DrugMatchResult {
  // Start with normal matching
  const baseResult = findBestDrugMatch(drugName, index, cache);

  // If already perfect match or no equivalence data, return base
  if (baseResult.score >= EQUIVALENCE_MATCH_SCORE || equivalenceMap.size === 0) {
    return baseResult;
  }

  const preparedDrugName = typeof drugName === 'string' ? prepareDrugName(drugName) : drugName;
  const { normalizedDrugName } = preparedDrugName;
  if (!normalizedDrugName) return baseResult;

  const bestScore = resolveEquivalenceBoostScore(
    normalizedDrugName,
    index,
    cache,
    equivalenceMap,
    baseResult.score,
  );

  if (bestScore > baseResult.score) {
    const result = { score: bestScore };
    setLimitedCacheEntry(cache, normalizedDrugName, result, MAX_DRUG_MATCH_CACHE_SIZE);
    return result;
  }

  return baseResult;
}

const parsedExpiryCache = new Map<string, Date | null>();

export function toStartOfDay(date: Date): Date {
  const normalized = new Date(date.getTime());
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

export function parseExpiryDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const raw = value.trim();
  if (!raw) return null;
  if (parsedExpiryCache.has(raw)) {
    return parsedExpiryCache.get(raw) ?? null;
  }

  const normalized = raw
    .replace(/[年月.\-]/g, '/')
    .replace(/日/g, '')
    .replace(/\s+/g, '');

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    setLimitedCacheEntry(parsedExpiryCache, raw, null, MAX_PARSED_EXPIRY_CACHE_SIZE);
    return null;
  }

  setLimitedCacheEntry(parsedExpiryCache, raw, parsed, MAX_PARSED_EXPIRY_CACHE_SIZE);
  return parsed;
}

export function isExpiredDate(value: string | null | undefined, referenceDate: Date = new Date()): boolean {
  const expiry = parseExpiryDate(value);
  if (!expiry) return false;
  const today = toStartOfDay(referenceDate);
  const expiryDay = toStartOfDay(expiry);
  return expiryDay.getTime() < today.getTime();
}

function getItemExpiryDate(item: MatchItem): Date | null {
  return parseExpiryDate(item.expirationDateIso ?? item.expirationDate);
}

export function getNearExpiryCount(
  items: MatchItem[],
  nearExpiryDays: number = DEFAULT_MATCHING_SCORING_RULES.nearExpiryDays,
  referenceDate: Date = new Date(),
): number {
  const today = toStartOfDay(referenceDate);
  const thresholdDays = Math.max(1, Math.floor(nearExpiryDays));

  let count = 0;
  for (const item of items) {
    const expiry = getItemExpiryDate(item);
    if (!expiry) continue;
    const expiryDay = toStartOfDay(expiry);
    const diffDays = Math.floor((expiryDay.getTime() - today.getTime()) / MS_PER_DAY);
    if (diffDays >= 0 && diffDays <= thresholdDays) count += 1;
  }
  return count;
}

/**
 * 指数減衰による期限スコア計算。
 * curve=0: 線形（従来互換: count * itemFactor）
 * curve>0: exp(curve * (1 - daysRemaining/nearExpiryDays)) の合計 * itemFactor
 * 期限が近いほどスコアが急激に上昇する。
 * daysRemaining=0 → weight=exp(curve), daysRemaining=nearExpiryDays → weight=1
 */
export function calculateExponentialNearExpiryScore(
  items: MatchItem[],
  nearExpiryDays: number,
  nearExpiryDecayCurve: number,
  nearExpiryItemFactor: number,
  nearExpiryScoreMax: number,
  referenceDate: Date,
): number {
  if (nearExpiryDecayCurve <= 0) {
    // Linear mode (backward compatible)
    return calculateCappedItemScore(
      getNearExpiryCount(items, nearExpiryDays, referenceDate),
      nearExpiryItemFactor,
      nearExpiryScoreMax,
    );
  }

  const today = toStartOfDay(referenceDate);
  const thresholdDays = Math.max(1, Math.floor(nearExpiryDays));
  let totalWeight = 0;

  for (const item of items) {
    const expiry = getItemExpiryDate(item);
    if (!expiry) continue;
    const expiryDay = toStartOfDay(expiry);
    const diffDays = Math.floor((expiryDay.getTime() - today.getTime()) / MS_PER_DAY);
    if (diffDays < 0 || diffDays > thresholdDays) continue;

    // Exponential boost: closer to expiry → higher weight
    // At daysRemaining=0: weight = exp(curve) (max boost)
    // At daysRemaining=thresholdDays: weight = exp(0) = 1 (same as linear)
    const ratio = diffDays / thresholdDays;
    const weight = Math.exp(nearExpiryDecayCurve * (1 - ratio));
    totalWeight += weight;
  }

  return calculateCappedItemScore(totalWeight, nearExpiryItemFactor, nearExpiryScoreMax);
}

/**
 * 過去の交換成功回数に基づくボーナス。
 * 対数スケール: log2(successCount + 1) / log2(cap) * maxBonus
 * successCount=0 → 0, successCount増加→減速的に上昇、capで飽和
 */
export function calculateSuccessRateBonus(
  successCount: number,
  successRateBonusMax: number,
): number {
  if (successRateBonusMax <= 0) return 0;
  const safeCount = Math.max(0, Math.floor(successCount));
  if (safeCount === 0) return 0;

  // Logarithmic scale: diminishing returns with more successes
  // Cap at ~20 successes for full bonus
  const ratio = Math.log2(safeCount + 1) / Math.log2(SUCCESS_RATE_LOG_CAP + 1);
  return roundTo2(Math.min(successRateBonusMax, ratio * successRateBonusMax));
}

function sanitizeDivisor(divisor: number): number {
  return Math.max(MIN_SCORE_DIVISOR, divisor);
}

function calculateCappedLinearScore(value: number, divisor: number, maxScore: number): number {
  return Math.min(maxScore, value / sanitizeDivisor(divisor));
}

function calculateCappedDifferenceScore(maxScore: number, difference: number, factor: number): number {
  return Math.max(0, maxScore - difference * factor);
}

function calculateDistanceComponentScore(
  distanceKm: number,
  scoringRules: MatchingScoringRules,
): number {
  if (distanceKm >= 9999) {
    return scoringRules.distanceScoreFallback;
  }

  return calculateCappedDifferenceScore(
    scoringRules.distanceScoreMax,
    distanceKm,
    1 / sanitizeDivisor(scoringRules.distanceScoreDivisor),
  );
}

function calculateCappedItemScore(itemCount: number, itemFactor: number, maxScore: number): number {
  return Math.min(maxScore, itemCount * itemFactor);
}

function resolveCandidateScoreContext(
  totalA: number,
  totalB: number,
  diff: number,
  distanceKm: number,
  scoringRules: MatchingScoringRules,
  isGroupMemberOrReferenceDate: boolean | Date,
  referenceDate: Date,
): CandidateScoreContext {
  const isGroupMember = typeof isGroupMemberOrReferenceDate === 'boolean'
    ? isGroupMemberOrReferenceDate
    : false;
  const effectiveReferenceDate = isGroupMemberOrReferenceDate instanceof Date
    ? isGroupMemberOrReferenceDate
    : referenceDate;
  const nearExpiryDays = Math.max(1, Math.floor(scoringRules.nearExpiryDays));
  const minValue = Math.min(totalA, totalB);

  return {
    valueScore: calculateCappedLinearScore(minValue, scoringRules.valueScoreDivisor, scoringRules.valueScoreMax),
    balanceScore: calculateCappedDifferenceScore(
      scoringRules.balanceScoreMax,
      diff,
      scoringRules.balanceScoreDiffFactor,
    ),
    distanceScore: calculateDistanceComponentScore(distanceKm, scoringRules),
    nearExpiryDays,
    effectiveReferenceDate,
    isGroupMember,
  };
}

export function calculateCandidateScore(
  totalA: number,
  totalB: number,
  diff: number,
  distanceKm: number,
  itemsFromA: MatchItem[],
  itemsFromB: MatchItem[],
  scoringRules: MatchingScoringRules = DEFAULT_MATCHING_SCORING_RULES,
  isFavorite: boolean = false,
  isGroupMemberOrReferenceDate: boolean | Date = false,
  referenceDate: Date = new Date(),
): number {
  const context = resolveCandidateScoreContext(
    totalA,
    totalB,
    diff,
    distanceKm,
    scoringRules,
    isGroupMemberOrReferenceDate,
    referenceDate,
  );
  const nearExpiryScore = calculateExponentialNearExpiryScore(
    [...itemsFromA, ...itemsFromB],
    context.nearExpiryDays,
    scoringRules.nearExpiryDecayCurve,
    scoringRules.nearExpiryItemFactor,
    scoringRules.nearExpiryScoreMax,
    context.effectiveReferenceDate,
  );
  const diversityScore = calculateCappedItemScore(
    Math.min(itemsFromA.length, itemsFromB.length),
    scoringRules.diversityItemFactor,
    scoringRules.diversityScoreMax,
  );
  const favoriteScore = isFavorite ? scoringRules.favoriteBonus : 0;
  const groupScore = context.isGroupMember ? scoringRules.groupBonus : 0;

  return roundTo2(
    context.valueScore
      + context.balanceScore
      + context.distanceScore
      + nearExpiryScore
      + diversityScore
      + favoriteScore
      + groupScore,
  );
}

export function calculateMatchRate(itemsA: MatchItem[], itemsB: MatchItem[]): number {
  const scores = [...itemsA, ...itemsB]
    .map((item) => item.matchScore ?? 0)
    .filter((score) => score > 0);
  if (scores.length === 0) return 0;
  return roundTo2((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 100);
}
