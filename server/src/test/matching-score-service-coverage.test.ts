import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
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

describe('matching-score-service coverage', () => {
  describe('roundTo2', () => {
    it('rounds to 2 decimal places', () => {
      expect(roundTo2(1.005)).toBe(1);
      expect(roundTo2(1.555)).toBe(1.56);
      expect(roundTo2(100)).toBe(100);
      expect(roundTo2(0.1 + 0.2)).toBeCloseTo(0.3, 2);
    });
  });

  describe('setLimitedCacheEntry', () => {
    it('adds entry to cache', () => {
      const cache = new Map<string, number>();
      setLimitedCacheEntry(cache, 'a', 1, 10);
      expect(cache.get('a')).toBe(1);
    });

    it('updates existing entry without eviction', () => {
      const cache = new Map<string, number>();
      cache.set('a', 1);
      setLimitedCacheEntry(cache, 'a', 2, 10);
      expect(cache.get('a')).toBe(2);
    });

    it('evicts oldest entry when at max size', () => {
      const cache = new Map<string, number>();
      cache.set('a', 1);
      cache.set('b', 2);
      setLimitedCacheEntry(cache, 'c', 3, 2);
      expect(cache.has('a')).toBe(false);
      expect(cache.get('b')).toBe(2);
      expect(cache.get('c')).toBe(3);
    });

    it('does not evict when updating existing key at capacity', () => {
      const cache = new Map<string, number>();
      cache.set('a', 1);
      cache.set('b', 2);
      setLimitedCacheEntry(cache, 'b', 99, 2);
      expect(cache.get('a')).toBe(1);
      expect(cache.get('b')).toBe(99);
    });
  });

  describe('prepareDrugName', () => {
    it('normalizes and prepares a drug name', () => {
      const result = prepareDrugName('アスピリン100mg錠');
      expect(result.normalizedDrugName).toBeTruthy();
      expect(result.tokenSet).toBeInstanceOf(Set);
      expect(result.tokenSet.size).toBeGreaterThan(0);
    });

    it('handles empty string', () => {
      const result = prepareDrugName('');
      expect(result.normalizedDrugName).toBe('');
      expect(result.tokenSet.size).toBe(0);
    });

    it('strips dose units and form suffixes', () => {
      const result = prepareDrugName('メトホルミン250mg錠');
      expect(result.normalizedDrugName).not.toContain('250mg');
      expect(result.normalizedDrugName).not.toMatch(/錠$/);
    });

    it('strips multiple dose patterns', () => {
      const result = prepareDrugName('薬5.5ml');
      expect(result.normalizedDrugName).not.toContain('5.5ml');
    });

    it('strips microgram patterns', () => {
      const result = prepareDrugName('薬25μg');
      expect(result.normalizedDrugName).not.toContain('25μg');
    });

    it('strips percentage patterns', () => {
      const result = prepareDrugName('薬0.5%');
      expect(result.normalizedDrugName).not.toContain('0.5%');
    });

    it('generates ngrams for short names', () => {
      const result = prepareDrugName('アスピリン');
      // Short names should generate bigrams
      expect(result.tokenSet.size).toBeGreaterThan(1);
    });
  });

  describe('buildUsedMedIndex', () => {
    it('builds index from rows', () => {
      const rows: UsedMedRow[] = [
        { pharmacyId: 1, drugName: 'アスピリン100mg錠' },
        { pharmacyId: 1, drugName: 'ロキソプロフェン60mg錠' },
      ];

      const index = buildUsedMedIndex(rows);
      expect(index.names.length).toBe(2);
      expect(index.exactNames.size).toBe(2);
      expect(index.tokenIndex.size).toBeGreaterThan(0);
    });

    it('deduplicates identical normalized names', () => {
      const rows: UsedMedRow[] = [
        { pharmacyId: 1, drugName: 'アスピリン100mg錠' },
        { pharmacyId: 1, drugName: 'アスピリン100mg錠' },
      ];

      const index = buildUsedMedIndex(rows);
      expect(index.names.length).toBe(1);
    });

    it('returns empty index for empty rows', () => {
      const index = buildUsedMedIndex([]);
      expect(index.names.length).toBe(0);
      expect(index.exactNames.size).toBe(0);
    });

    it('populates lengthBuckets', () => {
      const rows: UsedMedRow[] = [
        { pharmacyId: 1, drugName: 'アスピリン100mg錠' },
        { pharmacyId: 1, drugName: 'ロキソプロフェン60mg錠' },
      ];

      const index = buildUsedMedIndex(rows);
      expect(index.lengthBuckets.size).toBeGreaterThan(0);
    });
  });

  describe('findBestDrugMatch', () => {
    const rows: UsedMedRow[] = [
      { pharmacyId: 1, drugName: 'アスピリン100mg錠' },
      { pharmacyId: 1, drugName: 'ロキソプロフェン60mg錠' },
      { pharmacyId: 1, drugName: 'メトホルミン250mg錠' },
    ];

    it('finds exact match and returns score 1', () => {
      const index = buildUsedMedIndex(rows);
      const cache = new Map<string, DrugMatchResult>();
      const result = findBestDrugMatch('アスピリン100mg錠', index, cache);
      expect(result.score).toBe(1);
    });

    it('returns cached result on second call', () => {
      const index = buildUsedMedIndex(rows);
      const cache = new Map<string, DrugMatchResult>();
      const first = findBestDrugMatch('アスピリン100mg錠', index, cache);
      const second = findBestDrugMatch('アスピリン100mg錠', index, cache);
      expect(second).toBe(first);
    });

    it('returns 0 for empty drug name', () => {
      const index = buildUsedMedIndex(rows);
      const cache = new Map<string, DrugMatchResult>();
      const result = findBestDrugMatch('', index, cache);
      expect(result.score).toBe(0);
    });

    it('returns high score for similar drug names', () => {
      const index = buildUsedMedIndex(rows);
      const cache = new Map<string, DrugMatchResult>();
      // Close variation
      const result = findBestDrugMatch('アスピリン', index, cache);
      expect(result.score).toBeGreaterThan(0.5);
    });

    it('returns low score for completely different drug names', () => {
      const index = buildUsedMedIndex(rows);
      const cache = new Map<string, DrugMatchResult>();
      const result = findBestDrugMatch('zzzzz', index, cache);
      expect(result.score).toBeLessThan(0.5);
    });

    it('accepts PreparedDrugName as input', () => {
      const index = buildUsedMedIndex(rows);
      const cache = new Map<string, DrugMatchResult>();
      const prepared = prepareDrugName('アスピリン100mg錠');
      const result = findBestDrugMatch(prepared, index, cache);
      expect(result.score).toBe(1);
    });

    it('falls back to full scan when candidate indices cover most entries', () => {
      // Create an index with many entries that share similar tokens
      const manyRows: UsedMedRow[] = [];
      for (let i = 0; i < 5; i++) {
        manyRows.push({ pharmacyId: 1, drugName: `テスト薬${i}` });
      }
      const index = buildUsedMedIndex(manyRows);
      const cache = new Map<string, DrugMatchResult>();
      const result = findBestDrugMatch('テスト薬2', index, cache);
      expect(result.score).toBeGreaterThan(0);
    });
  });

  describe('toStartOfDay', () => {
    it('zeroes out hours, minutes, seconds, milliseconds', () => {
      const d = new Date(2026, 1, 15, 14, 30, 45, 500);
      const result = toStartOfDay(d);
      expect(result.getHours()).toBe(0);
      expect(result.getMinutes()).toBe(0);
      expect(result.getSeconds()).toBe(0);
      expect(result.getMilliseconds()).toBe(0);
    });

    it('does not mutate original date', () => {
      const d = new Date(2026, 1, 15, 14, 30, 45);
      toStartOfDay(d);
      expect(d.getHours()).toBe(14);
    });
  });

  describe('parseExpiryDate', () => {
    it('returns null for null input', () => {
      expect(parseExpiryDate(null)).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(parseExpiryDate(undefined)).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseExpiryDate('')).toBeNull();
    });

    it('returns null for whitespace-only string', () => {
      expect(parseExpiryDate('   ')).toBeNull();
    });

    it('parses ISO date format', () => {
      const result = parseExpiryDate('2026-06-15');
      expect(result).toBeInstanceOf(Date);
      expect(result!.getFullYear()).toBe(2026);
    });

    it('parses Japanese date format with 年月日', () => {
      const result = parseExpiryDate('2026年6月15日');
      expect(result).toBeInstanceOf(Date);
    });

    it('parses dot-separated date format', () => {
      const result = parseExpiryDate('2026.06.15');
      expect(result).toBeInstanceOf(Date);
    });

    it('returns null for unparseable date', () => {
      const result = parseExpiryDate('not-a-date-xyz');
      expect(result).toBeNull();
    });

    it('caches parsed dates', () => {
      const first = parseExpiryDate('2026-06-15');
      const second = parseExpiryDate('2026-06-15');
      // Both should return valid dates
      expect(first).toBeInstanceOf(Date);
      expect(second).toBeInstanceOf(Date);
    });
  });

  describe('isExpiredDate', () => {
    it('returns false for null expiry', () => {
      expect(isExpiredDate(null)).toBe(false);
    });

    it('returns false for undefined expiry', () => {
      expect(isExpiredDate(undefined)).toBe(false);
    });

    it('returns true for past date', () => {
      const referenceDate = new Date('2026-06-01');
      expect(isExpiredDate('2026-05-01', referenceDate)).toBe(true);
    });

    it('returns false for future date', () => {
      const referenceDate = new Date('2026-01-01');
      expect(isExpiredDate('2026-06-15', referenceDate)).toBe(false);
    });

    it('returns false for same day', () => {
      const referenceDate = new Date('2026-06-15T12:00:00');
      expect(isExpiredDate('2026-06-15', referenceDate)).toBe(false);
    });
  });

  describe('getNearExpiryCount', () => {
    it('returns 0 for empty items', () => {
      expect(getNearExpiryCount([], 120, new Date('2026-02-01'))).toBe(0);
    });

    it('counts items within threshold days', () => {
      const ref = new Date('2026-02-01');
      const items = [
        createItem({ expirationDateIso: '2026-02-10' }),  // 9 days
        createItem({ expirationDateIso: '2026-08-01' }),  // 181 days, beyond 120
        createItem({ expirationDateIso: null, expirationDate: '2026-02-15' }),  // 14 days
      ];
      // 9 days and 14 days count; 181 days does not count at 120-day threshold
      expect(getNearExpiryCount(items, 120, ref)).toBe(2);
      // All 3 items count at 200-day threshold
      expect(getNearExpiryCount(items, 200, ref)).toBe(3);
    });

    it('does not count items with no expiry date', () => {
      const ref = new Date('2026-02-01');
      const items = [
        createItem({ expirationDateIso: null, expirationDate: null }),
      ];
      expect(getNearExpiryCount(items, 120, ref)).toBe(0);
    });

    it('uses expirationDateIso preferentially over expirationDate', () => {
      const ref = new Date('2026-02-01');
      const items = [
        // expirationDateIso within threshold, expirationDate far away
        createItem({
          expirationDateIso: '2026-02-05',
          expirationDate: '2027-01-01',
        }),
      ];
      expect(getNearExpiryCount(items, 10, ref)).toBe(1);
    });

    it('does not count expired items (diffDays < 0)', () => {
      const ref = new Date('2026-06-01');
      const items = [
        createItem({ expirationDateIso: '2026-05-01' }),
      ];
      expect(getNearExpiryCount(items, 120, ref)).toBe(0);
    });

    it('handles nearExpiryDays < 1 by clamping to 1', () => {
      const ref = new Date('2026-02-01');
      const items = [
        createItem({ expirationDateIso: '2026-02-01' }),
        createItem({ expirationDateIso: '2026-02-02' }),
      ];
      // Clamped to 1 day: items on same day and 1 day ahead both count
      expect(getNearExpiryCount(items, 0.5, ref)).toBe(2);
    });
  });

  describe('calculateCandidateScore', () => {
    it('returns higher score for closer pharmacies', () => {
      const items = [createItem()];
      const score1 = calculateCandidateScore(10000, 10000, 0, 1, items, items, DEFAULT_MATCHING_SCORING_RULES);
      const score2 = calculateCandidateScore(10000, 10000, 0, 100, items, items, DEFAULT_MATCHING_SCORING_RULES);
      expect(score1).toBeGreaterThan(score2);
    });

    it('applies fallback distance score for unknown distance', () => {
      const items = [createItem()];
      const score = calculateCandidateScore(10000, 10000, 0, 9999, items, items, DEFAULT_MATCHING_SCORING_RULES);
      // Score should include distanceScoreFallback (2) instead of distanceScoreMax
      expect(score).toBeGreaterThan(0);
    });

    it('rewards favorites with bonus score', () => {
      const items = [createItem()];
      const scoreNoFav = calculateCandidateScore(10000, 10000, 0, 5, items, items, DEFAULT_MATCHING_SCORING_RULES, false);
      const scoreFav = calculateCandidateScore(10000, 10000, 0, 5, items, items, DEFAULT_MATCHING_SCORING_RULES, true);
      expect(scoreFav - scoreNoFav).toBe(DEFAULT_MATCHING_SCORING_RULES.favoriteBonus);
    });

    it('penalizes high value difference', () => {
      const items = [createItem()];
      const scoreLowDiff = calculateCandidateScore(10000, 10000, 0, 5, items, items, DEFAULT_MATCHING_SCORING_RULES);
      const scoreHighDiff = calculateCandidateScore(10000, 10000, 10, 5, items, items, DEFAULT_MATCHING_SCORING_RULES);
      expect(scoreLowDiff).toBeGreaterThan(scoreHighDiff);
    });

    it('rewards more items via diversity score', () => {
      const oneItem = [createItem()];
      const manyItems = [createItem(), createItem({ deadStockItemId: 2 }), createItem({ deadStockItemId: 3 })];
      const scoreOne = calculateCandidateScore(10000, 10000, 0, 5, oneItem, oneItem, DEFAULT_MATCHING_SCORING_RULES);
      const scoreMany = calculateCandidateScore(10000, 10000, 0, 5, manyItems, manyItems, DEFAULT_MATCHING_SCORING_RULES);
      expect(scoreMany).toBeGreaterThan(scoreOne);
    });

    it('handles zero divisors by clamping', () => {
      const rules: MatchingScoringRules = {
        ...DEFAULT_MATCHING_SCORING_RULES,
        valueScoreDivisor: 0,
        distanceScoreDivisor: 0,
      };
      const items = [createItem()];
      // Should not throw, divisors are clamped to 0.0001
      const score = calculateCandidateScore(10000, 10000, 0, 5, items, items, rules);
      expect(typeof score).toBe('number');
      expect(Number.isFinite(score)).toBe(true);
    });
  });

  describe('calculateMatchRate', () => {
    it('returns 0 for empty arrays', () => {
      expect(calculateMatchRate([], [])).toBe(0);
    });

    it('returns 0 when all matchScores are 0', () => {
      const items = [createItem({ matchScore: 0 }), createItem({ matchScore: 0 })];
      expect(calculateMatchRate(items, [])).toBe(0);
    });

    it('calculates average match score as percentage', () => {
      const itemsA = [createItem({ matchScore: 0.8 })];
      const itemsB = [createItem({ matchScore: 0.6 })];
      const rate = calculateMatchRate(itemsA, itemsB);
      // Average of 0.8, 0.6 = 0.7, * 100 = 70
      expect(rate).toBe(70);
    });

    it('handles items without matchScore', () => {
      const items = [{ ...createItem(), matchScore: undefined } as unknown as MatchItem];
      // matchScore undefined -> treated as 0 -> filtered out
      expect(calculateMatchRate(items, [])).toBe(0);
    });
  });
});
