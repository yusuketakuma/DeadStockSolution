import {
  MatchBusinessImpact,
  MatchCandidate,
  MatchItem,
  MatchPriorityBreakdown,
  MatchPriorityReason,
} from '../types';
import { parseExpiryDate, roundTo2, toStartOfDay } from './matching-score-service';

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_STAGNANT_STOCK_DAYS = 90;

export type DeadStockDisposalPriority = MatchPriorityBreakdown;

function toFiniteNumber(value: number | null | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function countAndSumNearExpiry(
  items: MatchItem[],
  nearExpiryDays: number,
  now: Date,
): { count: number; valueSum: number } {
  const thresholdDays = Math.max(1, Math.floor(nearExpiryDays));
  const todayMs = toStartOfDay(now).getTime();
  let count = 0;
  let valueSum = 0;

  for (const item of items) {
    const expirySource = item.expirationDateIso ?? item.expirationDate;
    const expiry = parseExpiryDate(expirySource);
    if (!expiry) continue;
    const expiryDayMs = toStartOfDay(expiry).getTime();
    const diffDays = Math.floor((expiryDayMs - todayMs) / DAY_MS);
    if (diffDays >= 0 && diffDays <= thresholdDays) {
      count += 1;
      valueSum += toFiniteNumber(item.yakkaValue);
    }
  }

  return { count, valueSum: roundTo2(valueSum) };
}

export function countStagnantItems(
  items: MatchItem[],
  now: Date,
  stagnantDays: number = DEFAULT_STAGNANT_STOCK_DAYS,
): number {
  const thresholdDays = Math.max(1, Math.floor(stagnantDays));
  const nowMs = now.getTime();
  let count = 0;

  for (const item of items) {
    const createdAt = parseIsoDate(item.stockCreatedAt);
    if (!createdAt) continue;
    const ageDays = Math.floor((nowMs - createdAt.getTime()) / DAY_MS);
    if (ageDays >= thresholdDays) count += 1;
  }

  return count;
}

export function countTraceableItems(items: MatchItem[]): number {
  let count = 0;
  for (const item of items) {
    if (item.expirationDateIso || item.expirationDate || item.lotNumber) {
      count += 1;
    }
  }
  return count;
}

interface NearExpiryStats {
  countA: number;
  countB: number;
  valueSumA: number;
  valueSumB: number;
}

export function buildDeadStockDisposalPriority(
  candidate: Pick<MatchCandidate, 'itemsFromA' | 'itemsFromB' | 'totalValueA' | 'totalValueB'>,
  nearExpiryDays: number,
  now: Date,
  nearExpiryOut?: NearExpiryStats,
): DeadStockDisposalPriority {
  const stagnantA = countStagnantItems(candidate.itemsFromA, now);
  const stagnantB = countStagnantItems(candidate.itemsFromB, now);
  const nearA = countAndSumNearExpiry(candidate.itemsFromA, nearExpiryDays, now);
  const nearB = countAndSumNearExpiry(candidate.itemsFromB, nearExpiryDays, now);
  const traceableA = countTraceableItems(candidate.itemsFromA);
  const traceableB = countTraceableItems(candidate.itemsFromB);

  if (nearExpiryOut) {
    nearExpiryOut.countA = nearA.count;
    nearExpiryOut.countB = nearB.count;
    nearExpiryOut.valueSumA = nearA.valueSum;
    nearExpiryOut.valueSumB = nearB.valueSum;
  }

  return {
    mutualStagnantItems: Math.min(stagnantA, stagnantB),
    mutualNearExpiryItems: Math.min(nearA.count, nearB.count),
    mutualExchangeValue: Math.min(
      toFiniteNumber(candidate.totalValueA),
      toFiniteNumber(candidate.totalValueB),
    ),
    mutualItemCount: Math.min(candidate.itemsFromA.length, candidate.itemsFromB.length),
    mutualTraceableItems: Math.min(traceableA, traceableB),
  };
}

export function buildBusinessImpact(
  candidate: Pick<MatchCandidate, 'itemsFromA' | 'itemsFromB' | 'totalValueA' | 'totalValueB'>,
  priority: DeadStockDisposalPriority,
  nearExpiryStats: NearExpiryStats,
): MatchBusinessImpact {
  return {
    estimatedWasteAvoidanceYen: roundTo2(Math.min(nearExpiryStats.valueSumA, nearExpiryStats.valueSumB)),
    estimatedWorkingCapitalReleaseYen: roundTo2(priority.mutualExchangeValue),
    estimatedMutualLiquidationItems: priority.mutualStagnantItems,
    estimatedMutualNearExpiryItems: priority.mutualNearExpiryItems,
    estimatedTraceableExchangeItems: priority.mutualTraceableItems,
  };
}

export function buildPriorityReasons(
  priority: DeadStockDisposalPriority,
): MatchPriorityReason[] {
  const reasons: MatchPriorityReason[] = [
    {
      code: 'mutual_stagnant',
      label: '相互不動在庫の解消効果',
      value: priority.mutualStagnantItems,
    },
    {
      code: 'mutual_near_expiry',
      label: '期限切迫在庫の相互救済',
      value: priority.mutualNearExpiryItems,
    },
    {
      code: 'mutual_exchange_value',
      label: '相互交換金額の規模',
      value: roundTo2(priority.mutualExchangeValue),
    },
    {
      code: 'mutual_item_count',
      label: '相互引取品目数',
      value: priority.mutualItemCount,
    },
    {
      code: 'mutual_traceability',
      label: 'トレーサブル在庫の相互引取',
      value: priority.mutualTraceableItems,
    },
  ];
  return reasons.filter((reason) => reason.value > 0).slice(0, 3);
}

function compareNumberDesc(a: number, b: number): number {
  return b - a;
}

function compareNumberAsc(a: number, b: number): number {
  return a - b;
}

export function sortMatchCandidatesByPriority(
  candidates: MatchCandidate[],
  nearExpiryDays: number,
  now: Date,
): MatchCandidate[] {
  return [...candidates]
    .map((candidate) => {
      const nearExpiryStats: NearExpiryStats = { countA: 0, countB: 0, valueSumA: 0, valueSumB: 0 };
      const priorityBreakdown = buildDeadStockDisposalPriority(candidate, nearExpiryDays, now, nearExpiryStats);
      const businessImpact = buildBusinessImpact(candidate, priorityBreakdown, nearExpiryStats);
      const priorityReasons = buildPriorityReasons(priorityBreakdown);
      return {
        candidate: {
          ...candidate,
          priorityBreakdown,
          businessImpact,
          priorityReasons,
        },
        priority: priorityBreakdown,
      };
    })
    // Prioritize bidirectional dead-stock liquidation first, then legacy matching quality.
    .sort((a, b) => (
      compareNumberDesc(a.priority.mutualStagnantItems, b.priority.mutualStagnantItems)
      || compareNumberDesc(a.priority.mutualNearExpiryItems, b.priority.mutualNearExpiryItems)
      || compareNumberDesc(a.priority.mutualExchangeValue, b.priority.mutualExchangeValue)
      || compareNumberDesc(a.priority.mutualItemCount, b.priority.mutualItemCount)
      || compareNumberDesc(a.priority.mutualTraceableItems, b.priority.mutualTraceableItems)
      || compareNumberDesc(toFiniteNumber(a.candidate.score), toFiniteNumber(b.candidate.score))
      || compareNumberAsc(
        Number.isFinite(a.candidate.distance) ? a.candidate.distance : Number.MAX_SAFE_INTEGER,
        Number.isFinite(b.candidate.distance) ? b.candidate.distance : Number.MAX_SAFE_INTEGER,
      )
      || compareNumberAsc(a.candidate.pharmacyId, b.candidate.pharmacyId)
    ))
    .map((entry) => entry.candidate);
}
