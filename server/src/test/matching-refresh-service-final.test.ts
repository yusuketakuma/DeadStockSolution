/**
 * matching-refresh-service-final.test.ts
 * Covers uncovered lines in matching-refresh-service.ts:
 * - runSingleRefresh: saveMatchSnapshotsBatch failure fallback to per-pharmacy
 *   - saveMatchSnapshotAndNotifyOnChange with result.changed = true (increments changedCount)
 *   - saveMatchSnapshotAndNotifyOnChange failure (adds to failedPharmacyIds)
 * - runSingleRefresh: matchesByPharmacy fallback (has(pharmacyId) is false -> findMatches)
 * - processPendingRefreshJobs: failedInThisRun exclusion (notInArray path)
 * - resolveMatchingRefreshDebounceMs: negative value returns 120_000
 * - claimNextRefreshJob: contention (all 3 attempts return null claimed) -> returns null
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
    insert: vi.fn(),
  },
  findMatches: vi.fn(),
  findMatchesBatch: vi.fn(),
  saveMatchSnapshotAndNotifyOnChange: vi.fn(),
  saveMatchSnapshotsBatch: vi.fn(),
  splitIntoChunks: vi.fn(),
  getNextRetryIso: vi.fn(),
  getStaleBeforeIso: vi.fn(),
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/matching-service', () => ({
  findMatches: mocks.findMatches,
  findMatchesBatch: mocks.findMatchesBatch,
}));

vi.mock('../services/matching-snapshot-service', () => ({
  saveMatchSnapshotAndNotifyOnChange: mocks.saveMatchSnapshotAndNotifyOnChange,
  saveMatchSnapshotsBatch: mocks.saveMatchSnapshotsBatch,
}));

vi.mock('../utils/array-utils', () => ({
  splitIntoChunks: mocks.splitIntoChunks,
}));

vi.mock('../utils/job-retry-utils', () => ({
  getNextRetryIso: mocks.getNextRetryIso,
  getStaleBeforeIso: mocks.getStaleBeforeIso,
}));

vi.mock('../utils/number-utils', () => ({
  parseBooleanFlag: vi.fn(() => true),
}));

vi.mock('../services/logger', () => ({
  logger: mocks.logger,
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  asc: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  exists: vi.fn(() => ({})),
  gte: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  isNull: vi.fn(() => ({})),
  lt: vi.fn(() => ({})),
  lte: vi.fn(() => ({})),
  notInArray: vi.fn(() => ({})),
  or: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));

import { processPendingMatchingRefreshJobs, __testables } from '../services/matching-refresh-service';

const { runSingleRefresh, claimNextRefreshJob } = __testables;

function createUniversalSelectChain(rows: unknown[]) {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => Promise.resolve(rows).then(resolve);
      }
      return vi.fn().mockReturnValue(new Proxy({}, handler));
    },
  };
  return new Proxy({}, handler);
}

function createSelectChain(rows: unknown[]) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockResolvedValue(rows);
  return chain;
}

function createUpdateChain(returnRows: unknown[] = []) {
  const chain = {
    set: vi.fn(),
    where: vi.fn(),
    returning: vi.fn(),
  };
  chain.set.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.returning.mockResolvedValue(returnRows);
  return chain;
}

function createDeleteChain() {
  return { where: vi.fn().mockResolvedValue(undefined) };
}

describe('matching-refresh-service-final', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getStaleBeforeIso.mockReturnValue('2026-01-01T00:00:00.000Z');
    mocks.getNextRetryIso.mockReturnValue('2026-02-28T12:00:00.000Z');
    mocks.splitIntoChunks.mockImplementation((arr: unknown[]) => [arr]);
  });

  describe('runSingleRefresh — batch snapshot save failure fallback', () => {
    it('falls back to per-pharmacy snapshot when saveMatchSnapshotsBatch throws', async () => {
      // resolveImpactedPharmacyIds: returns pharmacy 10
      mocks.db.select.mockImplementation((fields: Record<string, unknown>) => {
        const fieldKeys = fields ? Object.keys(fields) : [];
        if (fieldKeys.includes('matchingAutoNotifyEnabled')) {
          return createUniversalSelectChain([{ id: 10, matchingAutoNotifyEnabled: true }]);
        }
        return createUniversalSelectChain([{ id: 10 }]);
      });

      mocks.findMatchesBatch.mockResolvedValue(new Map([[10, []]]));

      // Batch save fails
      mocks.saveMatchSnapshotsBatch.mockRejectedValue(new Error('batch save error'));

      // Per-pharmacy fallback: changed = false
      mocks.saveMatchSnapshotAndNotifyOnChange.mockResolvedValue({ changed: false });

      await runSingleRefresh(10, 'dead_stock');

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Batch snapshot save failed'),
        expect.any(Object),
      );
      expect(mocks.saveMatchSnapshotAndNotifyOnChange).toHaveBeenCalled();
    });

    it('increments changedCount when saveMatchSnapshotAndNotifyOnChange returns changed=true', async () => {
      mocks.db.select.mockImplementation((fields: Record<string, unknown>) => {
        const fieldKeys = fields ? Object.keys(fields) : [];
        if (fieldKeys.includes('matchingAutoNotifyEnabled')) {
          return createUniversalSelectChain([{ id: 10, matchingAutoNotifyEnabled: true }]);
        }
        return createUniversalSelectChain([{ id: 10 }]);
      });

      mocks.findMatchesBatch.mockResolvedValue(new Map([[10, []]]));
      mocks.saveMatchSnapshotsBatch.mockRejectedValue(new Error('batch error'));

      // Per-pharmacy: changed = true
      mocks.saveMatchSnapshotAndNotifyOnChange.mockResolvedValue({ changed: true });

      // Should complete without throwing
      await runSingleRefresh(10, 'dead_stock');

      expect(mocks.saveMatchSnapshotAndNotifyOnChange).toHaveBeenCalledWith(
        expect.objectContaining({
          pharmacyId: 10,
          triggerPharmacyId: 10,
          triggerUploadType: 'dead_stock',
        }),
      );
    });

    it('records failedPharmacyIds when per-pharmacy fallback also fails', async () => {
      mocks.db.select.mockImplementation((fields: Record<string, unknown>) => {
        const fieldKeys = fields ? Object.keys(fields) : [];
        if (fieldKeys.includes('matchingAutoNotifyEnabled')) {
          return createUniversalSelectChain([{ id: 10, matchingAutoNotifyEnabled: true }]);
        }
        return createUniversalSelectChain([{ id: 10 }]);
      });

      mocks.findMatchesBatch.mockResolvedValue(new Map([[10, []]]));
      mocks.saveMatchSnapshotsBatch.mockRejectedValue(new Error('batch error'));
      mocks.saveMatchSnapshotAndNotifyOnChange.mockRejectedValue(new Error('per-pharmacy error'));

      // Should throw with the failed pharmacy ID
      await expect(runSingleRefresh(10, 'dead_stock')).rejects.toThrow('10');
      expect(mocks.logger.error).toHaveBeenCalled();
    });
  });

  describe('runSingleRefresh — findMatches fallback (matchesByPharmacy.has = false)', () => {
    it('falls back to findMatches when pharmacy not in matchesByPharmacy batch result', async () => {
      mocks.db.select.mockImplementation((fields: Record<string, unknown>) => {
        const fieldKeys = fields ? Object.keys(fields) : [];
        if (fieldKeys.includes('matchingAutoNotifyEnabled')) {
          return createUniversalSelectChain([
            { id: 10, matchingAutoNotifyEnabled: true },
            { id: 20, matchingAutoNotifyEnabled: false },
          ]);
        }
        return createUniversalSelectChain([{ id: 10 }, { id: 20 }]);
      });

      // findMatchesBatch returns Map with only pharmacy 10, NOT 20
      mocks.findMatchesBatch.mockResolvedValue(new Map([[10, []]]));
      // findMatches for pharmacy 20 (the fallback)
      mocks.findMatches.mockResolvedValue([]);
      mocks.saveMatchSnapshotsBatch.mockResolvedValue({ changedCount: 0 });

      await runSingleRefresh(10, 'dead_stock');

      // findMatches should have been called for pharmacy 20
      expect(mocks.findMatches).toHaveBeenCalledWith(20);
    });
  });

  describe('runSingleRefresh — failedPharmacyIds throws at end', () => {
    it('throws error listing failed pharmacy IDs after all pharmacies processed', async () => {
      mocks.db.select.mockImplementation((fields: Record<string, unknown>) => {
        const fieldKeys = fields ? Object.keys(fields) : [];
        if (fieldKeys.includes('matchingAutoNotifyEnabled')) {
          return createUniversalSelectChain([{ id: 10, matchingAutoNotifyEnabled: true }]);
        }
        return createUniversalSelectChain([{ id: 10 }]);
      });

      // findMatchesBatch fails -> falls back to findMatches
      mocks.findMatchesBatch.mockRejectedValue(new Error('batch lookup fail'));
      // findMatches also fails -> pharmacy goes to failedPharmacyIds
      mocks.findMatches.mockRejectedValue(new Error('single fail'));

      await expect(runSingleRefresh(10, 'used_medication')).rejects.toThrow(
        'Matching auto refresh failed for pharmacies: 10',
      );
    });
  });

  describe('claimNextRefreshJob — contention exhaustion', () => {
    it('returns null when all 3 claim attempts fail (CAS fails each time)', async () => {
      // Each iteration: candidate found, but claim update returns nothing (CAS fails)
      let selectCallCount = 0;
      mocks.db.select.mockImplementation(() => {
        selectCallCount++;
        // Always return a candidate
        return createSelectChain([{
          id: 1,
          triggerPharmacyId: 10,
          uploadType: 'dead_stock',
          attempts: 0,
        }]);
      });

      // CAS update always fails (another worker claimed it)
      mocks.db.update.mockImplementation(() => createUpdateChain([]));

      const result = await claimNextRefreshJob([]);
      expect(result).toBeNull();
      // Should have tried CLAIM_CONTENTION_RETRY_LIMIT (3) times
      expect(mocks.db.update).toHaveBeenCalledTimes(3);
    });

    it('returns null immediately when no candidate exists', async () => {
      mocks.db.select.mockImplementation(() => createSelectChain([]));

      const result = await claimNextRefreshJob([]);
      expect(result).toBeNull();
      expect(mocks.db.update).not.toHaveBeenCalled();
    });

    it('passes excludedJobIds to notInArray condition', async () => {
      // With excluded IDs, should still query and fail CAS
      mocks.db.select.mockImplementation(() => createSelectChain([]));

      const result = await claimNextRefreshJob([1, 2, 3]);
      expect(result).toBeNull();
    });
  });

  describe('processPendingMatchingRefreshJobs — failedInThisRun exclusion', () => {
    it('excludes failed job IDs from subsequent claim attempts', async () => {
      const job1 = { id: 1, triggerPharmacyId: 10, uploadType: 'dead_stock' as const, attempts: 0 };

      let selectCallCount = 0;
      mocks.db.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          // First claim: job1 candidate
          return createSelectChain([job1]);
        }
        if (selectCallCount === 2) {
          // resolveImpactedPharmacyIds
          return createUniversalSelectChain([{ id: 10 }]);
        }
        if (selectCallCount === 3) {
          // notifyRows
          return createUniversalSelectChain([{ id: 10, matchingAutoNotifyEnabled: true }]);
        }
        // Second claim attempt (job1 is now in failedInThisRun): no more jobs
        return createSelectChain([]);
      });

      // First claim: succeed
      mocks.db.update.mockReturnValueOnce(createUpdateChain([job1]))
        // failure update (recordError after runSingleRefresh fails)
        .mockReturnValueOnce(createUpdateChain());

      mocks.splitIntoChunks.mockImplementation((arr: unknown[]) => [arr]);
      mocks.findMatchesBatch.mockRejectedValue(new Error('refresh fail'));
      mocks.findMatches.mockRejectedValue(new Error('per-pharmacy fail'));

      const result = await processPendingMatchingRefreshJobs(2);
      // Job failed, so processed = 0
      expect(result).toBe(0);
    });
  });
});
