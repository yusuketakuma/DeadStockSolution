import { describe, expect, it } from 'vitest';
import {
  buildSnapshotHashInput,
  buildTopCandidateDigest,
  calculateSnapshotDiff,
  createCandidateHash,
  createSnapshotPayload,
} from '../services/matching-snapshot-service';
import { MatchCandidate } from '../types';

function candidate(pharmacyId: number, score: number, matchRate: number): MatchCandidate {
  return {
    pharmacyId,
    pharmacyName: `Pharmacy ${pharmacyId}`,
    distance: 1,
    itemsFromA: [
      {
        deadStockItemId: pharmacyId * 10 + 1,
        drugName: 'A',
        quantity: 1,
        unit: 'box',
        yakkaUnitPrice: 100,
        yakkaValue: 100,
      },
    ],
    itemsFromB: [
      {
        deadStockItemId: pharmacyId * 10 + 2,
        drugName: 'B',
        quantity: 1,
        unit: 'box',
        yakkaUnitPrice: 100,
        yakkaValue: 100,
      },
    ],
    totalValueA: 100,
    totalValueB: 100,
    valueDifference: 0,
    score,
    matchRate,
    priorityBreakdown: {
      mutualStagnantItems: 1,
      mutualNearExpiryItems: 2,
      mutualExchangeValue: 100,
      mutualItemCount: 1,
      mutualTraceableItems: 1,
    },
    businessImpact: {
      estimatedWasteAvoidanceYen: 80,
      estimatedWorkingCapitalReleaseYen: 100,
      estimatedMutualLiquidationItems: 1,
      estimatedMutualNearExpiryItems: 2,
      estimatedTraceableExchangeItems: 1,
    },
  };
}

describe('matching-snapshot-service', () => {
  it('creates rounded digest and stable hash', () => {
    const candidates = [
      candidate(2, 87.1299, 92.556),
      candidate(3, 55.554, 78.445),
    ];

    const digest = buildTopCandidateDigest(candidates);
    expect(digest).toEqual([
      {
        pharmacyId: 2,
        score: 87.13,
        matchRate: 92.56,
        valueDifference: 0,
        totalValueA: 100,
        totalValueB: 100,
        itemCountA: 1,
        itemCountB: 1,
        mutualStagnantItems: 1,
        mutualNearExpiryItems: 2,
        estimatedWasteAvoidanceYen: 80,
        estimatedWorkingCapitalReleaseYen: 100,
      },
      {
        pharmacyId: 3,
        score: 55.55,
        matchRate: 78.44,
        valueDifference: 0,
        totalValueA: 100,
        totalValueB: 100,
        itemCountA: 1,
        itemCountB: 1,
        mutualStagnantItems: 1,
        mutualNearExpiryItems: 2,
        estimatedWasteAvoidanceYen: 80,
        estimatedWorkingCapitalReleaseYen: 100,
      },
    ]);

    const hashInput = buildSnapshotHashInput(candidates);
    expect(createCandidateHash(hashInput)).toBe(createCandidateHash(hashInput));
  });

  it('produces snapshot payload and detects added/removed candidates', () => {
    const before = createSnapshotPayload([candidate(10, 90, 90), candidate(20, 88, 88)]);
    const after = createSnapshotPayload([candidate(20, 88, 88), candidate(30, 91, 91)]);

    const diff = calculateSnapshotDiff(before.topCandidates, after.topCandidates, before.candidateCount, after.candidateCount);
    expect(diff).toEqual({
      addedPharmacyIds: [30],
      removedPharmacyIds: [10],
      beforeCount: 2,
      afterCount: 2,
    });
  });

  it('keeps candidate hash stable when only derived business metrics change', () => {
    const base = candidate(10, 90, 90);
    const changedDerived: MatchCandidate = {
      ...base,
      priorityBreakdown: {
        ...base.priorityBreakdown!,
        mutualNearExpiryItems: 99,
      },
      businessImpact: {
        ...base.businessImpact!,
        estimatedWasteAvoidanceYen: 9999,
      },
    };

    const basePayload = createSnapshotPayload([base]);
    const changedPayload = createSnapshotPayload([changedDerived]);
    expect(changedPayload.hash).toBe(basePayload.hash);
  });

  it('changes candidate hash when candidate composition changes', () => {
    const base = candidate(11, 90, 90);
    const changed: MatchCandidate = {
      ...base,
      itemsFromA: [
        {
          ...base.itemsFromA[0]!,
          quantity: 2,
          yakkaValue: 200,
        },
      ],
      totalValueA: 200,
      valueDifference: 100,
    };

    const basePayload = createSnapshotPayload([base]);
    const changedPayload = createSnapshotPayload([changed]);
    expect(changedPayload.hash).not.toBe(basePayload.hash);
  });
});
