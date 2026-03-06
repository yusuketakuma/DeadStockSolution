import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('drizzle-orm', () => ({
  asc: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));

import { triggerTrustScoreRecalculation, recalculateTrustScores } from '../services/trust-score-service';

function createFromResolvedQuery(result: unknown) {
  const query = { from: vi.fn() };
  query.from.mockResolvedValue(result);
  return query;
}

function createWhereQuery(result: unknown) {
  const query = { from: vi.fn(), where: vi.fn() };
  query.from.mockReturnValue(query);
  query.where.mockResolvedValue(result);
  return query;
}

function createGroupByQuery(result: unknown, withWhere: boolean) {
  const query = { from: vi.fn(), groupBy: vi.fn(), where: vi.fn() };
  query.from.mockReturnValue(query);
  query.groupBy.mockReturnValue(query);
  if (withWhere) {
    query.where.mockResolvedValue(result);
  } else {
    query.groupBy.mockResolvedValue(result);
  }
  return query;
}

function createInsertQuery() {
  const query = { values: vi.fn() };
  query.values.mockReturnValue({
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  });
  return query;
}

describe('trust-score-service ultra coverage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('triggerTrustScoreRecalculation', () => {
    it('starts recalculation and returns started=true on first call', async () => {
      const activeQuery = createFromResolvedQuery([{ id: 1 }]);
      const aggregateQuery = createGroupByQuery([], false);
      const insertQuery = createInsertQuery();

      mocks.db.select
        .mockImplementationOnce(() => activeQuery)
        .mockImplementationOnce(() => aggregateQuery);
      mocks.db.insert.mockReturnValue(insertQuery);

      const result = triggerTrustScoreRecalculation();
      expect(result.started).toBe(true);
      expect(result.startedAt).toBeTruthy();

      // Wait for the async job to finish
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    it('returns started=false when job is already running', async () => {
      // Set up mocks to have a never-resolving promise so job stays "running"
      let resolvePromise: () => void;
      const blockingPromise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
      });

      const activeQuery = createFromResolvedQuery([{ id: 1 }]);
      const aggregateQuery = createGroupByQuery([], false);
      const insertQuery = createInsertQuery();

      mocks.db.select
        .mockImplementationOnce(() => activeQuery)
        .mockImplementationOnce(() => aggregateQuery);
      mocks.db.insert.mockReturnValue(insertQuery);

      // Start first job
      const result1 = triggerTrustScoreRecalculation();
      expect(result1.started).toBe(true);

      // Try to start second while first is running
      const result2 = triggerTrustScoreRecalculation();
      expect(result2.started).toBe(false);
      expect(result2.startedAt).toBe(result1.startedAt);

      // Let the job finish
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    it('handles error in recalculation without crashing', async () => {
      mocks.db.select.mockImplementation(() => {
        throw new Error('db error');
      });

      const result = triggerTrustScoreRecalculation();
      expect(result.started).toBe(true);

      // Wait for async error to be caught
      await new Promise((resolve) => setTimeout(resolve, 50));

      // After error, job should be cleared and new job can start
      const activeQuery = createFromResolvedQuery([]);
      const aggregateQuery = createGroupByQuery([], false);
      mocks.db.select
        .mockImplementationOnce(() => activeQuery)
        .mockImplementationOnce(() => aggregateQuery);

      const result2 = triggerTrustScoreRecalculation();
      expect(result2.started).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  });

  describe('recalculateTrustScores edge cases', () => {
    it('handles empty target array same as no target', async () => {
      const allPharmaciesQuery = createFromResolvedQuery([{ id: 5 }]);
      const aggregateQuery = createGroupByQuery([], false);
      const insertQuery = createInsertQuery();

      mocks.db.select
        .mockImplementationOnce(() => allPharmaciesQuery)
        .mockImplementationOnce(() => aggregateQuery);
      mocks.db.insert.mockReturnValue(insertQuery);

      await recalculateTrustScores([]);

      // Should call with no WHERE for pharmacies (all mode)
      expect(allPharmaciesQuery.from).toHaveBeenCalled();
    });

    it('assigns default score 60 for pharmacies with no feedback', async () => {
      const activeQuery = createWhereQuery([{ id: 1 }]);
      const aggregateQuery = createGroupByQuery([], true);
      const insertQuery = createInsertQuery();

      mocks.db.select
        .mockImplementationOnce(() => activeQuery)
        .mockImplementationOnce(() => aggregateQuery);
      mocks.db.insert.mockReturnValue(insertQuery);

      await recalculateTrustScores([1]);

      expect(insertQuery.values).toHaveBeenCalledWith(expect.objectContaining({
        pharmacyId: 1,
        trustScore: '60',
        ratingCount: 0,
        positiveRate: '0',
      }));
    });
  });
});
