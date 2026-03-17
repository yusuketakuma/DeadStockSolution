import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
  },
  invalidateDashboardUnreadCache: vi.fn(),
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/notification-service', () => ({
  invalidateDashboardUnreadCache: mocks.invalidateDashboardUnreadCache,
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => ({ _and: args })),
  eq: vi.fn((a: unknown, b: unknown) => ({ _eq: [a, b] })),
  desc: vi.fn((col: unknown) => ({ _desc: col })),
  isNull: vi.fn((col: unknown) => ({ _isNull: col })),
  isNotNull: vi.fn((col: unknown) => ({ _isNotNull: col })),
  sql: vi.fn(),
  count: vi.fn(() => 'count_col'),
}));

import {
  listAlerts,
  getAlertDetail,
  resolveAlert,
  getAlertStats,
} from '../services/alert-read-service';

// ── ヘルパー ──────────────────────────────────

function createSelectWhereResult(result: unknown) {
  const where = vi.fn().mockResolvedValue(result);
  const from = vi.fn().mockReturnValue({ where });
  return { from, where };
}

function createSelectOrderLimitOffsetResult(result: unknown) {
  const offset = vi.fn().mockResolvedValue(result);
  const limit = vi.fn().mockReturnValue({ offset });
  const orderBy = vi.fn().mockReturnValue({ limit });
  const where = vi.fn().mockReturnValue({ orderBy });
  const from = vi.fn().mockReturnValue({ where });
  return { from, where, orderBy, limit, offset };
}

function createUpdateReturningResult(result: unknown) {
  const returning = vi.fn().mockResolvedValue(result);
  const where = vi.fn().mockReturnValue({ returning });
  const set = vi.fn().mockReturnValue({ where });
  return { set, where, returning };
}

function createUpdateWhereResult(result: unknown) {
  const where = vi.fn().mockResolvedValue(result);
  const set = vi.fn().mockReturnValue({ where });
  return { set, where };
}

const BASE_ALERT = {
  id: 1,
  pharmacyId: 10,
  alertType: 'near_expiry' as const,
  title: '期限間近アラート',
  message: '5件の在庫が期限間近です',
  detailJson: { items: [] },
  detectedAt: '2025-01-01T00:00:00.000Z',
  resolvedAt: null,
  notificationId: null,
  dedupeKey: 'near_expiry_10',
  createdAt: '2025-01-01T00:00:00.000Z',
};

describe('alert-read-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── listAlerts ──────────────────────────────────

  describe('listAlerts', () => {
    it('未解決アラート一覧を返す', async () => {
      // 1回目: カウントクエリ
      const countChain = createSelectWhereResult([{ value: 3 }]);
      // 2回目: データクエリ
      const dataChain = createSelectOrderLimitOffsetResult([BASE_ALERT, { ...BASE_ALERT, id: 2 }]);

      mocks.db.select
        .mockReturnValueOnce(countChain)
        .mockReturnValueOnce(dataChain);

      const result = await listAlerts(10, { resolved: false, offset: 0, limit: 20 });

      expect(result.total).toBe(3);
      expect(result.alerts).toHaveLength(2);
      expect(result.offset).toBe(0);
      expect(result.limit).toBe(20);
      expect(result.alerts[0].id).toBe(1);
      expect(result.alerts[0].detailJson).toEqual({ items: [] });
    });

    it('alertType フィルタを適用', async () => {
      const countChain = createSelectWhereResult([{ value: 1 }]);
      const dataChain = createSelectOrderLimitOffsetResult([BASE_ALERT]);

      mocks.db.select
        .mockReturnValueOnce(countChain)
        .mockReturnValueOnce(dataChain);

      const result = await listAlerts(10, { resolved: false, type: 'near_expiry', offset: 0, limit: 20 });

      expect(result.total).toBe(1);
      expect(result.alerts).toHaveLength(1);
    });

    it('解決済みフィルタを適用', async () => {
      const resolvedAlert = { ...BASE_ALERT, resolvedAt: '2025-02-01T00:00:00.000Z' };
      const countChain = createSelectWhereResult([{ value: 1 }]);
      const dataChain = createSelectOrderLimitOffsetResult([resolvedAlert]);

      mocks.db.select
        .mockReturnValueOnce(countChain)
        .mockReturnValueOnce(dataChain);

      const result = await listAlerts(10, { resolved: true, offset: 0, limit: 10 });

      expect(result.total).toBe(1);
      expect(result.alerts[0].resolvedAt).toBe('2025-02-01T00:00:00.000Z');
    });

    it('空の結果', async () => {
      const countChain = createSelectWhereResult([{ value: 0 }]);
      const dataChain = createSelectOrderLimitOffsetResult([]);

      mocks.db.select
        .mockReturnValueOnce(countChain)
        .mockReturnValueOnce(dataChain);

      const result = await listAlerts(10, { offset: 0, limit: 20 });

      expect(result.total).toBe(0);
      expect(result.alerts).toEqual([]);
      expect(result.unresolvedCount).toBe(0);
    });
  });

  // ── getAlertDetail ──────────────────────────────────

  describe('getAlertDetail', () => {
    it('アラート詳細を返す', async () => {
      const chain = createSelectWhereResult([BASE_ALERT]);
      mocks.db.select.mockReturnValueOnce(chain);

      const result = await getAlertDetail(1, 10);

      expect(result).toBeDefined();
      expect(result!.id).toBe(1);
      expect(result!.detailJson).toEqual({ items: [] });
    });

    it('存在しないアラートは null を返す', async () => {
      const chain = createSelectWhereResult([]);
      mocks.db.select.mockReturnValueOnce(chain);

      const result = await getAlertDetail(999, 10);

      expect(result).toBeNull();
    });

    it('他薬局のアラートは null を返す', async () => {
      const chain = createSelectWhereResult([]);
      mocks.db.select.mockReturnValueOnce(chain);

      const result = await getAlertDetail(1, 999);

      expect(result).toBeNull();
    });
  });

  // ── resolveAlert ──────────────────────────────────

  describe('resolveAlert', () => {
    it('アラートを解決済みにする', async () => {
      const resolved = { ...BASE_ALERT, resolvedAt: '2025-03-01T00:00:00.000Z' };
      const chain = createUpdateReturningResult([resolved]);
      mocks.db.update.mockReturnValueOnce(chain);

      const result = await resolveAlert(1, 10);

      expect(result).toBeDefined();
      expect(result!.resolvedAt).toBe('2025-03-01T00:00:00.000Z');
    });

    it('linked notification があれば既読化して unread cache を無効化する', async () => {
      const resolved = { ...BASE_ALERT, notificationId: 77, resolvedAt: '2025-03-01T00:00:00.000Z' };
      const alertUpdate = createUpdateReturningResult([resolved]);
      const notificationUpdate = createUpdateWhereResult(undefined);
      mocks.db.update
        .mockReturnValueOnce(alertUpdate)
        .mockReturnValueOnce(notificationUpdate);

      const result = await resolveAlert(1, 10);

      expect(result).toBeDefined();
      expect(mocks.db.update).toHaveBeenCalledTimes(2);
      expect(notificationUpdate.set).toHaveBeenCalledWith(expect.objectContaining({
        isRead: true,
      }));
      expect(mocks.invalidateDashboardUnreadCache).toHaveBeenCalledWith(10);
    });

    it('存在しないアラートは null を返す', async () => {
      const chain = createUpdateReturningResult([]);
      mocks.db.update.mockReturnValueOnce(chain);

      const result = await resolveAlert(999, 10);

      expect(result).toBeNull();
    });
  });

  // ── getAlertStats ──────────────────────────────────

  describe('getAlertStats', () => {
    it('統計情報を返す', async () => {
      // 1回目: 未解決カウント
      const totalChain = createSelectWhereResult([{ value: 5 }]);
      // 2回目: タイプ別カウント
      const byTypeChain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            groupBy: vi.fn().mockResolvedValue([
              { alertType: 'near_expiry', count: 3 },
              { alertType: 'excess_stock', count: 2 },
            ]),
          }),
        }),
      };

      mocks.db.select
        .mockReturnValueOnce(totalChain)
        .mockReturnValueOnce(byTypeChain);

      const result = await getAlertStats(10);

      expect(result.unresolvedCount).toBe(5);
      expect(result.byType).toEqual({
        near_expiry: 3,
        excess_stock: 2,
      });
    });

    it('アラートなしの場合', async () => {
      const totalChain = createSelectWhereResult([{ value: 0 }]);
      const byTypeChain = {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            groupBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      };

      mocks.db.select
        .mockReturnValueOnce(totalChain)
        .mockReturnValueOnce(byTypeChain);

      const result = await getAlertStats(10);

      expect(result.unresolvedCount).toBe(0);
      expect(result.byType).toEqual({});
    });
  });
});
