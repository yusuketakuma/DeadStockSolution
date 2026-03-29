import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  countAllUnread,
  countUnreadNotifications,
  countUnreadComments,
  countUnreadAdminMessages,
  countUnreadProposals,
  countUnreadFeedback,
  countUnreadExpiryRisk,
  countUnreadUploads,
  countUnreadExchangeHistory,
} from '../services/timeline-unread-counts';

// --- DB モックヘルパー ---

/** select().from().where()/join のチェーンモック（COUNT クエリ用） */
function makeMockDb(countResult: number) {
  const where = vi.fn().mockResolvedValue([{ count: countResult }]);
  const joinChain = { where };
  const fromChain = {
    where,
    leftJoin: vi.fn().mockReturnValue(joinChain),
    innerJoin: vi.fn().mockReturnValue(joinChain),
  };

  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue(fromChain),
    }),
    update: vi.fn(),
  };
}

type MockDb = ReturnType<typeof makeMockDb>;

function flattenSqlChunks(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(flattenSqlChunks).join('');
  if (value && typeof value === 'object') {
    if ('value' in value) {
      return flattenSqlChunks((value as { value: unknown }).value);
    }
    if ('queryChunks' in value) {
      return flattenSqlChunks((value as { queryChunks: unknown }).queryChunks);
    }
  }
  return '';
}

describe('timeline-unread-counts', () => {
  const pharmacyId = 1;
  const lastViewed = '2026-01-15T00:00:00.000Z';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- countUnreadNotifications ---

  it('countUnreadNotifications: COUNT 結果を返す', async () => {
    const db = makeMockDb(5) as MockDb;
    const count = await countUnreadNotifications(db, pharmacyId, lastViewed);
    expect(count).toBe(5);
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('countUnreadNotifications: lastViewed が null の場合も動作する', async () => {
    const db = makeMockDb(3) as MockDb;
    const count = await countUnreadNotifications(db, pharmacyId, null);
    expect(count).toBe(3);
  });

  it('countUnreadNotifications: 空結果で 0 を返す', async () => {
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
      update: vi.fn(),
    } as MockDb;
    const count = await countUnreadNotifications(db, pharmacyId, lastViewed);
    expect(count).toBe(0);
  });

  // --- countUnreadComments ---

  it('countUnreadComments: COUNT 結果を返す', async () => {
    const db = makeMockDb(4) as MockDb;
    const count = await countUnreadComments(db, pharmacyId, lastViewed);
    expect(count).toBe(4);
  });

  it('countUnreadComments: exchangeProposals と結合して参加中提案のみ対象にする', async () => {
    const where = vi.fn().mockResolvedValue([{ count: 2 }]);
    const innerJoin = vi.fn().mockReturnValue({ where });
    const from = vi.fn().mockReturnValue({ innerJoin, where, leftJoin: vi.fn() });
    const db = {
      select: vi.fn().mockReturnValue({ from }),
      update: vi.fn(),
    } as unknown as MockDb;

    const count = await countUnreadComments(db, pharmacyId, lastViewed);

    expect(count).toBe(2);
    expect(from).toHaveBeenCalledTimes(1);
    expect(innerJoin).toHaveBeenCalledTimes(1);
    expect(where).toHaveBeenCalledTimes(1);
  });

  it('countUnreadComments: lastViewed が null の場合も動作する', async () => {
    const db = makeMockDb(1) as MockDb;
    const count = await countUnreadComments(db, pharmacyId, null);
    expect(count).toBe(1);
  });

  // --- countUnreadAdminMessages ---

  it('countUnreadAdminMessages: LEFT JOIN で COUNT 結果を返す', async () => {
    const db = makeMockDb(3) as MockDb;
    const count = await countUnreadAdminMessages(db, pharmacyId, lastViewed);
    expect(count).toBe(3);
  });

  it('countUnreadAdminMessages: lastViewed が null の場合も動作する', async () => {
    const db = makeMockDb(1) as MockDb;
    const count = await countUnreadAdminMessages(db, pharmacyId, null);
    expect(count).toBe(1);
  });

  // --- countUnreadProposals ---

  it('countUnreadProposals: lastViewed以降のCOUNTを返す', async () => {
    const db = makeMockDb(7) as MockDb;
    const count = await countUnreadProposals(db, pharmacyId, null);
    expect(count).toBe(7);
  });

  // --- countUnreadFeedback ---

  it('countUnreadFeedback: lastViewed以降のCOUNTを返す', async () => {
    const db = makeMockDb(2) as MockDb;
    const count = await countUnreadFeedback(db, pharmacyId, null);
    expect(count).toBe(2);
  });

  // --- countUnreadExpiryRisk ---

  it('countUnreadExpiryRisk: 期限リスク条件付き COUNT を返す', async () => {
    const db = makeMockDb(3) as MockDb;
    const count = await countUnreadExpiryRisk(db, pharmacyId);
    expect(count).toBe(3);
  });

  // --- countUnreadUploads ---

  it('countUnreadUploads: lastViewed より新しいアップロードをカウント', async () => {
    const db = makeMockDb(2) as MockDb;
    const count = await countUnreadUploads(db, pharmacyId, lastViewed);
    expect(count).toBe(2);
  });

  it('countUnreadUploads: lastViewed が null の場合は 0 を返す', async () => {
    const db = makeMockDb(99) as MockDb;
    const count = await countUnreadUploads(db, pharmacyId, null);
    expect(count).toBe(0);
    // DB クエリは発行されない
    expect(db.select).not.toHaveBeenCalled();
  });

  // --- countUnreadExchangeHistory ---

  it('countUnreadExchangeHistory: lastViewed より新しい履歴をカウント', async () => {
    const db = makeMockDb(1) as MockDb;
    const count = await countUnreadExchangeHistory(db, pharmacyId, lastViewed);
    expect(count).toBe(1);
  });

  it('countUnreadExchangeHistory: lastViewed が null の場合は 0 を返す', async () => {
    const db = makeMockDb(99) as MockDb;
    const count = await countUnreadExchangeHistory(db, pharmacyId, null);
    expect(count).toBe(0);
    expect(db.select).not.toHaveBeenCalled();
  });

  // --- countAllUnread ---

  it('countAllUnread: 単一クエリで全テーブルの合計 COUNT を返す', async () => {
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ total: 15 }]),
        }),
      }),
      update: vi.fn(),
    } as MockDb;
    const count = await countAllUnread(db, pharmacyId);
    expect(count).toBe(15);
    // DB クエリは1回のみ（ラウンドトリップ削減を確認）
    expect(db.select).toHaveBeenCalledTimes(1);
  });

  it('countAllUnread: 空結果で 0 を返す', async () => {
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
      update: vi.fn(),
    } as MockDb;
    const count = await countAllUnread(db, pharmacyId);
    expect(count).toBe(0);
  });

  it('countAllUnread: total が 0 の場合は 0 を返す', async () => {
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ total: 0 }]),
        }),
      }),
      update: vi.fn(),
    } as MockDb;
    const count = await countAllUnread(db, pharmacyId);
    expect(count).toBe(0);
  });

  it('countAllUnread: upload_confirm_jobs を参照してアップロード未読数を集計する', async () => {
    const select = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ total: 0 }]),
      }),
    });
    const db = {
      select,
      update: vi.fn(),
    } as MockDb;

    await countAllUnread(db, pharmacyId);

    const projection = select.mock.calls[0]?.[0] as { total?: unknown } | undefined;
    const sqlText = flattenSqlChunks(projection?.total);
    expect(sqlText).toContain('FROM upload_confirm_jobs');
    expect(sqlText).not.toContain('FROM uploads');
  });
});
