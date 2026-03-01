import { describe, expect, it, vi } from 'vitest';
import type { MatchCandidate, MatchItem } from '../types';
import {
  buildBusinessImpact,
  buildDeadStockDisposalPriority,
  buildPriorityReasons,
  countStagnantItems,
  sortMatchCandidatesByPriority,
} from '../services/matching-priority-service';

function createItem(overrides: Partial<MatchItem> = {}): MatchItem {
  return {
    deadStockItemId: overrides.deadStockItemId ?? 1,
    drugName: overrides.drugName ?? '薬A',
    quantity: overrides.quantity ?? 1,
    unit: overrides.unit ?? '錠',
    yakkaUnitPrice: overrides.yakkaUnitPrice ?? 100,
    yakkaValue: overrides.yakkaValue ?? 100,
    expirationDate: overrides.expirationDate ?? null,
    expirationDateIso: overrides.expirationDateIso ?? null,
    lotNumber: overrides.lotNumber ?? null,
    stockCreatedAt: overrides.stockCreatedAt ?? null,
    matchScore: overrides.matchScore ?? 0.9,
  };
}

function createCandidate(overrides: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    pharmacyId: overrides.pharmacyId ?? 2,
    pharmacyName: overrides.pharmacyName ?? '候補薬局',
    distance: overrides.distance ?? 5,
    itemsFromA: overrides.itemsFromA ?? [createItem()],
    itemsFromB: overrides.itemsFromB ?? [createItem({ deadStockItemId: 2 })],
    totalValueA: overrides.totalValueA ?? 10000,
    totalValueB: overrides.totalValueB ?? 10000,
    valueDifference: overrides.valueDifference ?? 0,
    score: overrides.score ?? 50,
    matchRate: overrides.matchRate ?? 90,
    pharmacyPhone: overrides.pharmacyPhone,
    pharmacyFax: overrides.pharmacyFax,
    businessStatus: overrides.businessStatus,
    isFavorite: overrides.isFavorite,
  };
}

describe('matching-priority-service', () => {
  it('counts stagnant items by stockCreatedAt age', () => {
    const now = new Date('2026-03-01T00:00:00.000Z');
    const items = [
      createItem({ stockCreatedAt: '2025-10-01T00:00:00.000Z' }),
      createItem({ stockCreatedAt: '2026-02-20T00:00:00.000Z' }),
      createItem({ stockCreatedAt: 'invalid' }),
      createItem({ stockCreatedAt: null }),
    ];

    expect(countStagnantItems(items, now, 90)).toBe(1);
  });

  it('prioritizes mutual stagnant-stock liquidation over higher legacy score', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'));

    const staleCandidate = createCandidate({
      pharmacyId: 10,
      score: 30,
      itemsFromA: [createItem({ stockCreatedAt: '2025-10-01T00:00:00.000Z' })],
      itemsFromB: [createItem({ deadStockItemId: 20, stockCreatedAt: '2025-10-15T00:00:00.000Z' })],
    });
    const highScoreCandidate = createCandidate({
      pharmacyId: 11,
      score: 95,
      itemsFromA: [createItem({ stockCreatedAt: '2026-02-20T00:00:00.000Z' })],
      itemsFromB: [createItem({ deadStockItemId: 21, stockCreatedAt: '2026-02-20T00:00:00.000Z' })],
    });

    const sorted = sortMatchCandidatesByPriority(
      [highScoreCandidate, staleCandidate],
      120,
      new Date(),
    );

    expect(sorted.map((candidate) => candidate.pharmacyId)).toEqual([10, 11]);
    vi.useRealTimers();
  });

  it('prioritizes candidates with mutual near-expiry exchanges when stagnant counts tie', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'));

    const nearExpiryCandidate = createCandidate({
      pharmacyId: 21,
      score: 20,
      itemsFromA: [createItem({ expirationDate: '2026-03-10' })],
      itemsFromB: [createItem({ deadStockItemId: 31, expirationDate: '2026-03-12' })],
    });
    const nonNearExpiryCandidate = createCandidate({
      pharmacyId: 22,
      score: 99,
      itemsFromA: [createItem({ expirationDate: '2026-12-31' })],
      itemsFromB: [createItem({ deadStockItemId: 32, expirationDate: '2026-12-31' })],
    });

    const sorted = sortMatchCandidatesByPriority(
      [nonNearExpiryCandidate, nearExpiryCandidate],
      30,
      new Date(),
    );

    expect(sorted.map((candidate) => candidate.pharmacyId)).toEqual([21, 22]);
    vi.useRealTimers();
  });

  it('attaches priority breakdown, business impact and reasons to sorted candidates', () => {
    const now = new Date('2026-03-01T00:00:00.000Z');
    const candidate = createCandidate({
      pharmacyId: 40,
      totalValueA: 25000,
      totalValueB: 22000,
      itemsFromA: [
        createItem({
          stockCreatedAt: '2025-10-01T00:00:00.000Z',
          expirationDateIso: '2026-03-15',
          yakkaValue: 12000,
        }),
      ],
      itemsFromB: [
        createItem({
          deadStockItemId: 41,
          stockCreatedAt: '2025-10-05T00:00:00.000Z',
          expirationDateIso: '2026-03-14',
          yakkaValue: 13000,
        }),
      ],
    });

    const [enriched] = sortMatchCandidatesByPriority([candidate], 30, now);
    expect(enriched.priorityBreakdown).toEqual({
      mutualStagnantItems: 1,
      mutualNearExpiryItems: 1,
      mutualExchangeValue: 22000,
      mutualItemCount: 1,
      mutualTraceableItems: 1,
    });
    expect(enriched.businessImpact).toEqual({
      estimatedWasteAvoidanceYen: 12000,
      estimatedWorkingCapitalReleaseYen: 22000,
      estimatedMutualLiquidationItems: 1,
      estimatedMutualNearExpiryItems: 1,
      estimatedTraceableExchangeItems: 1,
    });
    expect(enriched.priorityReasons).toEqual([
      { code: 'mutual_stagnant', label: '相互不動在庫の解消効果', value: 1 },
      { code: 'mutual_near_expiry', label: '期限切迫在庫の相互救済', value: 1 },
      { code: 'mutual_exchange_value', label: '相互交換金額の規模', value: 22000 },
    ]);
  });

  it('builds business impact and reasons from disposal priority', () => {
    const now = new Date('2026-03-01T00:00:00.000Z');
    const candidate = createCandidate({
      totalValueA: 5000,
      totalValueB: 8000,
      itemsFromA: [createItem({ expirationDateIso: '2026-04-01', yakkaValue: 3000 })],
      itemsFromB: [createItem({ deadStockItemId: 8, expirationDateIso: '2026-03-20', yakkaValue: 2000 })],
    });

    const nearExpiryStats = { countA: 0, countB: 0, valueSumA: 0, valueSumB: 0 };
    const priority = buildDeadStockDisposalPriority(candidate, 60, now, nearExpiryStats);
    const impact = buildBusinessImpact(candidate, priority, nearExpiryStats);
    const reasons = buildPriorityReasons(priority);

    expect(priority.mutualExchangeValue).toBe(5000);
    expect(impact.estimatedWasteAvoidanceYen).toBe(2000);
    expect(reasons[0]?.code).toBe('mutual_near_expiry');
  });

  it('uses the same expiry parser for near-expiry count and waste-avoidance value', () => {
    const now = new Date('2026-03-01T00:00:00.000Z');
    const candidate = createCandidate({
      totalValueA: 7000,
      totalValueB: 7000,
      itemsFromA: [createItem({ expirationDate: '2026年03月20日', yakkaValue: 3000 })],
      itemsFromB: [createItem({ deadStockItemId: 12, expirationDate: '2026年03月18日', yakkaValue: 2000 })],
    });

    const nearExpiryStats = { countA: 0, countB: 0, valueSumA: 0, valueSumB: 0 };
    const priority = buildDeadStockDisposalPriority(candidate, 30, now, nearExpiryStats);
    const impact = buildBusinessImpact(candidate, priority, nearExpiryStats);

    expect(priority.mutualNearExpiryItems).toBe(1);
    expect(impact.estimatedWasteAvoidanceYen).toBe(2000);
  });
});
