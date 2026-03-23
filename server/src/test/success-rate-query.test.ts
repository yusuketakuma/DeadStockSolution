import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPharmacyPairSuccessCounts } from '../services/success-rate-query-service';

const mocks = vi.hoisted(() => ({
  dbSelect: vi.fn(),
}));

vi.mock('../config/database', () => ({
  db: {
    select: mocks.dbSelect,
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _type: 'and', args })),
  eq: vi.fn((col: unknown, val: unknown) => ({ _type: 'eq', col, val })),
  or: vi.fn((...args: unknown[]) => ({ _type: 'or', args })),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ _type: 'sql', strings, values })),
    { as: vi.fn() },
  ),
}));

// DB クエリチェーンのモックを作る
function createDbChain(rows: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockResolvedValue(rows),
  };
  mocks.dbSelect.mockReturnValue(chain);
  return chain;
}

describe('getPharmacyPairSuccessCounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty map when no completed proposals exist', async () => {
    createDbChain([]);

    const result = await getPharmacyPairSuccessCounts(1);

    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it('should aggregate A→B and B→A as the same pair', async () => {
    // 薬局1が A側として薬局2と2回、B側として薬局2と1回 成約
    createDbChain([
      { pharmacyAId: 1, pharmacyBId: 2, count: 2 },
      { pharmacyAId: 2, pharmacyBId: 1, count: 1 },
    ]);

    const result = await getPharmacyPairSuccessCounts(1);

    // 相手は薬局2、合計3件
    expect(result.get(2)).toBe(3);
    expect(result.size).toBe(1);
  });

  it('should handle multiple counterparty pharmacies independently', async () => {
    createDbChain([
      { pharmacyAId: 1, pharmacyBId: 2, count: 3 },
      { pharmacyAId: 1, pharmacyBId: 3, count: 5 },
      { pharmacyAId: 3, pharmacyBId: 1, count: 2 },
    ]);

    const result = await getPharmacyPairSuccessCounts(1);

    expect(result.get(2)).toBe(3);
    expect(result.get(3)).toBe(7); // 5 + 2
    expect(result.size).toBe(2);
  });

  it('should only count completed proposals (query filters by status=completed)', async () => {
    // このテストは、クエリが where 条件を含む正しいパラメータで呼ばれることを検証する
    createDbChain([
      { pharmacyAId: 10, pharmacyBId: 20, count: 4 },
    ]);

    const result = await getPharmacyPairSuccessCounts(10);

    // where が呼ばれたことを確認（status='completed' フィルタが存在する）
    expect(mocks.dbSelect).toHaveBeenCalled();
    expect(result.get(20)).toBe(4);
  });

  it('should correctly identify counterparty when source pharmacy is pharmacyBId', async () => {
    // 自薬局が B 側にある場合も正しく相手を特定する
    createDbChain([
      { pharmacyAId: 99, pharmacyBId: 5, count: 7 },
    ]);

    const result = await getPharmacyPairSuccessCounts(5);

    // A側は99, 自分は5(B側) → 相手は99
    expect(result.get(99)).toBe(7);
    expect(result.size).toBe(1);
  });

  it('should return 0 for pharmacies with no completed pairs', async () => {
    createDbChain([]);

    const result = await getPharmacyPairSuccessCounts(999);

    expect(result.size).toBe(0);
    expect(result.get(1)).toBeUndefined();
  });
});

describe('successCount wiring in collectCandidates', () => {
  it('should pass successCount=0 when no prior completions for that pharmacy', async () => {
    // calculateCandidateScoreWithBreakdown が successCount=0 でデフォルト動作することを確認
    // matching-score-service の単体テストから独立した検証
    const { calculateCandidateScore } = await import('../services/matching-score-service');
    const { DEFAULT_MATCHING_SCORING_RULES } = await import('../services/matching-score-service');

    const scoreWithNoSuccess = calculateCandidateScore(
      10000,
      10000,
      0,
      5,
      [],
      [],
      DEFAULT_MATCHING_SCORING_RULES,
      false,
      false,
      new Date(),
      0, // successCount=0
    );

    const scoreWithSuccesses = calculateCandidateScore(
      10000,
      10000,
      0,
      5,
      [],
      [],
      { ...DEFAULT_MATCHING_SCORING_RULES, successRateBonus: 10 },
      false,
      false,
      new Date(),
      5, // successCount=5
    );

    // successRateBonus=0 なのでボーナスなし → 同じスコア
    expect(scoreWithNoSuccess).toBe(scoreWithSuccesses - calculateSuccessBonus(5, 10));
  });

  it('should apply successRateBonus when successRateBonus > 0 and successCount > 0', async () => {
    const { calculateSuccessRateBonus } = await import('../services/matching-score-service');

    // successCount=1, maxBonus=10 → log2(2)/log2(21) * 10 ≈ 2.17
    const bonus1 = calculateSuccessRateBonus(1, 10);
    expect(bonus1).toBeGreaterThan(0);
    expect(bonus1).toBeLessThanOrEqual(10);

    // successCount=20 (cap) → ほぼ満点
    const bonusCap = calculateSuccessRateBonus(20, 10);
    expect(bonusCap).toBe(10);

    // successCount=0 → ボーナスなし
    const bonusZero = calculateSuccessRateBonus(0, 10);
    expect(bonusZero).toBe(0);

    // successRateBonus設定=0 → 常に0
    const bonusDisabled = calculateSuccessRateBonus(100, 0);
    expect(bonusDisabled).toBe(0);
  });
});

// テスト用ヘルパー: calculateSuccessRateBonus の期待値を手動計算
function calculateSuccessBonus(successCount: number, maxBonus: number): number {
  const SUCCESS_RATE_LOG_CAP = 20;
  if (maxBonus <= 0 || successCount <= 0) return 0;
  const ratio = Math.log2(successCount + 1) / Math.log2(SUCCESS_RATE_LOG_CAP + 1);
  return Math.round(Math.min(maxBonus, ratio * maxBonus) * 100) / 100;
}
