import { describe, expect, it } from 'vitest';
import {
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
      },
    ]);

    expect(createCandidateHash(digest)).toBe(createCandidateHash(digest));
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
});
