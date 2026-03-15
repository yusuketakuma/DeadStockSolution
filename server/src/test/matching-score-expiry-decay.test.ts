import { describe, expect, it } from 'vitest';
import {
  calculateCandidateScore,
  DEFAULT_MATCHING_SCORING_RULES,
  getNearExpiryCount,
} from '../services/matching-score-service';
import type { MatchingScoringRules } from '../types/matching';
import { MatchItem } from '../types';

function createItemWithExpiry(daysFromNow: number, referenceDate: Date = new Date()): MatchItem {
  const expiry = new Date(referenceDate);
  expiry.setDate(expiry.getDate() + daysFromNow);
  // Use YYYY-MM-DD format compatible with parseExpiryDate
  // (toISOString adds T/Z suffix which the normalizer breaks)
  const yyyy = expiry.getFullYear();
  const mm = String(expiry.getMonth() + 1).padStart(2, '0');
  const dd = String(expiry.getDate()).padStart(2, '0');
  return {
    deadStockItemId: 1,
    drugName: 'テスト薬品',
    quantity: 10,
    unit: '錠',
    yakkaUnitPrice: 100,
    yakkaValue: 1000,
    expirationDate: `${yyyy}-${mm}-${dd}`,
    matchScore: 0.8,
  };
}

describe('Exponential decay for near-expiry score', () => {
  const referenceDate = new Date('2026-03-01T00:00:00Z');

  describe('nearExpiryDecayCurve = 0 (linear, backward compatible)', () => {
    it('nearExpiryDecayCurve=0 は従来の線形計算と同じ結果を返す', () => {
      const linearRules: MatchingScoringRules = {
        ...DEFAULT_MATCHING_SCORING_RULES,
        nearExpiryDecayCurve: 0,
      };
      const itemsA = [createItemWithExpiry(30, referenceDate)];
      const itemsB = [createItemWithExpiry(60, referenceDate)];

      const scoreWithDefault = calculateCandidateScore(
        1000, 1000, 0, 5, itemsA, itemsB,
        DEFAULT_MATCHING_SCORING_RULES, false, false, referenceDate,
      );
      const scoreWithLinear = calculateCandidateScore(
        1000, 1000, 0, 5, itemsA, itemsB,
        linearRules, false, false, referenceDate,
      );

      expect(scoreWithLinear).toBe(scoreWithDefault);
    });
  });

  describe('nearExpiryDecayCurve > 0 (exponential decay)', () => {
    it('期限30日以内の在庫が指数カーブで高スコアになる', () => {
      const linearRules: MatchingScoringRules = {
        ...DEFAULT_MATCHING_SCORING_RULES,
        nearExpiryDecayCurve: 0,
      };
      const exponentialRules: MatchingScoringRules = {
        ...DEFAULT_MATCHING_SCORING_RULES,
        nearExpiryDecayCurve: 2,
      };
      const itemsA = [createItemWithExpiry(10, referenceDate)];
      const itemsB = [createItemWithExpiry(10, referenceDate)];

      const linearScore = calculateCandidateScore(
        1000, 1000, 0, 5, itemsA, itemsB,
        linearRules, false, false, referenceDate,
      );
      const expScore = calculateCandidateScore(
        1000, 1000, 0, 5, itemsA, itemsB,
        exponentialRules, false, false, referenceDate,
      );

      // With exponential decay, very near-expiry items should score higher
      expect(expScore).toBeGreaterThan(linearScore);
    });

    it('期限が遠い場合は指数カーブでも低スコア', () => {
      const exponentialRules: MatchingScoringRules = {
        ...DEFAULT_MATCHING_SCORING_RULES,
        nearExpiryDecayCurve: 2,
      };
      const itemsNear = [createItemWithExpiry(5, referenceDate)];
      const itemsFar = [createItemWithExpiry(100, referenceDate)];

      const nearScore = calculateCandidateScore(
        1000, 1000, 0, 5, itemsNear, itemsNear,
        exponentialRules, false, false, referenceDate,
      );
      const farScore = calculateCandidateScore(
        1000, 1000, 0, 5, itemsFar, itemsFar,
        exponentialRules, false, false, referenceDate,
      );

      expect(nearScore).toBeGreaterThan(farScore);
    });

    it('カーブ値が大きいほど近期限の優先度が上がる', () => {
      const itemsA = [createItemWithExpiry(15, referenceDate)];
      const itemsB = [createItemWithExpiry(15, referenceDate)];

      const scoreCurve1 = calculateCandidateScore(
        1000, 1000, 0, 5, itemsA, itemsB,
        { ...DEFAULT_MATCHING_SCORING_RULES, nearExpiryDecayCurve: 1 },
        false, false, referenceDate,
      );
      const scoreCurve5 = calculateCandidateScore(
        1000, 1000, 0, 5, itemsA, itemsB,
        { ...DEFAULT_MATCHING_SCORING_RULES, nearExpiryDecayCurve: 5 },
        false, false, referenceDate,
      );

      expect(scoreCurve5).toBeGreaterThanOrEqual(scoreCurve1);
    });

    it('nearExpiryScoreMaxを超えない', () => {
      const rules: MatchingScoringRules = {
        ...DEFAULT_MATCHING_SCORING_RULES,
        nearExpiryScoreMax: 10,
        nearExpiryDecayCurve: 10,
      };
      // 大量の期限間近アイテム
      const items = Array.from({ length: 20 }, () => createItemWithExpiry(1, referenceDate));

      // 同じitemsでdiversityを揃えて比較（curve=0 vs curve=10）
      const scoreLinear = calculateCandidateScore(
        1000, 1000, 0, 5, items, items,
        { ...rules, nearExpiryDecayCurve: 0 }, false, false, referenceDate,
      );
      const scoreExp = calculateCandidateScore(
        1000, 1000, 0, 5, items, items,
        rules, false, false, referenceDate,
      );

      // nearExpiryは両方ともnearExpiryScoreMax(10)でキャップされる
      // diversityや他のスコアが同一なので、差が小さいことを確認
      // 線形で40items*1.5=60→cap10, 指数でもcap10なので同一
      expect(Math.abs(scoreExp - scoreLinear)).toBeLessThanOrEqual(0.01);
    });
  });
});
