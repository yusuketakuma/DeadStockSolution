import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
  },
  loggerError: vi.fn(),
}));

vi.mock('../config/database', () => ({ db: mocks.db }));
vi.mock('../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: mocks.loggerError },
}));
vi.mock('drizzle-orm', () => ({
  desc: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  and: vi.fn((...args: unknown[]) => args),
  sql: Object.assign((..._args: unknown[]) => ({}), { raw: (..._args: unknown[]) => ({}) }),
}));

import { recordAuditLog, listAuditLogs } from '../services/audit-log-service';

function createInsertQuery(returnRow: unknown) {
  const query = { values: vi.fn(), returning: vi.fn() };
  query.values.mockReturnValue(query);
  query.returning.mockResolvedValue([returnRow]);
  return query;
}

function setupListMocks(rows: unknown[], countRow?: unknown) {
  // rows query (with orderBy/limit/offset)
  const rowsQuery = {
    from: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), offset: vi.fn(),
  };
  rowsQuery.from.mockReturnValue(rowsQuery);
  rowsQuery.where.mockReturnValue(rowsQuery);
  rowsQuery.orderBy.mockReturnValue(rowsQuery);
  rowsQuery.limit.mockReturnValue(rowsQuery);
  rowsQuery.offset.mockResolvedValue(rows);

  // count query (no orderBy/limit/offset, .where is terminal)
  const countQuery = {
    from: vi.fn(), where: vi.fn(),
  };
  countQuery.from.mockReturnValue(countQuery);
  countQuery.where.mockResolvedValue([countRow ?? { count: rows.length }]);

  let callCount = 0;
  mocks.db.select.mockImplementation(() => {
    callCount++;
    return callCount === 1 ? rowsQuery : countQuery;
  });
}

describe('AuditLogService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('recordAuditLog', () => {
    it('監査ログを正常に記録できる', async () => {
      const mockRow = {
        id: 1,
        adminId: 10,
        targetPharmacyId: 20,
        action: 'verify' as const,
        previousStatus: 'pending_verification',
        newStatus: 'verified',
        reason: '承認理由',
        createdAt: '2026-01-01T00:00:00.000Z',
      };
      const insertQuery = createInsertQuery(mockRow);
      mocks.db.insert.mockReturnValue(insertQuery);

      const result = await recordAuditLog({
        adminId: 10,
        targetPharmacyId: 20,
        action: 'verify',
        previousStatus: 'pending_verification',
        newStatus: 'verified',
        reason: '承認理由',
      });

      expect(result).toEqual(mockRow);
      expect(mocks.db.insert).toHaveBeenCalled();
    });

    it('reasonがundefinedの場合nullで記録する', async () => {
      const mockRow = {
        id: 2,
        adminId: 10,
        targetPharmacyId: 20,
        action: 'reject' as const,
        previousStatus: 'pending_verification',
        newStatus: 'rejected',
        reason: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      };
      const insertQuery = createInsertQuery(mockRow);
      mocks.db.insert.mockReturnValue(insertQuery);

      const result = await recordAuditLog({
        adminId: 10,
        targetPharmacyId: 20,
        action: 'reject',
        previousStatus: 'pending_verification',
        newStatus: 'rejected',
      });

      expect(result.reason).toBeNull();
    });

    it('insert結果が空の場合エラーをスローする', async () => {
      const insertQuery = { values: vi.fn(), returning: vi.fn() };
      insertQuery.values.mockReturnValue(insertQuery);
      insertQuery.returning.mockResolvedValue([]);
      mocks.db.insert.mockReturnValue(insertQuery);

      await expect(recordAuditLog({
        adminId: 10,
        targetPharmacyId: 20,
        action: 'verify',
        previousStatus: null,
        newStatus: 'verified',
      })).rejects.toThrow('監査ログの記録に失敗しました');
    });
  });

  describe('listAuditLogs', () => {
    it('デフォルトパラメータでログ一覧を取得できる', async () => {
      const mockRows = [
        {
          id: 1, adminId: 10, targetPharmacyId: 20, action: 'verify' as const,
          previousStatus: 'pending_verification', newStatus: 'verified',
          reason: null, createdAt: '2026-01-01T00:00:00.000Z',
        },
      ];
      setupListMocks(mockRows, { count: 1 });

      const result = await listAuditLogs();

      expect(result.logs).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.offset).toBe(0);
      expect(result.limit).toBe(20);
    });

    it('offset/limitを指定して取得できる', async () => {
      setupListMocks([], { count: 0 });
      const result = await listAuditLogs({ offset: 10, limit: 5 });
      expect(result.offset).toBe(10);
      expect(result.limit).toBe(5);
    });

    it('limitの上限を100に制限する', async () => {
      setupListMocks([], { count: 0 });
      const result = await listAuditLogs({ limit: 999 });
      expect(result.limit).toBe(100);
    });

    it('フィルタ条件を指定して取得できる', async () => {
      setupListMocks([], { count: 0 });
      const result = await listAuditLogs({ adminId: 1, targetPharmacyId: 2, action: 'verify' });
      expect(result.logs).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('DB障害時はエラーをスローしログ出力する', async () => {
      const selectQuery = {
        from: vi.fn(),
        where: vi.fn(),
        orderBy: vi.fn(),
        limit: vi.fn(),
        offset: vi.fn(),
      };
      selectQuery.from.mockReturnValue(selectQuery);
      selectQuery.where.mockReturnValue(selectQuery);
      selectQuery.orderBy.mockReturnValue(selectQuery);
      selectQuery.limit.mockReturnValue(selectQuery);
      selectQuery.offset.mockRejectedValue(new Error('DB error'));
      mocks.db.select.mockReturnValue(selectQuery);

      await expect(listAuditLogs()).rejects.toThrow('DB error');
      expect(mocks.loggerError).toHaveBeenCalled();
    });
  });
});
