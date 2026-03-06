import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
  },
  findMatches: vi.fn(),
  findMatchesBatch: vi.fn(),
  saveMatchSnapshotAndNotifyOnChange: vi.fn(),
  saveMatchSnapshotsBatch: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  drizzle: {
    and: vi.fn((...args: unknown[]) => ({ _and: args })),
    asc: vi.fn((col: unknown) => ({ _asc: col })),
    eq: vi.fn((a: unknown, b: unknown) => ({ _eq: [a, b] })),
    exists: vi.fn((arg: unknown) => ({ _exists: arg })),
    gte: vi.fn((a: unknown, b: unknown) => ({ _gte: [a, b] })),
    inArray: vi.fn((a: unknown, b: unknown) => ({ _inArray: [a, b] })),
    isNull: vi.fn((col: unknown) => ({ _isNull: col })),
    lt: vi.fn((a: unknown, b: unknown) => ({ _lt: [a, b] })),
    lte: vi.fn((a: unknown, b: unknown) => ({ _lte: [a, b] })),
    notInArray: vi.fn((a: unknown, b: unknown) => ({ _notInArray: [a, b] })),
    or: vi.fn((...args: unknown[]) => ({ _or: args })),
    sql: vi.fn(() => ({})),
  },
  splitIntoChunks: vi.fn((arr: unknown[], size: number) => {
    const result: unknown[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      result.push(arr.slice(i, i + size));
    }
    return result;
  }),
  getNextRetryIso: vi.fn(() => new Date(Date.now() + 120000).toISOString()),
  getStaleBeforeIso: vi.fn(() => new Date(Date.now() - 900000).toISOString()),
  parseBooleanFlag: vi.fn((_: unknown, def: boolean) => def),
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

vi.mock('../services/logger', () => ({
  logger: mocks.logger,
}));

vi.mock('../utils/array-utils', () => ({
  splitIntoChunks: mocks.splitIntoChunks,
}));

vi.mock('../utils/job-retry-utils', () => ({
  getNextRetryIso: mocks.getNextRetryIso,
  getStaleBeforeIso: mocks.getStaleBeforeIso,
}));

vi.mock('../utils/number-utils', () => ({
  parseBooleanFlag: mocks.parseBooleanFlag,
}));

vi.mock('drizzle-orm', () => mocks.drizzle);

import {
  processPendingMatchingRefreshJobs,
  triggerMatchingRefreshOnUpload,
  __testables,
} from '../services/matching-refresh-service';

/**
 * Universal select chain: every method returns the chain AND is thenable.
 * When awaited (or .then() called), resolves to `rows`.
 * Works for .where()-terminal, .orderBy()-terminal, .limit()-terminal, and sub-query chains.
 */
function createUniversalSelectChain(rows: unknown[]) {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => void) => Promise.resolve(rows).then(resolve);
      }
      // Any chain method returns a new proxy (same behavior)
      return vi.fn().mockReturnValue(new Proxy({}, handler));
    },
  };
  return new Proxy({}, handler);
}

/** Select chain where .orderBy() is terminal (used by triggerMatchingRefreshOnUpload executor) */
function createSelectOrderByChain(rows: unknown[]) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockResolvedValue(rows);
  return chain;
}

function createUpdateChain(result?: unknown[]) {
  const chain = {
    set: vi.fn(),
    where: vi.fn(),
    returning: vi.fn(),
  };
  chain.set.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  if (result !== undefined) {
    chain.returning.mockResolvedValue(result);
  } else {
    chain.where.mockResolvedValue(undefined);
  }
  return chain;
}

function createDeleteChain() {
  const chain = {
    where: vi.fn(),
  };
  chain.where.mockResolvedValue(undefined);
  return chain;
}

describe('matching-refresh-service coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('processPendingMatchingRefreshJobs', () => {
    it('returns 0 when no jobs available', async () => {
      // claimNextRefreshJob returns null immediately (empty candidate list)
      mocks.db.select.mockImplementation(() => createUniversalSelectChain([]));
      const result = await processPendingMatchingRefreshJobs(3);
      expect(result).toBe(0);
    });

    it('processes a single job successfully', async () => {
      const job = { id: 1, triggerPharmacyId: 10, uploadType: 'dead_stock', attempts: 0 };

      // Track select call arguments to distinguish query purpose.
      // claimNextRefreshJob selects { id, triggerPharmacyId, uploadType, attempts }.
      // resolveImpactedPharmacyIds selects { id: pharmacies.id }.
      // notifyRows selects { id, matchingAutoNotifyEnabled }.
      // Sub-queries inside exists() also call db.select() but their results don't matter.
      let claimSelectDone = false;
      let resolveIdsDone = false;
      let notifyDone = false;
      mocks.db.select.mockImplementation((fields: Record<string, unknown>) => {
        const fieldKeys = fields ? Object.keys(fields) : [];
        // claimNextRefreshJob: { id, triggerPharmacyId, uploadType, attempts }
        if (!claimSelectDone && fieldKeys.includes('triggerPharmacyId')) {
          claimSelectDone = true;
          return createUniversalSelectChain([job]);
        }
        // notifyRows: { id, matchingAutoNotifyEnabled }
        if (!notifyDone && fieldKeys.includes('matchingAutoNotifyEnabled')) {
          notifyDone = true;
          return createUniversalSelectChain([{ id: 10, matchingAutoNotifyEnabled: true }]);
        }
        // resolveImpactedPharmacyIds outer: { id: pharmacies.id } (just "id" key, no other keys)
        if (!resolveIdsDone && fieldKeys.length === 1 && fieldKeys[0] === 'id') {
          resolveIdsDone = true;
          return createUniversalSelectChain([{ id: 10 }]);
        }
        // Sub-queries and subsequent claimNextRefreshJob (no more jobs)
        return createUniversalSelectChain([]);
      });

      // claim update (claimNextRefreshJob CAS update)
      mocks.db.update.mockImplementation(() => createUpdateChain([job]));

      // delete after success
      mocks.db.delete.mockImplementation(() => createDeleteChain());

      // findMatchesBatch returns empty map
      mocks.findMatchesBatch.mockResolvedValue(new Map([[10, []]]));
      mocks.saveMatchSnapshotsBatch.mockResolvedValue({ changedCount: 0 });

      const result = await processPendingMatchingRefreshJobs(3);
      expect(result).toBe(1);
    });

    it('handles job failure by incrementing attempts', async () => {
      const job = { id: 1, triggerPharmacyId: 10, uploadType: 'dead_stock', attempts: 4 };

      let claimSelectDone = false;
      let resolveIdsDone = false;
      let notifyDone = false;
      mocks.db.select.mockImplementation((fields: Record<string, unknown>) => {
        const fieldKeys = fields ? Object.keys(fields) : [];
        if (!claimSelectDone && fieldKeys.includes('triggerPharmacyId')) {
          claimSelectDone = true;
          return createUniversalSelectChain([job]);
        }
        if (!notifyDone && fieldKeys.includes('matchingAutoNotifyEnabled')) {
          notifyDone = true;
          return createUniversalSelectChain([{ id: 10, matchingAutoNotifyEnabled: true }]);
        }
        if (!resolveIdsDone && fieldKeys.length === 1 && fieldKeys[0] === 'id') {
          resolveIdsDone = true;
          return createUniversalSelectChain([{ id: 10 }]);
        }
        return createUniversalSelectChain([]);
      });

      // First update: claim (with returning), subsequent: retry metadata (no returning)
      let updateCallCount = 0;
      mocks.db.update.mockImplementation(() => {
        updateCallCount++;
        if (updateCallCount === 1) {
          return createUpdateChain([job]);
        }
        return createUpdateChain();
      });

      // findMatchesBatch throws to simulate failure
      mocks.findMatchesBatch.mockRejectedValue(new Error('DB error'));
      mocks.findMatches.mockRejectedValue(new Error('DB error'));

      const result = await processPendingMatchingRefreshJobs(3);
      expect(result).toBe(0);
      // attempts was 4, next is 5 which >= MAX_JOB_ATTEMPTS, so logger.error is called
      expect(mocks.logger.error).toHaveBeenCalled();
    });

    it('uses retry backoff progression arguments when job fails before max attempts', async () => {
      const job = { id: 11, triggerPharmacyId: 20, uploadType: 'dead_stock', attempts: 1 };

      let claimSelectDone = false;
      let resolveIdsDone = false;
      let notifyDone = false;
      mocks.db.select.mockImplementation((fields: Record<string, unknown>) => {
        const fieldKeys = fields ? Object.keys(fields) : [];
        if (!claimSelectDone && fieldKeys.includes('triggerPharmacyId')) {
          claimSelectDone = true;
          return createUniversalSelectChain([job]);
        }
        if (!notifyDone && fieldKeys.includes('matchingAutoNotifyEnabled')) {
          notifyDone = true;
          return createUniversalSelectChain([{ id: 20, matchingAutoNotifyEnabled: true }]);
        }
        if (!resolveIdsDone && fieldKeys.length === 1 && fieldKeys[0] === 'id') {
          resolveIdsDone = true;
          return createUniversalSelectChain([{ id: 20 }]);
        }
        return createUniversalSelectChain([]);
      });

      let updateCallCount = 0;
      mocks.db.update.mockImplementation(() => {
        updateCallCount += 1;
        if (updateCallCount === 1) {
          return createUpdateChain([job]);
        }
        return createUpdateChain();
      });

      mocks.findMatchesBatch.mockRejectedValue(new Error('batch-fail'));
      mocks.findMatches.mockRejectedValue(new Error('single-fail'));

      const result = await processPendingMatchingRefreshJobs(1);
      expect(result).toBe(0);
      expect(mocks.getNextRetryIso).toHaveBeenCalledWith(2, 5, 120000);
      expect(mocks.logger.warn).toHaveBeenCalled();
    });
  });

  describe('triggerMatchingRefreshOnUpload', () => {
    it('skips when keeper row exists and updates it', async () => {
      const updateChain = {
        set: vi.fn(),
        where: vi.fn(),
      };
      updateChain.set.mockReturnValue(updateChain);
      updateChain.where.mockResolvedValue(undefined);

      const executor = {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
        select: vi.fn().mockImplementation(() => createSelectOrderByChain([
          { id: 100, processingStartedAt: null, attempts: 0 },
        ])),
        update: vi.fn().mockReturnValue(updateChain),
        delete: vi.fn().mockReturnValue(createDeleteChain()),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
      };

      await triggerMatchingRefreshOnUpload(
        { triggerPharmacyId: 10, uploadType: 'dead_stock' },
        executor as never,
      );

      expect(executor.update).toHaveBeenCalledTimes(1);
      expect(executor.insert).not.toHaveBeenCalled();
    });

    it('creates new job when no existing rows', async () => {
      const insertChain = { values: vi.fn().mockResolvedValue(undefined) };
      const executor = {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
        select: vi.fn().mockImplementation(() => createSelectOrderByChain([])),
        update: vi.fn().mockReturnValue(createUpdateChain()),
        delete: vi.fn().mockReturnValue(createDeleteChain()),
        insert: vi.fn().mockReturnValue(insertChain),
      };

      await triggerMatchingRefreshOnUpload(
        { triggerPharmacyId: 10, uploadType: 'used_medication' },
        executor as never,
      );

      expect(executor.insert).toHaveBeenCalledTimes(1);
      expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({
        triggerPharmacyId: 10,
        uploadType: 'used_medication',
      }));
    });

    it('deletes redundant waiting rows when multiple exist', async () => {
      const updateChain = {
        set: vi.fn(),
        where: vi.fn(),
      };
      updateChain.set.mockReturnValue(updateChain);
      updateChain.where.mockResolvedValue(undefined);

      const deleteChain = createDeleteChain();

      const executor = {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
        select: vi.fn().mockImplementation(() => createSelectOrderByChain([
          { id: 100, processingStartedAt: null, attempts: 0 },
          { id: 101, processingStartedAt: null, attempts: 1 },
          { id: 102, processingStartedAt: null, attempts: 2 },
        ])),
        update: vi.fn().mockReturnValue(updateChain),
        delete: vi.fn().mockReturnValue(deleteChain),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
      };

      await triggerMatchingRefreshOnUpload(
        { triggerPharmacyId: 10, uploadType: 'dead_stock' },
        executor as never,
      );

      expect(executor.update).toHaveBeenCalledTimes(1);
      expect(executor.delete).toHaveBeenCalledTimes(1); // redundant ids [101, 102]
    });

    it('ignores processing rows as non-waiting and inserts new job', async () => {
      // All existing rows are being processed (processingStartedAt is recent)
      const recentTimestamp = new Date().toISOString();

      function createOrderBySelectChain(rows: unknown[]) {
        const chain = {
          from: vi.fn(),
          where: vi.fn(),
          orderBy: vi.fn(),
        };
        chain.from.mockReturnValue(chain);
        chain.where.mockReturnValue(chain);
        chain.orderBy.mockResolvedValue(rows);
        return chain;
      }

      const executor = {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
        select: vi.fn().mockImplementation(() => createOrderBySelectChain([
          { id: 100, processingStartedAt: recentTimestamp, attempts: 0 },
        ])),
        update: vi.fn().mockReturnValue(createUpdateChain()),
        delete: vi.fn().mockReturnValue(createDeleteChain()),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
      };

      await triggerMatchingRefreshOnUpload(
        { triggerPharmacyId: 10, uploadType: 'dead_stock' },
        executor as never,
      );

      expect(executor.insert).toHaveBeenCalledTimes(1);
    });
  });

  describe('__testables.splitIntoChunks', () => {
    it('re-exports splitIntoChunks from array-utils', () => {
      expect(__testables.splitIntoChunks).toBeDefined();
    });
  });

  describe('__testables.claimNextRefreshJob', () => {
    it('reclaims stale processing job candidate using stale timeout helper', async () => {
      const candidate = { id: 55, triggerPharmacyId: 30, uploadType: 'used_medication', attempts: 0 };
      mocks.db.select.mockImplementation(() => createUniversalSelectChain([candidate]));
      mocks.db.update.mockImplementation(() => createUpdateChain([candidate]));

      const claimed = await __testables.claimNextRefreshJob([]);
      expect(claimed).toEqual(candidate);
      expect(mocks.getStaleBeforeIso).toHaveBeenCalledWith(15 * 60 * 1000);
    });
  });
});
