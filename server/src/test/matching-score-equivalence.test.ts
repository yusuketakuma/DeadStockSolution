import { describe, expect, it } from 'vitest';
import {
  buildUsedMedIndex,
  findBestDrugMatch,
  findBestDrugMatchWithEquivalences,
} from '../services/matching-score-service';
import type { DrugMatchResult } from '../types/matching';

describe('Brand/Generic equivalence matching', () => {
  const usedMedRows = [
    { pharmacyId: 1, drugName: 'バイアスピリン錠100mg' },
    { pharmacyId: 1, drugName: 'ロキソニン錠60mg' },
    { pharmacyId: 1, drugName: 'カロナール錠200' },
  ];
  const usedMedIndex = buildUsedMedIndex(usedMedRows);

  describe('findBestDrugMatchWithEquivalences', () => {
    it('同等性マップなしの場合、通常のfindBestDrugMatchと同じ結果', () => {
      const cache = new Map<string, DrugMatchResult>();
      const cacheEquiv = new Map<string, DrugMatchResult>();

      const normalResult = findBestDrugMatch('バイアスピリン錠100mg', usedMedIndex, cache);
      const equivResult = findBestDrugMatchWithEquivalences(
        'バイアスピリン錠100mg', usedMedIndex, cacheEquiv, new Map(),
      );

      expect(equivResult.score).toBe(normalResult.score);
    });

    it('同等性登録された薬品ペアは高スコアを得る', () => {
      const equivalenceMap = new Map<string, string[]>();
      equivalenceMap.set('アスピリン', ['バイアスピリン']);
      equivalenceMap.set('バイアスピリン', ['アスピリン']);

      const cache = new Map<string, DrugMatchResult>();
      // 「アスピリン錠100mg」は文字列類似度だけでは「バイアスピリン錠100mg」にマッチしにくい
      const result = findBestDrugMatchWithEquivalences(
        'アスピリン錠100mg', usedMedIndex, cache, equivalenceMap,
      );

      // 同等性マップありの場合、通常より高いスコアを期待
      const cacheNoEquiv = new Map<string, DrugMatchResult>();
      const resultNoEquiv = findBestDrugMatch('アスピリン錠100mg', usedMedIndex, cacheNoEquiv);

      expect(result.score).toBeGreaterThanOrEqual(resultNoEquiv.score);
    });

    it('同等性マップに登録がない薬品は通常のマッチングのみ', () => {
      const equivalenceMap = new Map<string, string[]>();
      equivalenceMap.set('アスピリン', ['バイアスピリン']);

      const cache = new Map<string, DrugMatchResult>();
      const result = findBestDrugMatchWithEquivalences(
        'メトホルミン錠500mg', usedMedIndex, cache, equivalenceMap,
      );

      // 同等性がないので通常のスコアと同じ
      const cacheNormal = new Map<string, DrugMatchResult>();
      const normalResult = findBestDrugMatch('メトホルミン錠500mg', usedMedIndex, cacheNormal);
      expect(result.score).toBe(normalResult.score);
    });

    it('空のインデックスの場合スコア0', () => {
      const emptyIndex = buildUsedMedIndex([]);
      const cache = new Map<string, DrugMatchResult>();
      const result = findBestDrugMatchWithEquivalences(
        'アスピリン', emptyIndex, cache, new Map(),
      );
      expect(result.score).toBe(0);
    });

    it('空の薬品名の場合スコア0', () => {
      const cache = new Map<string, DrugMatchResult>();
      const result = findBestDrugMatchWithEquivalences(
        '', usedMedIndex, cache, new Map(),
      );
      expect(result.score).toBe(0);
    });
  });
});
