import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
  },
  findMatches: vi.fn(),
  findMatchesBatch: vi.fn(),
  saveMatchSnapshotsBatch: vi.fn(),
  saveMatchSnapshotAndNotifyOnChange: vi.fn(),
  createNotification: vi.fn(),
  splitIntoChunks: vi.fn(),
  getNextRetryIso: vi.fn(),
  getStaleBeforeIso: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../config/database', () => ({ db: mocks.db }));

vi.mock('../services/matching-service', () => ({
  findMatches: mocks.findMatches,
  findMatchesBatch: mocks.findMatchesBatch,
}));

vi.mock('../services/matching-snapshot-service', () => ({
  saveMatchSnapshotsBatch: mocks.saveMatchSnapshotsBatch,
  saveMatchSnapshotAndNotifyOnChange: mocks.saveMatchSnapshotAndNotifyOnChange,
}));

vi.mock('../services/notification-service', () => ({
  createNotification: mocks.createNotification,
}));

vi.mock('../db/materialized-views', () => ({
  refreshDrugAvailabilitySummary: vi.fn(),
}));

vi.mock('../services/logger', () => ({
  logger: mocks.logger,
}));

vi.mock('../middleware/error-handler', () => ({
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  asc: vi.fn(() => ({})),
  count: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  exists: vi.fn(() => ({})),
  gte: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  isNull: vi.fn(() => ({})),
  lt: vi.fn(() => ({})),
  lte: vi.fn(() => ({})),
  max: vi.fn(() => ({})),
  min: vi.fn(() => ({})),
  notInArray: vi.fn(() => ({})),
  or: vi.fn(() => ({})),
  sql: Object.assign(vi.fn(() => ({})), { raw: vi.fn(() => ({})) }),
}));

vi.mock('../utils/number-utils', () => ({
  parseBooleanFlag: vi.fn(() => true),
}));

vi.mock('../utils/job-retry-utils', () => ({
  getNextRetryIso: mocks.getNextRetryIso,
  getStaleBeforeIso: mocks.getStaleBeforeIso,
}));

vi.mock('../utils/array-utils', () => ({
  splitIntoChunks: mocks.splitIntoChunks,
}));

// Import after mocks
import { __testables } from '../services/matching-refresh-service';

const { runSingleRefresh } = __testables;

/**
 * Universal select chain using Proxy — resolves to `rows` when awaited,
 * and any chain method returns a new proxy with the same behavior.
 * Works for any terminal method: .where(), .limit(), .orderBy(), etc.
 */
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

describe('matching-refresh-service: refresh completion notification', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getStaleBeforeIso.mockReturnValue('2026-01-01T00:00:00.000Z');
    mocks.getNextRetryIso.mockReturnValue('2026-02-28T12:00:00.000Z');
    mocks.splitIntoChunks.mockImplementation((arr: unknown[]) => [arr]);

    // db.select discriminates by fields argument:
    //   - fields with 'matchingAutoNotifyEnabled' → fetchNotifyEnabledMap
    //   - fields with 'candidateCount'            → matchCandidateSnapshots query
    //   - otherwise                               → resolveImpactedPharmacyIds (returns [{id:1}])
    mocks.db.select.mockImplementation((fields?: Record<string, unknown>) => {
      const keys = fields ? Object.keys(fields) : [];
      if (keys.includes('matchingAutoNotifyEnabled')) {
        return createUniversalSelectChain([{ id: 1, matchingAutoNotifyEnabled: true }]);
      }
      if (keys.includes('candidateCount')) {
        return createUniversalSelectChain([{ candidateCount: 5 }]);
      }
      // resolveImpactedPharmacyIds or other selects
      return createUniversalSelectChain([{ id: 1 }]);
    });

    mocks.findMatchesBatch.mockResolvedValue(new Map([[1, []]]));
    mocks.saveMatchSnapshotsBatch.mockResolvedValue({ changedCount: 0 });
    mocks.createNotification.mockResolvedValue({ id: 99 });
  });

  describe('runSingleRefresh', () => {
    it('refresh 完了後に createNotification を呼び出すこと', async () => {
      await runSingleRefresh(1, 'dead_stock');

      expect(mocks.createNotification).toHaveBeenCalledOnce();
    });

    it('通知の type が matching_refresh_complete であること', async () => {
      await runSingleRefresh(1, 'dead_stock');

      const [input] = mocks.createNotification.mock.calls[0];
      expect(input.type).toBe('matching_refresh_complete');
    });

    it('通知の pharmacyId が triggerPharmacyId と一致すること', async () => {
      await runSingleRefresh(1, 'dead_stock');

      const [input] = mocks.createNotification.mock.calls[0];
      expect(input.pharmacyId).toBe(1);
    });

    it('通知のタイトルが "マッチング更新完了" であること', async () => {
      await runSingleRefresh(1, 'dead_stock');

      const [input] = mocks.createNotification.mock.calls[0];
      expect(input.title).toBe('マッチング更新完了');
    });

    it('candidateCount が通知メッセージに含まれること', async () => {
      await runSingleRefresh(1, 'dead_stock');

      const [input] = mocks.createNotification.mock.calls[0];
      expect(input.message).toContain('5');
    });

    it('candidateCount が detailJson に含まれること', async () => {
      await runSingleRefresh(1, 'dead_stock');

      const [input] = mocks.createNotification.mock.calls[0];
      expect(input.detailJson).toMatchObject({ candidateCount: 5 });
    });

    it('detailJson に refreshedAt (パース可能な ISO 文字列) が含まれること', async () => {
      await runSingleRefresh(1, 'dead_stock');

      const [input] = mocks.createNotification.mock.calls[0];
      expect(typeof input.detailJson?.refreshedAt).toBe('string');
      const dt = new Date(input.detailJson.refreshedAt);
      expect(Number.isNaN(dt.getTime())).toBe(false);
    });

    it('スナップショット未存在時は candidateCount=0 で通知を作成すること', async () => {
      mocks.db.select.mockImplementation((fields?: Record<string, unknown>) => {
        const keys = fields ? Object.keys(fields) : [];
        if (keys.includes('matchingAutoNotifyEnabled')) {
          return createUniversalSelectChain([{ id: 1, matchingAutoNotifyEnabled: true }]);
        }
        if (keys.includes('candidateCount')) {
          return createUniversalSelectChain([]); // no snapshot
        }
        return createUniversalSelectChain([{ id: 1 }]);
      });

      await runSingleRefresh(1, 'dead_stock');

      const [input] = mocks.createNotification.mock.calls[0];
      expect(input.detailJson?.candidateCount).toBe(0);
      expect(input.message).toContain('0');
    });

    it('一部薬局で失敗した場合は通知を作成せずエラーをスローすること', async () => {
      mocks.findMatchesBatch.mockResolvedValue(null); // forces per-pharmacy fallback
      mocks.findMatches.mockRejectedValue(new Error('match error'));

      await expect(runSingleRefresh(1, 'dead_stock')).rejects.toThrow();
      expect(mocks.createNotification).not.toHaveBeenCalled();
    });
  });
});
