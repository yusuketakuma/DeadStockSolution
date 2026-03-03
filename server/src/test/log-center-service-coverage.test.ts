import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
  },
  drizzle: {
    desc: vi.fn((col: unknown) => ({ _desc: col })),
    and: vi.fn((...args: unknown[]) => ({ _and: args })),
    eq: vi.fn((a: unknown, b: unknown) => ({ _eq: [a, b] })),
    gte: vi.fn((a: unknown, b: unknown) => ({ _gte: [a, b] })),
    lte: vi.fn((a: unknown, b: unknown) => ({ _lte: [a, b] })),
    ilike: vi.fn((a: unknown, b: unknown) => ({ _ilike: [a, b] })),
    or: vi.fn((...args: unknown[]) => ({ _or: args })),
    sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
      strings: Array.from(strings),
      values,
    })),
    count: vi.fn(() => ({ _count: true })),
  },
  escapeLikeWildcards: vi.fn((v: string) => v),
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('drizzle-orm', () => ({
  desc: mocks.drizzle.desc,
  and: mocks.drizzle.and,
  eq: mocks.drizzle.eq,
  gte: mocks.drizzle.gte,
  lte: mocks.drizzle.lte,
  ilike: mocks.drizzle.ilike,
  or: mocks.drizzle.or,
  sql: mocks.drizzle.sql,
  count: mocks.drizzle.count,
}));

vi.mock('../utils/request-utils', () => ({
  escapeLikeWildcards: mocks.escapeLikeWildcards,
}));

import {
  queryLogs,
  getLogSummary,
  normalizeLogEntry,
} from '../services/log-center-service';

function createSelectChain(result: unknown[]) {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    then: vi.fn(),
  };
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockImplementation((fetchLimit: number) => {
    if (!Number.isInteger(fetchLimit) || fetchLimit < 0) return Promise.resolve(result);
    return Promise.resolve(result.slice(0, fetchLimit));
  });
  // For count queries that end with .then()
  chain.then.mockImplementation((fn: (rows: unknown[]) => unknown) => Promise.resolve(fn(result)));
  return chain;
}

describe('log-center-service coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('normalizeLogEntry edge cases', () => {
    it('normalizeSystemEvent defaults to error for unknown level', () => {
      const row = {
        id: 1,
        level: 'unknown_level',
        eventType: 'test',
        message: 'msg',
        detailJson: null,
        occurredAt: '2026-01-01T00:00:00Z',
      };
      const entry = normalizeLogEntry('system_events', row);
      expect(entry.level).toBe('error');
    });

    it('normalizeSystemEvent handles critical level', () => {
      const row = {
        id: 1,
        level: 'critical',
        eventType: 'test',
        message: 'msg',
        detailJson: null,
        occurredAt: '2026-01-01T00:00:00Z',
      };
      const entry = normalizeLogEntry('system_events', row);
      expect(entry.level).toBe('critical');
    });

    it('normalizeActivityLog handles object metadataJson', () => {
      const metadata = { key: 'value' };
      const row = {
        id: 1,
        action: 'test',
        detail: '',
        metadataJson: metadata, // object, not string
        createdAt: '2026-01-01T00:00:00Z',
      };
      const entry = normalizeLogEntry('activity_logs', row);
      // parseJsonSafe should return the object as-is since it's not a string
      expect(entry.detail).toEqual(metadata);
    });

    it('normalizeSyncLog handles null triggeredBy', () => {
      const row = {
        id: 1,
        syncType: 'auto',
        sourceDescription: 'test',
        status: 'success',
        itemsProcessed: 0,
        itemsAdded: 0,
        itemsUpdated: 0,
        itemsDeleted: 0,
        errorMessage: null,
        startedAt: '2026-01-01T00:00:00Z',
        triggeredBy: null,
      };
      const entry = normalizeLogEntry('drug_master_sync_logs', row);
      expect(entry.pharmacyId).toBeNull();
    });

    it('normalizeActivityLog with null errorCode', () => {
      const row = {
        id: 1,
        action: 'test',
        detail: '',
        errorCode: null,
        metadataJson: null,
        createdAt: '2026-01-01T00:00:00Z',
      };
      const entry = normalizeLogEntry('activity_logs', row);
      expect(entry.errorCode).toBeNull();
    });

    it('normalizeSystemEvent with null errorCode', () => {
      const row = {
        id: 1,
        level: 'info',
        eventType: 'test',
        message: 'msg',
        detailJson: null,
        errorCode: null,
        occurredAt: '2026-01-01T00:00:00Z',
      };
      const entry = normalizeLogEntry('system_events', row);
      expect(entry.errorCode).toBeNull();
    });
  });

  describe('queryLogs', () => {
    it('returns paginated results from all sources', async () => {
      // Mock select for both count queries and data queries
      const activityRows = [{
        id: 1,
        pharmacyId: 1,
        action: 'login',
        detail: 'ok',
        resourceType: 'auth',
        metadataJson: null,
        createdAt: '2026-01-03T00:00:00Z',
      }];
      const systemRows = [{
        id: 2,
        level: 'info',
        eventType: 'deploy',
        message: 'deployed',
        detailJson: null,
        occurredAt: '2026-01-02T00:00:00Z',
      }];
      const syncRows = [{
        id: 3,
        syncType: 'auto',
        sourceDescription: 'test',
        status: 'success',
        itemsProcessed: 10,
        itemsAdded: 5,
        itemsUpdated: 3,
        itemsDeleted: 0,
        errorMessage: null,
        startedAt: '2026-01-01T00:00:00Z',
        triggeredBy: null,
      }];

      let selectCallCount = 0;
      mocks.db.select.mockImplementation(() => {
        selectCallCount++;
        // First 3 calls: count queries
        if (selectCallCount <= 3) {
          return createSelectChain([{ cnt: 1 }]);
        }
        // Next 3 calls: data queries
        if (selectCallCount === 4) return createSelectChain(activityRows);
        if (selectCallCount === 5) return createSelectChain(systemRows);
        if (selectCallCount === 6) return createSelectChain(syncRows);
        return createSelectChain([]);
      });

      const result = await queryLogs({});
      expect(result.entries.length).toBe(3);
      expect(result.total).toBe(3);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(50);
    });

    it('filters by specific source', async () => {
      let selectCallCount = 0;
      mocks.db.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return createSelectChain([{ cnt: 2 }]);
        return createSelectChain([
          { id: 1, action: 'login', detail: 'ok', resourceType: 'auth', metadataJson: null, createdAt: '2026-01-01T00:00:00Z' },
          { id: 2, action: 'logout', detail: '', resourceType: 'auth', metadataJson: null, createdAt: '2026-01-02T00:00:00Z' },
        ]);
      });

      const result = await queryLogs({ sources: ['activity_logs'] });
      expect(result.entries.length).toBe(2);
    });

    it('applies level filter in source query', async () => {
      let selectCallCount = 0;
      mocks.db.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount <= 3) return createSelectChain([{ cnt: 5 }]);
        // Data query returns source-filtered rows
        if (selectCallCount === 4) {
          return createSelectChain([
            { id: 1, action: 'test', detail: '失敗|err', resourceType: 'test', metadataJson: null, createdAt: '2026-01-01T00:00:00Z' },
          ]);
        }
        return createSelectChain([]);
      });

      const result = await queryLogs({ level: 'error' });
      expect(result.entries.every((e) => e.level === 'error')).toBe(true);
      expect(mocks.drizzle.sql).toHaveBeenCalled();
    });

    it('reuses cached level condition on repeated queries', async () => {
      let selectCallCount = 0;
      mocks.db.select.mockImplementation(() => {
        const phase = (selectCallCount % 6) + 1;
        selectCallCount += 1;
        if (phase <= 3) return createSelectChain([{ cnt: 0 }]);
        return createSelectChain([]);
      });

      mocks.drizzle.sql.mockClear();

      await queryLogs({ level: 'warning' });
      const firstSqlCalls = mocks.drizzle.sql.mock.calls.length;

      await queryLogs({ level: 'warning' });
      const secondSqlCalls = mocks.drizzle.sql.mock.calls.length;

      expect(firstSqlCalls).toBeGreaterThan(0);
      expect(secondSqlCalls).toBe(firstSqlCalls);
    });

    it('applies pagination correctly', async () => {
      let selectCallCount = 0;
      mocks.db.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount <= 3) return createSelectChain([{ cnt: 10 }]);
        // Return 10 entries for activity_logs
        const rows = Array.from({ length: 10 }, (_, i) => ({
          id: i + 1,
          action: 'test',
          detail: '',
          resourceType: 'test',
          metadataJson: null,
          createdAt: `2026-01-${String(10 - i).padStart(2, '0')}T00:00:00Z`,
        }));
        if (selectCallCount === 4) return createSelectChain(rows);
        return createSelectChain([]);
      });

      const result = await queryLogs({ page: 2, limit: 3 });
      expect(result.page).toBe(2);
      expect(result.limit).toBe(3);
      expect(result.entries.length).toBe(3);
      expect(result.entries.map((entry) => entry.id)).toEqual([4, 5, 6]);
    });

    it('fills deep page even when logs are skewed to one source', async () => {
      let selectCallCount = 0;
      const skewedRows = Array.from({ length: 200 }, (_, i) => ({
        id: i + 1,
        action: 'skewed',
        detail: '',
        resourceType: 'test',
        metadataJson: null,
        createdAt: `2026-01-${String(31 - (i % 31)).padStart(2, '0')}T00:00:00Z`,
      }));

      mocks.db.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return createSelectChain([{ cnt: 200 }]);
        if (selectCallCount === 2 || selectCallCount === 3) return createSelectChain([{ cnt: 0 }]);
        if (selectCallCount === 4) return createSelectChain(skewedRows);
        return createSelectChain([]);
      });

      const result = await queryLogs({ page: 2, limit: 50 });
      expect(result.page).toBe(2);
      expect(result.limit).toBe(50);
      expect(result.total).toBe(200);
      expect(result.entries.length).toBe(50);
    });

    it('applies search filter', async () => {
      let selectCallCount = 0;
      mocks.db.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount <= 3) return createSelectChain([{ cnt: 0 }]);
        return createSelectChain([]);
      });

      await queryLogs({ search: 'テスト' });
      expect(mocks.escapeLikeWildcards).toHaveBeenCalledWith('テスト');
    });

    it('applies date range filters', async () => {
      let selectCallCount = 0;
      mocks.db.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount <= 3) return createSelectChain([{ cnt: 0 }]);
        return createSelectChain([]);
      });

      await queryLogs({ from: '2026-01-01', to: '2026-06-01' });
      expect(mocks.drizzle.gte).toHaveBeenCalled();
      expect(mocks.drizzle.lte).toHaveBeenCalled();
    });

    it('applies pharmacyId filter', async () => {
      let selectCallCount = 0;
      mocks.db.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount <= 3) return createSelectChain([{ cnt: 0 }]);
        return createSelectChain([]);
      });

      await queryLogs({ pharmacyId: 42 });
      expect(mocks.drizzle.eq).toHaveBeenCalled();
    });
  });

  describe('getLogSummary', () => {
    it('returns aggregated summary from all sources', async () => {
      let selectCallCount = 0;
      mocks.db.select.mockImplementation(() => {
        selectCallCount++;
        const chain = {
          from: vi.fn(),
          then: vi.fn(),
        };
        chain.from.mockReturnValue(chain);

        if (selectCallCount === 1) {
          // activity_logs
          chain.then.mockImplementation((fn: (rows: unknown[]) => unknown) =>
            Promise.resolve(fn([{ total: 100, today: 10 }])),
          );
        } else if (selectCallCount === 2) {
          // system_events
          chain.then.mockImplementation((fn: (rows: unknown[]) => unknown) =>
            Promise.resolve(fn([{ total: 50, today: 5, errors: 3, warnings: 2 }])),
          );
        } else {
          // drug_master_sync_logs
          chain.then.mockImplementation((fn: (rows: unknown[]) => unknown) =>
            Promise.resolve(fn([{ total: 20, today: 2, failed: 1, partial: 1 }])),
          );
        }
        return chain;
      });

      const summary = await getLogSummary();
      expect(summary.total).toBe(170);
      expect(summary.errors).toBe(4); // system errors + sync failed
      expect(summary.warnings).toBe(3); // system warnings + sync partial
      expect(summary.today).toBe(17);
      expect(summary.bySeverity.error).toBe(4);
      expect(summary.bySeverity.warning).toBe(3);
      expect(summary.bySeverity.info).toBe(163); // 170 - 4 - 3
      expect(summary.bySource.activity_logs).toBe(100);
      expect(summary.bySource.system_events).toBe(50);
      expect(summary.bySource.drug_master_sync_logs).toBe(20);
    });

    it('handles null row values gracefully', async () => {
      let selectCallCount = 0;
      mocks.db.select.mockImplementation(() => {
        selectCallCount++;
        const chain = {
          from: vi.fn(),
          then: vi.fn(),
        };
        chain.from.mockReturnValue(chain);
        chain.then.mockImplementation((fn: (rows: unknown[]) => unknown) =>
          Promise.resolve(fn([undefined])),
        );
        return chain;
      });

      const summary = await getLogSummary();
      expect(summary.total).toBe(0);
      expect(summary.errors).toBe(0);
      expect(summary.warnings).toBe(0);
      expect(summary.today).toBe(0);
    });
  });
});
