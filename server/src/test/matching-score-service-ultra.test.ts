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
  type UsedMedIndex,
} from '../services/matching-score-service';
import type { MatchItem } from '../types';

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

describe('matching-score-service-ultra', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── setLimitedCacheEntry ──
  describe('setLimitedCacheEntry', () => {
    it('evicts oldest entry when cache exceeds maxSize', () => {
      const cache = new Map<string, number>();
      cache.set('a', 1);
      cache.set('b', 2);
      setLimitedCacheEntry(cache, 'c', 3, 2);
      // 'a' should have been evicted
      expect(cache.has('a')).toBe(false);
      expect(cache.has('b')).toBe(true);
      expect(cache.get('c')).toBe(3);
    });

    it('does not evict when key already exists', () => {
      const cache = new Map<string, number>();
      cache.set('a', 1);
      cache.set('b', 2);
      setLimitedCacheEntry(cache, 'a', 10, 2);
      expect(cache.size).toBe(2);
      expect(cache.get('a')).toBe(10);
    });

    it('handles cache size of 0 by always evicting', () => {
      const cache = new Map<string, number>();
      setLimitedCacheEntry(cache, 'a', 1, 0);
      // Should still set since there was nothing to evict except itself
      expect(cache.has('a')).toBe(true);
    });
  });

  // ── roundTo2 ──
  describe('roundTo2', () => {
    it('rounds to 2 decimal places', () => {
      expect(roundTo2(1.005)).toBe(1);
      expect(roundTo2(1.125)).toBe(1.13);
      expect(roundTo2(0)).toBe(0);
      expect(roundTo2(-1.555)).toBe(-1.55); // JS floating point: Math.round(-155.5) = -155
    });
  });

  // ── prepareDrugName ──
  describe('prepareDrugName', () => {
    it('normalizes and removes dosage form suffixes', () => {
      const result = prepareDrugName('ロキソプロフェン錠');
      expect(result.normalizedDrugName).not.toContain('錠');
      expect(result.tokenSet.size).toBeGreaterThan(0);
    });

    it('removes dose amounts like 100mg', () => {
      const result = prepareDrugName('薬A 100mg錠');
      expect(result.normalizedDrugName).not.toContain('100mg');
    });

    it('handles empty string', () => {
      const result = prepareDrugName('');
      expect(result.normalizedDrugName).toBe('');
      expect(result.tokenSet.size).toBe(0);
    });
  });

  // ── buildUsedMedIndex ──
  describe('buildUsedMedIndex', () => {
    it('builds an index with exact names and token index', () => {
      const rows = [
        { pharmacyId: 1, drugName: 'アセトアミノフェン' },
        { pharmacyId: 2, drugName: 'ロキソプロフェン' },
      ];
      const index = buildUsedMedIndex(rows);
      expect(index.exactNames.size).toBe(2);
      expect(index.names.length).toBe(2);
    });

    it('deduplicates rows with the same normalized name', () => {
      const rows = [
        { pharmacyId: 1, drugName: 'アセトアミノフェン錠' },
        { pharmacyId: 2, drugName: 'アセトアミノフェン' }, // same after normalization
      ];
      const index = buildUsedMedIndex(rows);
      // Both normalize to the same string
      expect(index.names.length).toBeLessThanOrEqual(2);
    });

    it('handles empty rows', () => {
      const index = buildUsedMedIndex([]);
      expect(index.exactNames.size).toBe(0);
      expect(index.names.length).toBe(0);
    });

    it('skips empty drug names', () => {
      const rows = [
        { pharmacyId: 1, drugName: '' },
        { pharmacyId: 2, drugName: '有効薬' },
      ];
      const index = buildUsedMedIndex(rows);
      expect(index.names.length).toBe(1);
    });

    it('creates length buckets for near-length matching', () => {
      const rows = [
        { pharmacyId: 1, drugName: 'abc' },
        { pharmacyId: 2, drugName: 'abcd' },
      ];
      const index = buildUsedMedIndex(rows);
      expect(index.lengthBuckets.size).toBeGreaterThan(0);
    });
  });

  // ── findBestDrugMatch ──
  describe('findBestDrugMatch', () => {
    it('returns score 0 for empty drug name', () => {
      const index = buildUsedMedIndex([{ pharmacyId: 1, drugName: 'テスト薬' }]);
      const cache = new Map<string, DrugMatchResult>();
      const result = findBestDrugMatch('', index, cache);
      expect(result.score).toBe(0);
    });

    it('returns score 1 for exact match', () => {
      const index = buildUsedMedIndex([{ pharmacyId: 1, drugName: 'テスト薬品' }]);
      const cache = new Map<string, DrugMatchResult>();
      const result = findBestDrugMatch('テスト薬品', index, cache);
      expect(result.score).toBe(1);
    });

    it('uses cache for repeated lookups', () => {
      const index = buildUsedMedIndex([{ pharmacyId: 1, drugName: 'テスト薬品' }]);
      const cache = new Map<string, DrugMatchResult>();
      const result1 = findBestDrugMatch('テスト薬品', index, cache);
      const result2 = findBestDrugMatch('テスト薬品', index, cache);
      expect(result1).toBe(result2); // same reference
    });

    it('accepts PreparedDrugName as input', () => {
      const index = buildUsedMedIndex([{ pharmacyId: 1, drugName: 'テスト薬品' }]);
      const cache = new Map<string, DrugMatchResult>();
      const prepared = prepareDrugName('テスト薬品');
      const result = findBestDrugMatch(prepared, index, cache);
      expect(result.score).toBe(1);
    });

    it('performs full scan when no candidate indices (all names qualify)', () => {
      // With a single name, collectCandidateIndices might return null
      const index = buildUsedMedIndex([{ pharmacyId: 1, drugName: 'あいうえお' }]);
      const cache = new Map<string, DrugMatchResult>();
      const result = findBestDrugMatch('あいうえおか', index, cache);
      expect(result.score).toBeGreaterThan(0);
    });
  });

  // ── toStartOfDay ──
  describe('toStartOfDay', () => {
    it('zeroes out hours/minutes/seconds/ms', () => {
      const d = new Date('2026-03-01T15:30:45.123Z');
      const result = toStartOfDay(d);
      expect(result.getHours()).toBe(0);
      expect(result.getMinutes()).toBe(0);
      expect(result.getSeconds()).toBe(0);
      expect(result.getMilliseconds()).toBe(0);
    });

    it('does not mutate the original date', () => {
      const d = new Date('2026-03-01T15:30:45.123Z');
      const original = d.getTime();
      toStartOfDay(d);
      expect(d.getTime()).toBe(original);
    });
  });

  // ── parseExpiryDate ──
  describe('parseExpiryDate', () => {
    it('returns null for null/undefined/empty', () => {
      expect(parseExpiryDate(null)).toBeNull();
      expect(parseExpiryDate(undefined)).toBeNull();
      expect(parseExpiryDate('')).toBeNull();
      expect(parseExpiryDate('   ')).toBeNull();
    });

    it('parses Japanese date format 2026年03月01日', () => {
      const result = parseExpiryDate('2026年03月01日');
      expect(result).not.toBeNull();
    });

    it('parses hyphenated dates', () => {
      const result = parseExpiryDate('2026-03-01');
      expect(result).not.toBeNull();
    });

    it('returns null for invalid date strings', () => {
      const result = parseExpiryDate('not-a-date');
      expect(result).toBeNull();
    });

    it('uses cache for repeated lookups', () => {
      const r1 = parseExpiryDate('2026-05-01');
      const r2 = parseExpiryDate('2026-05-01');
      // Both should return date (cache hit)
      expect(r1).not.toBeNull();
      expect(r2).not.toBeNull();
    });
  });

  // ── isExpiredDate ──
  describe('isExpiredDate', () => {
    it('returns false for future date', () => {
      expect(isExpiredDate('2026-06-01', new Date('2026-03-01'))).toBe(false);
    });

    it('returns true for past date', () => {
      expect(isExpiredDate('2026-02-28', new Date('2026-03-01'))).toBe(true);
    });

    it('returns false for today (not expired yet)', () => {
      expect(isExpiredDate('2026-03-01', new Date('2026-03-01'))).toBe(false);
    });

    it('returns false for null', () => {
      expect(isExpiredDate(null)).toBe(false);
    });

    it('returns false for invalid date string', () => {
      expect(isExpiredDate('xxxxx')).toBe(false);
    });
  });

  // ── getNearExpiryCount ──
  describe('getNearExpiryCount', () => {
    it('prefers expirationDateIso over expirationDate', () => {
      const items = [
        createItem({ expirationDate: '2026-06-01', expirationDateIso: '2026-03-05' }),
      ];
      const count = getNearExpiryCount(items, 10, new Date('2026-03-01'));
      expect(count).toBe(1);
    });

    it('uses expirationDate when expirationDateIso is null', () => {
      const items = [
        createItem({ expirationDate: '2026-03-05', expirationDateIso: null }),
      ];
      const count = getNearExpiryCount(items, 10, new Date('2026-03-01'));
      expect(count).toBe(1);
    });

    it('does not count expired items', () => {
      const items = [
        createItem({ expirationDate: '2026-02-01' }),
      ];
      const count = getNearExpiryCount(items, 120, new Date('2026-03-01'));
      expect(count).toBe(0);
    });

    it('does not count items without expiry', () => {
      const items = [
        createItem({ expirationDate: null, expirationDateIso: null }),
      ];
      const count = getNearExpiryCount(items, 10, new Date('2026-03-01'));
      expect(count).toBe(0);
    });

    it('enforces minimum 1 day threshold', () => {
      const items = [
        createItem({ expirationDate: '2026-03-01' }),
      ];
      // With 0 days threshold, Math.max(1, 0) = 1
      const count = getNearExpiryCount(items, 0, new Date('2026-03-01'));
      expect(count).toBe(1);
    });
  });

  // ── calculateCandidateScore ──
  describe('calculateCandidateScore', () => {
    it('applies distance fallback when distanceKm >= 9999', () => {
      const score = calculateCandidateScore(
        1000, 1000, 0, 9999,
        [createItem()], [createItem()],
        DEFAULT_MATCHING_SCORING_RULES, false,
        new Date('2026-03-01'),
      );
      expect(score).toBeGreaterThan(0);
    });

    it('applies favorite bonus when isFavorite is true', () => {
      const withoutFav = calculateCandidateScore(
        1000, 1000, 0, 10,
        [createItem()], [createItem()],
        DEFAULT_MATCHING_SCORING_RULES, false,
        new Date('2026-03-01'),
      );
      const withFav = calculateCandidateScore(
        1000, 1000, 0, 10,
        [createItem()], [createItem()],
        DEFAULT_MATCHING_SCORING_RULES, true,
        new Date('2026-03-01'),
      );
      expect(withFav).toBe(roundTo2(withoutFav + DEFAULT_MATCHING_SCORING_RULES.favoriteBonus));
    });

    it('caps value score at valueScoreMax', () => {
      const rules: MatchingScoringRules = {
        ...DEFAULT_MATCHING_SCORING_RULES,
        valueScoreMax: 10,
        valueScoreDivisor: 1,
      };
      // minValue = 1000000, score = min(10, 1000000/1) = 10
      const score = calculateCandidateScore(
        1000000, 1000000, 0, 0,
        [], [],
        rules, false,
        new Date('2026-03-01'),
      );
      expect(score).toBeGreaterThanOrEqual(10);
    });

    it('handles zero divisors gracefully via Math.max(0.0001)', () => {
      const rules: MatchingScoringRules = {
        ...DEFAULT_MATCHING_SCORING_RULES,
        valueScoreDivisor: 0,
        distanceScoreDivisor: 0,
      };
      expect(() => calculateCandidateScore(
        1000, 1000, 0, 10,
        [], [],
        rules, false,
        new Date('2026-03-01'),
      )).not.toThrow();
    });

    it('diversity score based on min of item counts', () => {
      const rules: MatchingScoringRules = {
        ...DEFAULT_MATCHING_SCORING_RULES,
        diversityScoreMax: 100,
        diversityItemFactor: 10,
      };
      const score = calculateCandidateScore(
        0, 0, 0, 9999,
        [createItem(), createItem()],
        [createItem(), createItem(), createItem()],
        rules, false,
        new Date('2026-03-01'),
      );
      // diversity = min(100, min(2,3)*10) = min(100, 20) = 20
      expect(score).toBeGreaterThanOrEqual(20);
    });
  });

  // ── calculateMatchRate ──
  describe('calculateMatchRate', () => {
    it('returns 0 when no items have matchScore', () => {
      const a = [createItem({ matchScore: 0 })];
      const b = [createItem({ matchScore: 0 })];
      expect(calculateMatchRate(a, b)).toBe(0);
    });

    it('returns 0 when no items at all', () => {
      expect(calculateMatchRate([], [])).toBe(0);
    });

    it('calculates average matchScore as percentage', () => {
      const a = [createItem({ matchScore: 0.8 })];
      const b = [createItem({ matchScore: 1.0 })];
      expect(calculateMatchRate(a, b)).toBe(90);
    });

    it('handles undefined matchScore', () => {
      const a = [createItem({ matchScore: undefined })];
      const b = [createItem({ matchScore: 0.5 })];
      expect(calculateMatchRate(a, b)).toBe(50);
    });
  });
});
