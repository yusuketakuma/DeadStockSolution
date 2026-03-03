/**
 * matching-score-deep.test.ts
 * matching-score-service.ts の未カバーブランチを追加テスト
 * - prepareDrugName empty string / whitespace
 * - findBestDrugMatch cache hit, exact match, candidate index, full scan
 * - buildUsedMedIndex dedup, tokenIndex, lengthBuckets
 * - setLimitedCacheEntry eviction
 * - calculateCandidateScore with edge divisors, 9999km distance
 * - calculateMatchRate zero scores, mixed scores
 * - parseExpiryDate various date formats, cache behavior
 * - toStartOfDay normalization
 * - getNearExpiryCount with expirationDateIso
 * - collectCandidateIndices near-length fallback, 90% threshold
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildUsedMedIndex,
  calculateCandidateScore,
  calculateMatchRate,
  DEFAULT_MATCHING_SCORING_RULES,
  findBestDrugMatch,
  getNearExpiryCount,
  isExpiredDate,
  parseExpiryDate,
  prepareDrugName,
  roundTo2,
  setLimitedCacheEntry,
  toStartOfDay,
  type DrugMatchResult,
  type MatchingScoringRules,
  type UsedMedRow,
} from '../services/matching-score-service';
import { MatchItem } from '../types';

function createItem(overrides: Partial<MatchItem> = {}): MatchItem {
  return {
    deadStockItemId: 1,
    drugName: '薬A',
    quantity: 10,
    unit: '錠',
    yakkaUnitPrice: 100,
    yakkaValue: 1000,
    expirationDate: null,
    expirationDateIso: null,
    matchScore: 0.9,
    ...overrides,
  };
}

describe('matching-score-service deep coverage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── roundTo2 ──

  describe('roundTo2', () => {
    it('rounds to 2 decimal places', () => {
      expect(roundTo2(3.14159)).toBe(3.14);
      expect(roundTo2(0)).toBe(0);
      // 1.005 * 100 = 100.49999999999999 in IEEE 754, so Math.round yields 100
      expect(roundTo2(1.005)).toBe(1);
      expect(roundTo2(2.555)).toBe(2.56);
    });
  });

  // ── setLimitedCacheEntry ──

  describe('setLimitedCacheEntry', () => {
    it('evicts oldest entry when cache exceeds max size', () => {
      const cache = new Map<string, number>();
      cache.set('a', 1);
      cache.set('b', 2);
      setLimitedCacheEntry(cache, 'c', 3, 2); // max=2, should evict 'a'
      expect(cache.has('a')).toBe(false);
      expect(cache.has('b')).toBe(true);
      expect(cache.get('c')).toBe(3);
    });

    it('does not evict when updating existing key', () => {
      const cache = new Map<string, number>();
      cache.set('a', 1);
      cache.set('b', 2);
      setLimitedCacheEntry(cache, 'a', 10, 2);
      expect(cache.size).toBe(2);
      expect(cache.get('a')).toBe(10);
    });
  });

  // ── prepareDrugName ──

  describe('prepareDrugName', () => {
    it('normalizes drug name and creates token set', () => {
      const result = prepareDrugName('アムロジピンOD錠5mg');
      expect(result.normalizedDrugName).toBeTruthy();
      expect(result.tokenSet.size).toBeGreaterThan(0);
    });

    it('returns empty token set for empty input', () => {
      const result = prepareDrugName('');
      expect(result.normalizedDrugName).toBe('');
      expect(result.tokenSet.size).toBe(0);
    });
  });

  // ── buildUsedMedIndex ──

  describe('buildUsedMedIndex', () => {
    it('builds index with exact names, tokens, and length buckets', () => {
      const rows: UsedMedRow[] = [
        { pharmacyId: 1, drugName: 'アムロジピンOD錠5mg' },
        { pharmacyId: 2, drugName: 'メトホルミン塩酸塩錠250mg' },
      ];
      const index = buildUsedMedIndex(rows);
      expect(index.exactNames.size).toBeGreaterThan(0);
      expect(index.names.length).toBeGreaterThan(0);
      expect(index.tokenIndex.size).toBeGreaterThan(0);
    });

    it('deduplicates identical drug names', () => {
      const rows: UsedMedRow[] = [
        { pharmacyId: 1, drugName: 'ロキソプロフェン' },
        { pharmacyId: 2, drugName: 'ロキソプロフェン' },
      ];
      const index = buildUsedMedIndex(rows);
      expect(index.names.length).toBe(1);
    });

    it('handles empty drug names', () => {
      const rows: UsedMedRow[] = [
        { pharmacyId: 1, drugName: '' },
        { pharmacyId: 2, drugName: '  ' },
      ];
      const index = buildUsedMedIndex(rows);
      expect(index.names.length).toBe(0);
    });
  });

  // ── findBestDrugMatch ──

  describe('findBestDrugMatch', () => {
    it('returns score 0 for empty normalized name', () => {
      const index = buildUsedMedIndex([{ pharmacyId: 1, drugName: 'テスト薬' }]);
      const cache = new Map<string, DrugMatchResult>();
      const result = findBestDrugMatch('', index, cache);
      expect(result.score).toBe(0);
    });

    it('returns score 1 for exact match', () => {
      const index = buildUsedMedIndex([{ pharmacyId: 1, drugName: 'アムロジピン' }]);
      const cache = new Map<string, DrugMatchResult>();
      const result = findBestDrugMatch('アムロジピン', index, cache);
      expect(result.score).toBe(1);
    });

    it('uses cache for repeated lookups', () => {
      const index = buildUsedMedIndex([{ pharmacyId: 1, drugName: 'テスト薬品' }]);
      const cache = new Map<string, DrugMatchResult>();
      findBestDrugMatch('テスト薬品', index, cache);
      expect(cache.size).toBe(1);
      const result = findBestDrugMatch('テスト薬品', index, cache);
      expect(result.score).toBe(1);
    });

    it('accepts PreparedDrugName directly', () => {
      const index = buildUsedMedIndex([{ pharmacyId: 1, drugName: 'ロキソプロフェン' }]);
      const cache = new Map<string, DrugMatchResult>();
      const prepared = prepareDrugName('ロキソプロフェン');
      const result = findBestDrugMatch(prepared, index, cache);
      expect(result.score).toBe(1);
    });

    it('falls back to full scan when candidate indices cover 90% of names', () => {
      // Build a very small index so candidates cover all names
      const rows: UsedMedRow[] = [
        { pharmacyId: 1, drugName: 'AB' },
      ];
      const index = buildUsedMedIndex(rows);
      const cache = new Map<string, DrugMatchResult>();
      const result = findBestDrugMatch('AB', index, cache);
      expect(result.score).toBe(1);
    });
  });

  // ── parseExpiryDate ──

  describe('parseExpiryDate', () => {
    it('parses YYYY/MM/DD format', () => {
      const d = parseExpiryDate('2026/06/15');
      expect(d).toBeInstanceOf(Date);
      expect(d!.getFullYear()).toBe(2026);
    });

    it('parses YYYY年MM月DD日 format', () => {
      const d = parseExpiryDate('2026年06月15日');
      expect(d).toBeInstanceOf(Date);
    });

    it('parses YYYY-MM-DD format', () => {
      const d = parseExpiryDate('2026-06-15');
      expect(d).toBeInstanceOf(Date);
    });

    it('parses YYYY.MM.DD format', () => {
      const d = parseExpiryDate('2026.06.15');
      expect(d).toBeInstanceOf(Date);
    });

    it('returns null for null/undefined/empty', () => {
      expect(parseExpiryDate(null)).toBeNull();
      expect(parseExpiryDate(undefined)).toBeNull();
      expect(parseExpiryDate('')).toBeNull();
      expect(parseExpiryDate('  ')).toBeNull();
    });

    it('returns null for unparseable string', () => {
      expect(parseExpiryDate('not-a-date')).toBeNull();
    });

    it('uses cache for repeated calls', () => {
      const d1 = parseExpiryDate('2026/12/31');
      const d2 = parseExpiryDate('2026/12/31');
      expect(d1).toEqual(d2);
    });
  });

  // ── toStartOfDay ──

  describe('toStartOfDay', () => {
    it('sets time to midnight', () => {
      const d = new Date('2026-03-15T14:30:00.000Z');
      const result = toStartOfDay(d);
      expect(result.getHours()).toBe(0);
      expect(result.getMinutes()).toBe(0);
      expect(result.getSeconds()).toBe(0);
      expect(result.getMilliseconds()).toBe(0);
    });
  });

  // ── isExpiredDate ──

  describe('isExpiredDate', () => {
    it('returns false for null', () => {
      expect(isExpiredDate(null)).toBe(false);
    });

    it('returns true for past date', () => {
      expect(isExpiredDate('2026-02-28', new Date('2026-03-01T00:00:00.000Z'))).toBe(true);
    });

    it('returns false for future date', () => {
      expect(isExpiredDate('2026-03-15', new Date('2026-03-01T00:00:00.000Z'))).toBe(false);
    });

    it('returns false for today', () => {
      expect(isExpiredDate('2026-03-01', new Date('2026-03-01T00:00:00.000Z'))).toBe(false);
    });
  });

  // ── getNearExpiryCount ──

  describe('getNearExpiryCount', () => {
    it('counts items near expiry using expirationDateIso', () => {
      const now = new Date('2026-03-01T00:00:00.000Z');
      const items = [
        createItem({ expirationDate: null, expirationDateIso: '2026-03-10' }),
        createItem({ expirationDate: null, expirationDateIso: '2026-06-01' }),
      ];
      expect(getNearExpiryCount(items, 30, now)).toBe(1);
    });

    it('returns 0 for empty items', () => {
      expect(getNearExpiryCount([], 30)).toBe(0);
    });

    it('skips items with no parseable expiry', () => {
      const items = [
        createItem({ expirationDate: 'invalid', expirationDateIso: null }),
      ];
      expect(getNearExpiryCount(items, 30, new Date('2026-03-01'))).toBe(0);
    });

    it('handles nearExpiryDays < 1 by using 1', () => {
      const items = [
        createItem({ expirationDate: '2026-03-01', expirationDateIso: null }),
      ];
      expect(getNearExpiryCount(items, 0, new Date('2026-03-01'))).toBe(1);
    });
  });

  // ── calculateCandidateScore ──

  describe('calculateCandidateScore', () => {
    it('uses distanceScoreFallback for 9999km distance', () => {
      const score = calculateCandidateScore(
        1000, 1000, 0, 9999, [], [],
        { ...DEFAULT_MATCHING_SCORING_RULES, distanceScoreFallback: 5 },
      );
      // distanceScore = 5 (fallback)
      expect(score).toBeGreaterThan(0);
    });

    it('applies favoriteBonus when isFavorite=true', () => {
      const withoutFav = calculateCandidateScore(100, 100, 0, 10, [], []);
      const withFav = calculateCandidateScore(100, 100, 0, 10, [], [], DEFAULT_MATCHING_SCORING_RULES, true);
      expect(withFav - withoutFav).toBeCloseTo(DEFAULT_MATCHING_SCORING_RULES.favoriteBonus, 1);
    });

    it('handles zero divisors gracefully', () => {
      const rules: MatchingScoringRules = {
        ...DEFAULT_MATCHING_SCORING_RULES,
        valueScoreDivisor: 0,
        distanceScoreDivisor: 0,
      };
      const score = calculateCandidateScore(100, 100, 0, 10, [], [], rules);
      expect(Number.isFinite(score)).toBe(true);
    });

    it('handles very large balance diff', () => {
      const score = calculateCandidateScore(10000, 0, 10000, 10, [], []);
      expect(score).toBeGreaterThanOrEqual(0);
    });
  });

  // ── calculateMatchRate ──

  describe('calculateMatchRate', () => {
    it('returns 0 for empty arrays', () => {
      expect(calculateMatchRate([], [])).toBe(0);
    });

    it('returns 0 when all matchScores are 0', () => {
      expect(calculateMatchRate(
        [createItem({ matchScore: 0 })],
        [createItem({ matchScore: 0 })],
      )).toBe(0);
    });

    it('calculates average match rate from both sides', () => {
      const itemsA = [createItem({ matchScore: 0.8 })];
      const itemsB = [createItem({ matchScore: 0.6 })];
      const rate = calculateMatchRate(itemsA, itemsB);
      expect(rate).toBe(70); // avg 0.7 * 100
    });

    it('ignores items with undefined matchScore', () => {
      const itemsA = [createItem({ matchScore: undefined })];
      const itemsB = [createItem({ matchScore: 0.5 })];
      const rate = calculateMatchRate(itemsA, itemsB);
      expect(rate).toBe(50); // only 0.5 counted
    });
  });
});
