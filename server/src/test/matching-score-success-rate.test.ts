import { describe, expect, it } from 'vitest';
import {
  calculateSuccessRateBonus,
} from '../services/matching-score-service';

describe('Exchange success rate bonus', () => {
  describe('calculateSuccessRateBonus', () => {
    it('成功率ボーナス上限が0の場合0を返す', () => {
      expect(calculateSuccessRateBonus(5, 0)).toBe(0);
    });

    it('過去の成功回数が0の場合0を返す', () => {
      expect(calculateSuccessRateBonus(0, 10)).toBe(0);
    });

    it('成功回数に応じてボーナスが増加する', () => {
      const bonus1 = calculateSuccessRateBonus(1, 20);
      const bonus5 = calculateSuccessRateBonus(5, 20);
      const bonus10 = calculateSuccessRateBonus(10, 20);

      expect(bonus1).toBeGreaterThan(0);
      expect(bonus5).toBeGreaterThan(bonus1);
      expect(bonus10).toBeGreaterThan(bonus5);
    });

    it('ボーナスがsuccessRateBonusMaxを超えない', () => {
      const bonus = calculateSuccessRateBonus(100, 10);
      expect(bonus).toBeLessThanOrEqual(10);
    });

    it('負の成功回数は0として扱う', () => {
      expect(calculateSuccessRateBonus(-5, 10)).toBe(0);
    });

    it('典型的な値で正しく計算される', () => {
      // 3回成功、上限20: 対数スケールで適度なボーナス
      const bonus = calculateSuccessRateBonus(3, 20);
      expect(bonus).toBeGreaterThan(0);
      expect(bonus).toBeLessThanOrEqual(20);
    });
  });
});
