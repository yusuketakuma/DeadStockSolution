/**
 * push-subscription-service.test.ts
 * TDD: プッシュ購読管理サービスのテスト
 * - subscribe: 購読登録（upsert + デバイス上限10件）
 * - unsubscribe: 購読解除
 * - listSubscriptions: 購読一覧
 * - cleanupStale: 古い購読の削除
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── vi.hoisted でモック定義 ──
const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
  },
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../config/database', () => ({ db: mocks.db }));
vi.mock('../services/logger', () => ({ logger: mocks.logger }));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => ({ _tag: 'eq', args })),
  and: vi.fn((...args: unknown[]) => ({ _tag: 'and', args })),
  asc: vi.fn((...args: unknown[]) => ({ _tag: 'asc', args })),
  lt: vi.fn((...args: unknown[]) => ({ _tag: 'lt', args })),
  isNull: vi.fn((...args: unknown[]) => ({ _tag: 'isNull', args })),
  or: vi.fn((...args: unknown[]) => ({ _tag: 'or', args })),
  count: vi.fn(() => ({ _tag: 'count' })),
}));

import {
  subscribe,
  unsubscribe,
  listSubscriptions,
  cleanupStale,
  MAX_SUBSCRIPTIONS_PER_PHARMACY,
} from '../services/push-subscription-service';

const makeRecord = (id: number, pharmacyId: number, endpoint: string) => ({
  id,
  pharmacyId,
  endpoint,
  p256dh: `p256dh-key-${id}`,
  auth: `auth-key-${id}`,
  userAgent: 'TestBrowser/1.0',
  createdAt: '2025-01-01T00:00:00.000Z',
  lastUsedAt: null,
});

describe('push-subscription-service', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ── Drizzle クエリのチェーンモック ──
  function setupSelectMock(rows: unknown[]) {
    const where = vi.fn().mockResolvedValue(rows);
    const orderBy = vi.fn().mockReturnValue(rows);
    const from = vi.fn().mockReturnValue({ where, orderBy });
    mocks.db.select.mockReturnValue({ from });
    return { from, where, orderBy };
  }

  function setupSelectChainMock(rowsSets: unknown[][]) {
    let callIdx = 0;
    mocks.db.select.mockImplementation(() => {
      const rows = rowsSets[callIdx] ?? [];
      callIdx++;
      const orderBy = vi.fn().mockResolvedValue(rows);
      const where = vi.fn().mockReturnValue({ orderBy });
      const from = vi.fn().mockReturnValue({ where });
      return { from };
    });
  }

  function setupInsertMock(returnRows: unknown[]) {
    const returning = vi.fn().mockResolvedValue(returnRows);
    const onConflictDoUpdate = vi.fn().mockReturnValue({ returning });
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate, returning });
    mocks.db.insert.mockReturnValue({ values });
    return { values, onConflictDoUpdate, returning };
  }

  function setupDeleteMock(returnRows: unknown[] = []) {
    const returning = vi.fn().mockResolvedValue(returnRows);
    const where = vi.fn().mockReturnValue({ returning });
    mocks.db.delete.mockReturnValue({ where });
    return { where, returning };
  }

  function setupUpdateMock() {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    mocks.db.update.mockReturnValue({ set });
    return { set, where };
  }

  // ── subscribe ──────────────────────────────────

  describe('subscribe', () => {
    it('新規登録 → 購読レコードを返す', async () => {
      const payload = {
        endpoint: 'https://push.example.com/sub1',
        keys: { p256dh: 'p256dh-new', auth: 'auth-new' },
      };
      const inserted = {
        id: 1,
        pharmacyId: 10,
        endpoint: payload.endpoint,
        p256dh: payload.keys.p256dh,
        auth: payload.keys.auth,
        userAgent: 'TestBrowser/1.0',
        createdAt: '2025-01-01T00:00:00.000Z',
        lastUsedAt: null,
      };

      // First select: check existing (empty)
      // Second select: count existing subs
      setupSelectChainMock([[], []]);
      setupInsertMock([inserted]);

      const result = await subscribe(10, payload, 'TestBrowser/1.0');

      expect(result).toEqual(inserted);
      expect(mocks.db.insert).toHaveBeenCalledTimes(1);
    });

    it('同一エンドポイントの重複登録 → 更新（upsert）', async () => {
      const existing = makeRecord(1, 10, 'https://push.example.com/sub1');
      const payload = {
        endpoint: 'https://push.example.com/sub1',
        keys: { p256dh: 'p256dh-updated', auth: 'auth-updated' },
      };
      const updated = { ...existing, p256dh: 'p256dh-updated', auth: 'auth-updated' };

      // First select: existing found
      setupSelectMock([existing]);
      const { set } = setupUpdateMock();

      // Mock the update chain to return the updated record
      const returning = vi.fn().mockResolvedValue([updated]);
      set.mockReturnValue({ where: vi.fn().mockReturnValue({ returning }) });

      const result = await subscribe(10, payload);

      expect(result).toEqual(updated);
      expect(mocks.db.update).toHaveBeenCalledTimes(1);
      expect(mocks.db.insert).not.toHaveBeenCalled();
    });

    it('11件目の登録 → 最も古い購読を削除してから登録', async () => {
      const payload = {
        endpoint: 'https://push.example.com/sub-new',
        keys: { p256dh: 'p256dh-new', auth: 'auth-new' },
      };

      // 10件の既存購読
      const existingSubs = Array.from({ length: 10 }, (_, i) =>
        makeRecord(i + 1, 10, `https://push.example.com/sub${i + 1}`),
      );

      const inserted = {
        id: 11,
        pharmacyId: 10,
        endpoint: payload.endpoint,
        p256dh: payload.keys.p256dh,
        auth: payload.keys.auth,
        userAgent: null,
        createdAt: '2025-01-01T00:00:00.000Z',
        lastUsedAt: null,
      };

      // First select: no existing match
      // Second select: 10 existing subs (ordered by createdAt asc)
      setupSelectChainMock([[], existingSubs]);
      setupDeleteMock();
      setupInsertMock([inserted]);

      const result = await subscribe(10, payload);

      expect(result).toEqual(inserted);
      // Should delete the oldest subscription
      expect(mocks.db.delete).toHaveBeenCalledTimes(1);
      expect(mocks.db.insert).toHaveBeenCalledTimes(1);
    });

    it('MAX_SUBSCRIPTIONS_PER_PHARMACY は 10', () => {
      expect(MAX_SUBSCRIPTIONS_PER_PHARMACY).toBe(10);
    });
  });

  // ── unsubscribe ──────────────────────────────────

  describe('unsubscribe', () => {
    it('存在する購読を削除 → true', async () => {
      const existing = makeRecord(1, 10, 'https://push.example.com/sub1');
      setupDeleteMock([existing]);

      const result = await unsubscribe(10, 'https://push.example.com/sub1');

      expect(result).toBe(true);
      expect(mocks.db.delete).toHaveBeenCalledTimes(1);
    });

    it('存在しない購読 → false', async () => {
      setupDeleteMock([]);

      const result = await unsubscribe(10, 'https://push.example.com/nonexistent');

      expect(result).toBe(false);
      expect(mocks.db.delete).toHaveBeenCalledTimes(1);
    });
  });

  // ── listSubscriptions ──────────────────────────────────

  describe('listSubscriptions', () => {
    it('購読一覧を返す', async () => {
      const subs = [
        makeRecord(1, 10, 'https://push.example.com/sub1'),
        makeRecord(2, 10, 'https://push.example.com/sub2'),
      ];
      setupSelectMock(subs);

      const result = await listSubscriptions(10);

      expect(result).toHaveLength(2);
      expect(result[0].endpoint).toBe('https://push.example.com/sub1');
      expect(mocks.db.select).toHaveBeenCalledTimes(1);
    });

    it('購読が0件 → 空配列', async () => {
      setupSelectMock([]);

      const result = await listSubscriptions(10);

      expect(result).toEqual([]);
    });
  });

  // ── cleanupStale ──────────────────────────────────

  describe('cleanupStale', () => {
    it('古い購読を削除 → 削除件数を返す', async () => {
      const staleRecords = [
        makeRecord(1, 10, 'https://push.example.com/stale1'),
        makeRecord(2, 20, 'https://push.example.com/stale2'),
      ];
      const returning = vi.fn().mockResolvedValue(staleRecords);
      const where = vi.fn().mockReturnValue({ returning });
      mocks.db.delete.mockReturnValue({ where });

      const result = await cleanupStale();

      expect(result).toBe(2);
      expect(mocks.db.delete).toHaveBeenCalledTimes(1);
      expect(mocks.logger.info).toHaveBeenCalled();
    });

    it('古い購読がない → 0', async () => {
      const returning = vi.fn().mockResolvedValue([]);
      const where = vi.fn().mockReturnValue({ returning });
      mocks.db.delete.mockReturnValue({ where });

      const result = await cleanupStale();

      expect(result).toBe(0);
    });
  });
});
