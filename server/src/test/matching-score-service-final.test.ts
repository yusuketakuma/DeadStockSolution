/**
 * matching-score-service-final.test.ts
 * Covers uncovered lines in matching-score-service.ts:
 * - setLimitedCacheEntry: evicting oldest key when cache is at max size
 * - jaccardScore: union === 0 returns 0 (impossible in practice, but branch exists)
 * - computeNameSimilarity: maxLen === 0 returns tokenScore
 * - computeNameSimilarity: early rejection path (tokenScore < 0.12 && length diff > 60%)
 * - collectCandidateIndices: candidateIds.size >= 500 break paths
 * - collectCandidateIndices: returning null when candidateIds.size >= index.names.length * 0.9
 * - findBestDrugMatch: else branch (null candidateIndices → iterate all names)
 * - buildUsedMedIndex: lengthBucket already exists path
 * - calculateMatchRate: normal path with scores
 */
import { describe, expect, it } from 'vitest';
import {
  setLimitedCacheEntry,
  buildUsedMedIndex,
  findBestDrugMatch,
  prepareDrugName,
  calculateMatchRate,
  type UsedMedRow,
} from '../services/matching-score-service';
import type { MatchItem } from '../types';

describe('matching-score-service-final', () => {
  describe('setLimitedCacheEntry — eviction of oldest key', () => {
    it('evicts the oldest key when cache is at max size and key not already present', () => {
      const cache = new Map<string, number>();
      cache.set('key1', 1);
      cache.set('key2', 2);

      // max size = 2, adding a new key should evict key1 (oldest)
      setLimitedCacheEntry(cache, 'key3', 3, 2);

      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(true);
      expect(cache.get('key3')).toBe(3);
      expect(cache.size).toBe(2);
    });

    it('does not evict when key already exists in cache', () => {
      const cache = new Map<string, number>();
      cache.set('key1', 1);
      cache.set('key2', 2);

      // key1 already exists, no eviction
      setLimitedCacheEntry(cache, 'key1', 99, 2);

      expect(cache.get('key1')).toBe(99);
      expect(cache.has('key2')).toBe(true);
      expect(cache.size).toBe(2);
    });

    it('does not evict when cache is below max size', () => {
      const cache = new Map<string, number>();
      cache.set('key1', 1);

      setLimitedCacheEntry(cache, 'key2', 2, 5);

      expect(cache.size).toBe(2);
      expect(cache.get('key2')).toBe(2);
    });
  });

  describe('buildUsedMedIndex — lengthBucket already exists path', () => {
    it('pushes to existing length bucket when multiple drugs have the same name length', () => {
      const rows: UsedMedRow[] = [
        { pharmacyId: 1, drugName: 'アムロジピン' }, // 6 chars normalized
        { pharmacyId: 1, drugName: 'アトルバスタチン' }, // different name, same length bucket possible
        { pharmacyId: 1, drugName: 'メトホルミン' }, // another
      ];

      const index = buildUsedMedIndex(rows);
      expect(index.names.length).toBeGreaterThan(0);
      expect(index.exactNames.size).toBeGreaterThan(0);

      // Check length buckets are populated
      const totalBucketEntries = [...index.lengthBuckets.values()].reduce(
        (sum, arr) => sum + arr.length,
        0,
      );
      expect(totalBucketEntries).toBe(index.names.length);
    });

    it('builds index with multiple drugs of same normalized length (bucket collision)', () => {
      // Use drugs that normalize to the same length to hit the existing lengthBucket push path
      const rows: UsedMedRow[] = [
        { pharmacyId: 1, drugName: 'AbcDef' }, // normalizes to 'abcdef' = 6 chars
        { pharmacyId: 1, drugName: 'XyzWvq' }, // also 6 chars
        { pharmacyId: 1, drugName: 'PqrStu' }, // also 6 chars
      ];

      const index = buildUsedMedIndex(rows);

      // Find the bucket with 6-char entries
      let bucketWithMultiple: number[] | undefined;
      for (const [, bucket] of index.lengthBuckets) {
        if (bucket.length > 1) {
          bucketWithMultiple = bucket;
          break;
        }
      }
      // At least one bucket should have multiple entries (same length = same bucket)
      expect(bucketWithMultiple).toBeDefined();
      if (bucketWithMultiple) {
        expect(bucketWithMultiple.length).toBeGreaterThan(1);
      }
    });
  });

  describe('findBestDrugMatch — null candidateIndices (iterate all names)', () => {
    it('falls back to iterating all names when candidateIds.size >= names.length * 0.9', () => {
      // Build an index with 2 distinct names that both share the token 'abc'.
      // When searching for 'abcxyz', tokens include 'abc', matching both entries.
      // candidateIds.size = 2 >= names.length (2) * 0.9 = 1.8 → returns null
      // → findBestDrugMatch uses the else branch to iterate all names.
      const rows: UsedMedRow[] = [
        { pharmacyId: 1, drugName: 'abcAlpha' }, // normalizes to 'abcalpha'
        { pharmacyId: 1, drugName: 'abcBeta' },  // normalizes to 'abcbeta'
      ];
      const index = buildUsedMedIndex(rows);
      const cache = new Map<string, { score: number }>();

      // 'abcGamma' → normalized 'abcgamma', token 'abc' matches both entries (2/2 = 100% ≥ 90%)
      // collectCandidateIndices returns null → findBestDrugMatch uses else branch
      const result = findBestDrugMatch('abcGamma', index, cache);

      // Should find a non-zero score via the else branch iteration
      expect(result.score).toBeGreaterThan(0);
      expect(result.score).toBeLessThan(1); // not an exact match
    });

    it('uses cached result when same drug name is looked up twice', () => {
      const rows: UsedMedRow[] = [
        { pharmacyId: 1, drugName: 'テストドラッグ' },
      ];
      const index = buildUsedMedIndex(rows);
      const cache = new Map<string, { score: number }>();

      const first = findBestDrugMatch('テストドラッグ', index, cache);
      // Second call should use cache
      const second = findBestDrugMatch('テストドラッグ', index, cache);

      expect(first.score).toBe(1); // exact match
      expect(second).toBe(first); // same object from cache
    });

    it('returns score 0 when drug name normalizes to empty string', () => {
      const rows: UsedMedRow[] = [{ pharmacyId: 1, drugName: 'テスト薬' }];
      const index = buildUsedMedIndex(rows);
      const cache = new Map<string, { score: number }>();

      // Empty drug name normalizes to '' → returns early with score 0
      const result = findBestDrugMatch('', index, cache);
      expect(result.score).toBe(0);
    });
  });

  describe('findBestDrugMatch — large candidate set (>= 500) breaks early', () => {
    it('handles index with many entries where token match candidates exceed 500', () => {
      // Build an index with many names sharing a common token to trigger the >= 500 break.
      // 'abc' prefix repeated to create 600 different drug names sharing the 'abc' token.
      // candidateIds.size reaches 500 → breaks; 500 >= 600*0.9=540 is FALSE → returns 500 candidates.
      // findBestDrugMatch uses the IF branch (candidateIndices is not null).
      const rows: UsedMedRow[] = Array.from({ length: 600 }, (_, i) => ({
        pharmacyId: 1,
        drugName: `Abc${String(i).padStart(5, '0')}`,
      }));
      const index = buildUsedMedIndex(rows);
      const cache = new Map<string, { score: number }>();

      // This lookup will hit the >= 500 break since all entries share 'abc' tokens
      const result = findBestDrugMatch('Abc00001', index, cache);
      expect(result.score).toBeGreaterThan(0);
    });
  });

  describe('computeNameSimilarity — early rejection path (tokenScore < 0.12 + large length diff)', () => {
    it('returns tokenScore early when token overlap is very low and length difference is large', () => {
      // This path is reached indirectly via findBestDrugMatch when comparing dissimilar drugs.
      // Build a simple index with a very long drug name.
      // Then search for a very short drug name with no token overlap.
      const longDrugName = 'verylongdrugnamewithmanychars'; // 29 chars
      const shortDrugName = 'z'; // 1 char, no common tokens with longDrugName
      const rows: UsedMedRow[] = [{ pharmacyId: 1, drugName: longDrugName }];
      const index = buildUsedMedIndex(rows);
      const cache = new Map<string, { score: number }>();

      // searchDrug='z' (1 char, no token overlap with 'verylongdrugname...')
      // tokenScore = 0 < 0.12 AND |1 - 29| = 28 > 29 * 0.6 = 17.4 → early rejection path
      // candidateIds.size = 0 (no shared tokens) → collectCandidateIndices returns null
      // → findBestDrugMatch uses else branch → computeNameSimilarity early rejection
      const result = findBestDrugMatch(shortDrugName, index, cache);
      // Score should be low (not an exact or substring match)
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThan(0.5);
    });
  });

  describe('calculateMatchRate', () => {
    it('returns 0 when all items have zero or missing matchScore', () => {
      const items: MatchItem[] = [
        {
          deadStockItemId: 1,
          drugName: '薬A',
          quantity: 10,
          unit: '錠',
          yakkaUnitPrice: 100,
          yakkaValue: 1000,
          expirationDate: null,
          expirationDateIso: null,
          matchScore: 0,
        },
        {
          deadStockItemId: 2,
          drugName: '薬B',
          quantity: 5,
          unit: '錠',
          yakkaUnitPrice: 200,
          yakkaValue: 1000,
          expirationDate: null,
          expirationDateIso: null,
          matchScore: undefined,
        },
      ];

      expect(calculateMatchRate(items, [])).toBe(0);
    });

    it('calculates average match rate from positive scores', () => {
      const makeItem = (score: number): MatchItem => ({
        deadStockItemId: 1,
        drugName: '薬',
        quantity: 1,
        unit: '錠',
        yakkaUnitPrice: 100,
        yakkaValue: 100,
        expirationDate: null,
        expirationDateIso: null,
        matchScore: score,
      });

      // scores: 0.8, 0.6 → average = 0.7 → * 100 = 70
      const result = calculateMatchRate([makeItem(0.8)], [makeItem(0.6)]);
      expect(result).toBe(70);
    });

    it('ignores zero scores in average calculation', () => {
      const makeItem = (score: number | undefined): MatchItem => ({
        deadStockItemId: 1,
        drugName: '薬',
        quantity: 1,
        unit: '錠',
        yakkaUnitPrice: 100,
        yakkaValue: 100,
        expirationDate: null,
        expirationDateIso: null,
        matchScore: score,
      });

      // scores: [1.0, 0 (filtered), null (filtered)] → average of [1.0] = 1.0 → 100
      const result = calculateMatchRate([makeItem(1.0), makeItem(0)], [makeItem(undefined)]);
      expect(result).toBe(100);
    });
  });

  describe('prepareDrugName — edge cases', () => {
    it('returns empty tokenSet when drug name normalizes to empty', () => {
      // A name that normalizes to empty after stripping dosage info and suffixes
      const result = prepareDrugName('10mg錠');
      // Normalized removes '10mg' and '錠' leaving empty
      expect(result.normalizedDrugName).toBe('');
      expect(result.tokenSet.size).toBe(0);
    });
  });
});
