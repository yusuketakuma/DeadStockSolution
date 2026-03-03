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
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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

import { processPendingMatchingRefreshJobs, triggerMatchingRefreshOnUpload } from '../services/matching-refresh-service';

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

describe('matching-refresh-service ultra coverage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getStaleBeforeIso.mockReturnValue('2026-01-01T00:00:00.000Z');
    mocks.getNextRetryIso.mockReturnValue('2026-02-28T12:00:00.000Z');
    mocks.splitIntoChunks.mockImplementation((arr: unknown[]) => [arr]);
  });

  describe('processPendingMatchingRefreshJobs', () => {
    it('returns 0 when no jobs are pending', async () => {
      // claimNextRefreshJob returns null when no candidate
      mocks.db.select.mockImplementation(() => createSelectChain([]));

      const result = await processPendingMatchingRefreshJobs(3);
      expect(result).toBe(0);
    });

    it('processes a job successfully and deletes it', async () => {
      const job = { id: 1, triggerPharmacyId: 10, uploadType: 'dead_stock' as const, attempts: 0 };

      // The flow for processPendingMatchingRefreshJobs(1):
      // select calls:
      //   1. claimNextRefreshJob candidate select -> [job]
      //   2-4. resolveImpactedPharmacyIds: exists sub-queries (3 nested db.select calls)
      //   5. resolveImpactedPharmacyIds outer select -> [{id: 10}]
      //   6. notifyRows select -> []
      //   7. second claimNextRefreshJob -> [] (no more)
      // Note: call order depends on JS argument evaluation. The exists() args
      // are evaluated before the outer .where() call, but the sub-selects
      // return chains that are never awaited (just passed to mocked exists()).

      let selectCallCount = 0;
      mocks.db.select.mockImplementation(() => {
        selectCallCount++;
        const chain: Record<string, ReturnType<typeof vi.fn>> = {
          from: vi.fn(),
          where: vi.fn(),
          orderBy: vi.fn(),
          limit: vi.fn(),
        };
        chain.from.mockReturnValue(chain);
        chain.orderBy.mockReturnValue(chain);
        chain.limit.mockResolvedValue([]);

        const n = selectCallCount;
        if (n === 1) {
          // claimNextRefreshJob candidate: .from().where().orderBy().limit() -> [job]
          chain.where.mockReturnValue(chain);
          chain.limit.mockResolvedValue([job]);
        } else if (n === 2) {
          // resolveImpactedPharmacyIds outer: .from().where(...) -> [{id: 10}]
          // .where() is the terminal awaited call here
          chain.where.mockResolvedValue([{ id: 10 }]);
        } else if (n >= 3 && n <= 5) {
          // exists sub-query chains (3 calls inside .where(and(...)) args)
          // These chains are passed to mocked exists(), never awaited
          chain.where.mockReturnValue(chain);
        } else if (n === 6) {
          // notifyRows: .from().where() -> []
          chain.where.mockResolvedValue([]);
        } else {
          // second claimNextRefreshJob: no more candidates
          chain.where.mockReturnValue(chain);
          chain.limit.mockResolvedValue([]);
        }
        return chain;
      });

      // Claim update
      mocks.db.update.mockImplementation(() => createUpdateChain([job]));
      mocks.db.delete.mockImplementation(() => createDeleteChain());

      // runSingleRefresh mocks
      mocks.splitIntoChunks.mockImplementation((arr: unknown[]) => [arr]);
      mocks.findMatchesBatch.mockResolvedValue(new Map());
      mocks.saveMatchSnapshotsBatch.mockResolvedValue({ changedCount: 0 });

      const result = await processPendingMatchingRefreshJobs(1);
      expect(result).toBe(1);
      expect(mocks.db.delete).toHaveBeenCalled();
    });

    it('handles job failure and records error then retries next', async () => {
      const job = { id: 1, triggerPharmacyId: 10, uploadType: 'dead_stock', attempts: 4 };

      let selectCallCount = 0;
      mocks.db.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          // claimNextRefreshJob candidate
          return createSelectChain([job]);
        }
        if (selectCallCount === 2) {
          // resolveImpactedPharmacyIds
          return createSelectChain([{ id: 10 }]);
        }
        if (selectCallCount === 3) {
          // notifyRows
          const chain = { from: vi.fn(), where: vi.fn() };
          chain.from.mockReturnValue(chain);
          chain.where.mockResolvedValue([]);
          return chain;
        }
        // Next claimNextRefreshJob: no more
        return createSelectChain([]);
      });

      mocks.db.update.mockImplementation(() => createUpdateChain([job]));
      mocks.db.delete.mockImplementation(() => createDeleteChain());
      mocks.splitIntoChunks.mockImplementation((arr: unknown[]) => [arr]);

      // runSingleRefresh: findMatchesBatch fails, then findMatches also fails
      mocks.findMatchesBatch.mockRejectedValue(new Error('batch fail'));
      mocks.findMatches.mockRejectedValue(new Error('single fail'));

      const result = await processPendingMatchingRefreshJobs(1);
      // Job failed, so processed = 0
      expect(result).toBe(0);
    });
  });

  describe('triggerMatchingRefreshOnUpload', () => {
    it('updates existing waiting job and keeps it', async () => {
      const updateChain = createUpdateChain();
      const deleteChain = createDeleteChain();

      const executor = {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
        select: vi.fn().mockImplementation(() => {
          const chain = {
            from: vi.fn(),
            where: vi.fn(),
            orderBy: vi.fn(),
          };
          chain.from.mockReturnValue(chain);
          chain.where.mockReturnValue(chain);
          chain.orderBy.mockResolvedValue([
            { id: 101, processingStartedAt: null, attempts: 0 },
          ]);
          return chain;
        }),
        update: vi.fn().mockReturnValue(updateChain),
        delete: vi.fn().mockReturnValue(deleteChain),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
      };

      await triggerMatchingRefreshOnUpload(
        { triggerPharmacyId: 10, uploadType: 'dead_stock' },
        executor as never,
      );

      expect(executor.update).toHaveBeenCalled();
      expect(executor.insert).not.toHaveBeenCalled();
    });

    it('creates new job when no existing rows', async () => {
      const insertChain = { values: vi.fn().mockResolvedValue(undefined) };

      const executor = {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
        select: vi.fn().mockImplementation(() => {
          const chain = {
            from: vi.fn(),
            where: vi.fn(),
            orderBy: vi.fn(),
          };
          chain.from.mockReturnValue(chain);
          chain.where.mockReturnValue(chain);
          chain.orderBy.mockResolvedValue([]);
          return chain;
        }),
        update: vi.fn(),
        delete: vi.fn(),
        insert: vi.fn().mockReturnValue(insertChain),
      };

      await triggerMatchingRefreshOnUpload(
        { triggerPharmacyId: 5, uploadType: 'used_medication' },
        executor as never,
      );

      expect(executor.insert).toHaveBeenCalled();
    });

    it('treats stale processing jobs as waiting', async () => {
      const staleTime = '2025-01-01T00:00:00.000Z'; // before stale threshold
      const updateChain = createUpdateChain();

      const executor = {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
        select: vi.fn().mockImplementation(() => {
          const chain = {
            from: vi.fn(),
            where: vi.fn(),
            orderBy: vi.fn(),
          };
          chain.from.mockReturnValue(chain);
          chain.where.mockReturnValue(chain);
          chain.orderBy.mockResolvedValue([
            { id: 201, processingStartedAt: staleTime, attempts: 1 },
          ]);
          return chain;
        }),
        update: vi.fn().mockReturnValue(updateChain),
        delete: vi.fn().mockReturnValue(createDeleteChain()),
        insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
      };

      await triggerMatchingRefreshOnUpload(
        { triggerPharmacyId: 15, uploadType: 'dead_stock' },
        executor as never,
      );

      expect(executor.update).toHaveBeenCalled();
      expect(executor.insert).not.toHaveBeenCalled();
    });
  });
});
