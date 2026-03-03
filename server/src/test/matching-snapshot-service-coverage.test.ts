import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
  drizzle: {
    eq: vi.fn((a: unknown, b: unknown) => ({ _eq: [a, b] })),
    inArray: vi.fn((a: unknown, b: unknown) => ({ _inArray: [a, b] })),
    sql: vi.fn(() => ({})),
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('drizzle-orm', () => ({
  eq: mocks.drizzle.eq,
  inArray: mocks.drizzle.inArray,
  sql: mocks.drizzle.sql,
}));

import {
  buildTopCandidateDigest,
  buildSnapshotHashInput,
  calculateSnapshotDiff,
  createCandidateHash,
  createSnapshotPayload,
  saveMatchSnapshotAndNotifyOnChange,
  saveMatchSnapshotsBatch,
} from '../services/matching-snapshot-service';
import { MatchCandidate } from '../types';

function candidate(pharmacyId: number, overrides: Partial<MatchCandidate> = {}): MatchCandidate {
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
    score: 85,
    matchRate: 90,
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
    ...overrides,
  };
}

function createSelectLimitChain(result: unknown[]) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.limit.mockResolvedValue(result);
  return chain;
}

function createSelectWhereChain(result: unknown[]) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockResolvedValue(result);
  return chain;
}

function createUpdateChain() {
  const chain = {
    set: vi.fn(),
    where: vi.fn(),
  };
  chain.set.mockReturnValue(chain);
  chain.where.mockResolvedValue(undefined);
  return chain;
}

function createInsertOnConflictChain() {
  const chain = {
    values: vi.fn(),
    onConflictDoNothing: vi.fn(),
    onConflictDoUpdate: vi.fn(),
  };
  chain.values.mockReturnValue(chain);
  chain.onConflictDoNothing.mockResolvedValue(undefined);
  chain.onConflictDoUpdate.mockResolvedValue(undefined);
  return chain;
}

describe('matching-snapshot-service coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildTopCandidateDigest', () => {
    it('handles undefined priorityBreakdown and businessImpact', () => {
      const c = candidate(1, {
        priorityBreakdown: undefined,
        businessImpact: undefined,
      });
      const digest = buildTopCandidateDigest([c]);
      expect(digest[0].mutualStagnantItems).toBe(0);
      expect(digest[0].mutualNearExpiryItems).toBe(0);
      expect(digest[0].estimatedWasteAvoidanceYen).toBe(0);
      expect(digest[0].estimatedWorkingCapitalReleaseYen).toBe(0);
    });

    it('handles NaN score and matchRate', () => {
      const c = candidate(1, {
        score: NaN,
        matchRate: NaN,
      });
      const digest = buildTopCandidateDigest([c]);
      expect(digest[0].score).toBe(0);
      expect(digest[0].matchRate).toBe(0);
    });

    it('respects limit parameter', () => {
      const candidates = Array.from({ length: 20 }, (_, i) => candidate(i + 1));
      const digest = buildTopCandidateDigest(candidates, 5);
      expect(digest).toHaveLength(5);
    });

    it('returns empty array for empty candidates', () => {
      const digest = buildTopCandidateDigest([]);
      expect(digest).toHaveLength(0);
    });
  });

  describe('buildSnapshotHashInput', () => {
    it('sorts items by deadStockItemId', () => {
      const c = candidate(1, {
        itemsFromA: [
          { deadStockItemId: 20, drugName: 'A', quantity: 1, unit: 'box', yakkaUnitPrice: 100, yakkaValue: 100 },
          { deadStockItemId: 10, drugName: 'B', quantity: 2, unit: 'box', yakkaUnitPrice: 50, yakkaValue: 100 },
        ],
      });
      const input = buildSnapshotHashInput([c]);
      expect(input[0].itemsFromA[0].deadStockItemId).toBe(10);
      expect(input[0].itemsFromA[1].deadStockItemId).toBe(20);
    });

    it('rounds quantity to 3 decimal places', () => {
      const c = candidate(1, {
        itemsFromA: [
          { deadStockItemId: 1, drugName: 'A', quantity: 1.12345, unit: 'box', yakkaUnitPrice: 100, yakkaValue: 100 },
        ],
      });
      const input = buildSnapshotHashInput([c]);
      expect(input[0].itemsFromA[0].quantity).toBe(1.123);
    });

    it('respects limit parameter', () => {
      const candidates = Array.from({ length: 20 }, (_, i) => candidate(i + 1));
      const input = buildSnapshotHashInput(candidates, 3);
      expect(input).toHaveLength(3);
    });
  });

  describe('createCandidateHash', () => {
    it('produces a hex string', () => {
      const input = buildSnapshotHashInput([candidate(1)]);
      const hash = createCandidateHash(input);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces the same hash for the same input', () => {
      const input = buildSnapshotHashInput([candidate(1)]);
      expect(createCandidateHash(input)).toBe(createCandidateHash(input));
    });

    it('produces different hashes for different inputs', () => {
      const input1 = buildSnapshotHashInput([candidate(1)]);
      const input2 = buildSnapshotHashInput([candidate(2)]);
      expect(createCandidateHash(input1)).not.toBe(createCandidateHash(input2));
    });
  });

  describe('createSnapshotPayload', () => {
    it('creates payload with hash, count, and topCandidates', () => {
      const payload = createSnapshotPayload([candidate(1), candidate(2)]);
      expect(payload.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(payload.candidateCount).toBe(2);
      expect(payload.topCandidates).toHaveLength(2);
    });

    it('handles empty candidates', () => {
      const payload = createSnapshotPayload([]);
      expect(payload.candidateCount).toBe(0);
      expect(payload.topCandidates).toHaveLength(0);
    });
  });

  describe('calculateSnapshotDiff', () => {
    it('detects no changes when same candidates', () => {
      const before = buildTopCandidateDigest([candidate(1), candidate(2)]);
      const after = buildTopCandidateDigest([candidate(1), candidate(2)]);
      const diff = calculateSnapshotDiff(before, after, 2, 2);
      expect(diff.addedPharmacyIds).toEqual([]);
      expect(diff.removedPharmacyIds).toEqual([]);
    });

    it('detects fully new set', () => {
      const before = buildTopCandidateDigest([candidate(1)]);
      const after = buildTopCandidateDigest([candidate(2)]);
      const diff = calculateSnapshotDiff(before, after, 1, 1);
      expect(diff.addedPharmacyIds).toEqual([2]);
      expect(diff.removedPharmacyIds).toEqual([1]);
    });

    it('handles empty before', () => {
      const after = buildTopCandidateDigest([candidate(1)]);
      const diff = calculateSnapshotDiff([], after, 0, 1);
      expect(diff.addedPharmacyIds).toEqual([1]);
      expect(diff.removedPharmacyIds).toEqual([]);
      expect(diff.beforeCount).toBe(0);
      expect(diff.afterCount).toBe(1);
    });

    it('handles empty after', () => {
      const before = buildTopCandidateDigest([candidate(1)]);
      const diff = calculateSnapshotDiff(before, [], 1, 0);
      expect(diff.addedPharmacyIds).toEqual([]);
      expect(diff.removedPharmacyIds).toEqual([1]);
    });
  });

  describe('saveMatchSnapshotAndNotifyOnChange', () => {
    it('inserts new snapshot when no existing', async () => {
      mocks.db.select.mockImplementation(() => createSelectLimitChain([]));
      const insertChain = createInsertOnConflictChain();
      mocks.db.insert.mockReturnValue(insertChain);
      mocks.db.update.mockReturnValue(createUpdateChain());

      const result = await saveMatchSnapshotAndNotifyOnChange({
        pharmacyId: 1,
        triggerPharmacyId: 10,
        triggerUploadType: 'dead_stock',
        candidates: [candidate(2)],
        notifyEnabled: true,
      });

      expect(result.changed).toBe(true);
      expect(result.beforeCount).toBe(0);
      expect(result.afterCount).toBe(1);
      expect(mocks.db.insert).toHaveBeenCalled();
    });

    it('updates existing snapshot when hash changes', async () => {
      const existingSnapshot = {
        id: 1,
        candidateHash: 'old-hash',
        candidateCount: 0,
        topCandidatesJson: '[]',
      };
      mocks.db.select.mockImplementation(() => createSelectLimitChain([existingSnapshot]));
      mocks.db.update.mockReturnValue(createUpdateChain());
      const insertChain = createInsertOnConflictChain();
      mocks.db.insert.mockReturnValue(insertChain);

      const result = await saveMatchSnapshotAndNotifyOnChange({
        pharmacyId: 1,
        triggerPharmacyId: 10,
        triggerUploadType: 'dead_stock',
        candidates: [candidate(2)],
        notifyEnabled: true,
      });

      expect(result.changed).toBe(true);
      expect(mocks.db.update).toHaveBeenCalled();
    });

    it('skips notification when notifyEnabled is false', async () => {
      mocks.db.select.mockImplementation(() => createSelectLimitChain([]));
      const insertChain = createInsertOnConflictChain();
      mocks.db.insert.mockReturnValue(insertChain);
      mocks.db.update.mockReturnValue(createUpdateChain());

      await saveMatchSnapshotAndNotifyOnChange({
        pharmacyId: 1,
        triggerPharmacyId: 10,
        triggerUploadType: 'dead_stock',
        candidates: [candidate(2)],
        notifyEnabled: false,
      });

      // insert called once for snapshot, NOT for notifications
      expect(mocks.db.insert).toHaveBeenCalledTimes(1);
    });

    it('fetches pharmacy notify setting when notifyEnabled is undefined', async () => {
      let selectCallCount = 0;
      mocks.db.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          // Existing snapshot
          return createSelectLimitChain([]);
        }
        // Pharmacy notify setting
        return createSelectLimitChain([{ matchingAutoNotifyEnabled: false }]);
      });
      const insertChain = createInsertOnConflictChain();
      mocks.db.insert.mockReturnValue(insertChain);
      mocks.db.update.mockReturnValue(createUpdateChain());

      await saveMatchSnapshotAndNotifyOnChange({
        pharmacyId: 1,
        triggerPharmacyId: 10,
        triggerUploadType: 'dead_stock',
        candidates: [candidate(2)],
        // notifyEnabled is undefined
      });

      // Since matchingAutoNotifyEnabled is false, no notification insert
      expect(mocks.db.insert).toHaveBeenCalledTimes(1); // only snapshot insert
    });

    it('does not insert notification when snapshot unchanged', async () => {
      const candidates = [candidate(2)];
      const payload = createSnapshotPayload(candidates);
      const existingSnapshot = {
        id: 1,
        candidateHash: payload.hash,
        candidateCount: payload.candidateCount,
        topCandidatesJson: JSON.stringify(payload.topCandidates),
      };
      mocks.db.select.mockImplementation(() => createSelectLimitChain([existingSnapshot]));
      mocks.db.update.mockReturnValue(createUpdateChain());

      const result = await saveMatchSnapshotAndNotifyOnChange({
        pharmacyId: 1,
        triggerPharmacyId: 10,
        triggerUploadType: 'dead_stock',
        candidates,
        notifyEnabled: true,
      });

      expect(result.changed).toBe(false);
    });
  });

  describe('saveMatchSnapshotsBatch', () => {
    it('returns 0 for empty entries', async () => {
      const result = await saveMatchSnapshotsBatch([]);
      expect(result.changedCount).toBe(0);
    });

    it('processes batch with changed and unchanged entries', async () => {
      const candidates1 = [candidate(2)];
      const candidates2 = [candidate(3)];
      const payload2 = createSnapshotPayload(candidates2);

      mocks.db.select.mockImplementation(() => createSelectWhereChain([
        // Only candidate2's snapshot exists with matching hash
        {
          id: 2,
          pharmacyId: 20,
          candidateHash: payload2.hash,
          candidateCount: payload2.candidateCount,
          topCandidatesJson: JSON.stringify(payload2.topCandidates),
        },
      ]));

      const insertChain = createInsertOnConflictChain();
      mocks.db.insert.mockReturnValue(insertChain);

      const result = await saveMatchSnapshotsBatch([
        {
          pharmacyId: 10,
          triggerPharmacyId: 1,
          triggerUploadType: 'dead_stock' as const,
          candidates: candidates1,
          notifyEnabled: true,
        },
        {
          pharmacyId: 20,
          triggerPharmacyId: 1,
          triggerUploadType: 'dead_stock' as const,
          candidates: candidates2,
          notifyEnabled: true,
        },
      ]);

      // Only pharmacyId 10 should be changed (no existing snapshot)
      expect(result.changedCount).toBe(1);
    });

    it('skips notification for entries with notifyEnabled false', async () => {
      mocks.db.select.mockImplementation(() => createSelectWhereChain([]));
      const insertChain = createInsertOnConflictChain();
      mocks.db.insert.mockReturnValue(insertChain);

      await saveMatchSnapshotsBatch([
        {
          pharmacyId: 10,
          triggerPharmacyId: 1,
          triggerUploadType: 'dead_stock' as const,
          candidates: [candidate(2)],
          notifyEnabled: false,
        },
      ]);

      // insert is called once for upsert, no notifications
      // The notification values array should be empty, so only one insert call
      expect(mocks.db.insert).toHaveBeenCalledTimes(1); // only snapshot upsert
    });

    it('handles entries with existing topCandidatesJson for diff calculation', async () => {
      const oldCandidates = [candidate(5)];
      const oldPayload = createSnapshotPayload(oldCandidates);

      mocks.db.select.mockImplementation(() => createSelectWhereChain([
        {
          id: 1,
          pharmacyId: 10,
          candidateHash: 'old-hash', // different hash to trigger change
          candidateCount: 1,
          topCandidatesJson: JSON.stringify(oldPayload.topCandidates),
        },
      ]));

      const insertChain = createInsertOnConflictChain();
      mocks.db.insert.mockReturnValue(insertChain);

      const result = await saveMatchSnapshotsBatch([
        {
          pharmacyId: 10,
          triggerPharmacyId: 1,
          triggerUploadType: 'dead_stock' as const,
          candidates: [candidate(6)], // different candidate
          notifyEnabled: true,
        },
      ]);

      expect(result.changedCount).toBe(1);
      // Insert called twice: once for snapshot upsert, once for notifications
      expect(mocks.db.insert).toHaveBeenCalledTimes(2);
    });
  });
});
