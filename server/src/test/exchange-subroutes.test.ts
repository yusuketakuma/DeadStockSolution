import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
  acceptProposal: vi.fn(),
  rejectProposal: vi.fn(),
  completeProposal: vi.fn(),
  recalculateTrustScoreForPharmacy: vi.fn(),
  createNotification: vi.fn(),
  writeLog: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 2, email: 'user@example.com', isAdmin: false };
    next();
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/exchange-service', () => ({
  createProposal: vi.fn(),
  acceptProposal: mocks.acceptProposal,
  rejectProposal: mocks.rejectProposal,
  completeProposal: mocks.completeProposal,
}));

vi.mock('../services/matching-service', () => ({
  findMatches: vi.fn(),
}));

vi.mock('../services/matching-refresh-service', () => ({
  processPendingMatchingRefreshJobs: vi.fn(),
}));

vi.mock('../services/trust-score-service', () => ({
  recalculateTrustScoreForPharmacy: mocks.recalculateTrustScoreForPharmacy,
}));

vi.mock('../services/notification-service', () => ({
  createNotification: mocks.createNotification,
}));

vi.mock('../services/log-service', () => ({
  writeLog: mocks.writeLog,
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

vi.mock('../services/logger', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  or: vi.fn(() => ({})),
  lt: vi.fn(() => ({})),
  asc: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));

import exchangeRouter from '../routes/exchange';
import { createAuthenticatedApp } from './helpers/mock-builders';

function createApp() {
  return createAuthenticatedApp('/api/exchange', exchangeRouter);
}

function createLimitQuery(rows: unknown[]) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.limit.mockResolvedValue(rows);
  return query;
}

function createPaginatedQuery(rows: unknown[]) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
    innerJoin: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.offset.mockResolvedValue(rows);
  return query;
}

function createWhereQuery(rows: unknown[]) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockResolvedValue(rows);
  return query;
}

function createJoinWhereQuery(rows: unknown[]) {
  const query = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);
  query.where.mockResolvedValue(rows);
  return query;
}

function createInsertQuery(inserted: unknown) {
  const query = {
    values: vi.fn(),
    returning: vi.fn(),
    onConflictDoUpdate: vi.fn(),
  };
  query.values.mockReturnValue(query);
  query.returning.mockResolvedValue([inserted]);
  query.onConflictDoUpdate.mockResolvedValue(undefined);
  return query;
}

function createUpdateQuery(result: unknown = undefined) {
  const query = {
    set: vi.fn(),
    where: vi.fn(),
  };
  query.set.mockReturnValue(query);
  query.where.mockResolvedValue(result);
  return query;
}

describe('exchange sub-routes: single proposal actions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('POST /proposals/:id/accept returns 200 with confirmed status', async () => {
    const app = createApp();
    mocks.acceptProposal.mockResolvedValue('confirmed');

    const response = await request(app)
      .post('/api/exchange/proposals/5/accept');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: '仮マッチングが確定しました',
      status: 'confirmed',
    });
    expect(mocks.acceptProposal).toHaveBeenCalledWith(5, 2);
  });

  it('POST /proposals/:id/reject returns 200', async () => {
    const app = createApp();
    mocks.rejectProposal.mockResolvedValue(undefined);

    const response = await request(app)
      .post('/api/exchange/proposals/7/reject');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: '仮マッチングを拒否しました' });
    expect(mocks.rejectProposal).toHaveBeenCalledWith(7, 2);
  });

  it('POST /proposals/:id/complete returns 200', async () => {
    const app = createApp();
    mocks.completeProposal.mockResolvedValue(undefined);

    const response = await request(app)
      .post('/api/exchange/proposals/8/complete');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: '交換を完了しました' });
    expect(mocks.completeProposal).toHaveBeenCalledWith(8, 2);
  });

  it('POST /proposals/:id/accept returns 404 for not found', async () => {
    const app = createApp();
    mocks.acceptProposal.mockRejectedValue(new Error('見つかりません'));

    const response = await request(app)
      .post('/api/exchange/proposals/999/accept');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'マッチングが見つかりません' });
  });

  it('POST /proposals/:id/accept returns 409 on stale state', async () => {
    const app = createApp();
    mocks.acceptProposal.mockRejectedValue(new Error('状態が変更された'));

    const response = await request(app)
      .post('/api/exchange/proposals/5/accept');

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: '状態が変更されたため、再読み込みして再試行してください' });
  });
});

describe('exchange sub-routes: bulk action', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('POST /proposals/bulk-action returns summary and item errors', async () => {
    const app = createApp();
    mocks.acceptProposal
      .mockResolvedValueOnce('confirmed')
      .mockRejectedValueOnce(new Error('アクセス権限がありません'));

    const response = await request(app)
      .post('/api/exchange/proposals/bulk-action')
      .send({ action: 'accept', ids: [10, 11] });

    expect(response.status).toBe(200);
    expect(response.body.summary).toEqual({ total: 2, success: 1, failed: 1 });
    expect(response.body.results).toEqual([
      expect.objectContaining({ id: 10, ok: true, status: 'confirmed' }),
      expect.objectContaining({ id: 11, ok: false, error: '対象を処理できませんでした' }),
    ]);
  });

  it('POST /proposals/bulk-action returns 400 for invalid payload', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/exchange/proposals/bulk-action')
      .send({ action: 'invalid', ids: [] });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'action と ids を正しく指定してください' });
  });
});

describe('exchange sub-routes: feedback', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('POST /proposals/:id/feedback returns 201 on valid feedback', async () => {
    const app = createApp();
    const proposal = { id: 10, status: 'completed', pharmacyAId: 2, pharmacyBId: 5 };

    mocks.db.select.mockImplementationOnce(() => createLimitQuery([proposal]));
    mocks.db.insert.mockImplementationOnce(() => createInsertQuery(undefined));
    mocks.recalculateTrustScoreForPharmacy.mockResolvedValue(undefined);

    const response = await request(app)
      .post('/api/exchange/proposals/10/feedback')
      .send({ rating: 4, comment: '良い取引でした' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ message: '取引評価を登録しました' });
    expect(mocks.recalculateTrustScoreForPharmacy).toHaveBeenCalledWith(5);
  });

  it('POST /proposals/:id/feedback returns 400 for invalid id', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/exchange/proposals/abc/feedback')
      .send({ rating: 3 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: '不正なIDです' });
  });

  it('POST /proposals/:id/feedback returns 400 for invalid rating', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/exchange/proposals/10/feedback')
      .send({ rating: 6 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: '評価は1〜5で入力してください' });
  });

  it('POST /proposals/:id/feedback returns 400 for rating below minimum', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/exchange/proposals/10/feedback')
      .send({ rating: 0 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: '評価は1〜5で入力してください' });
  });

  it('POST /proposals/:id/feedback returns 400 for too long comment', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/exchange/proposals/10/feedback')
      .send({ rating: 3, comment: 'x'.repeat(301) });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'コメントは300文字以内で入力してください' });
  });

  it('POST /proposals/:id/feedback returns 404 when proposal not found', async () => {
    const app = createApp();
    mocks.db.select.mockImplementationOnce(() => createLimitQuery([]));

    const response = await request(app)
      .post('/api/exchange/proposals/999/feedback')
      .send({ rating: 3 });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'マッチングが見つかりません' });
  });

  it('POST /proposals/:id/feedback returns 400 for non-completed proposal', async () => {
    const app = createApp();
    const proposal = { id: 10, status: 'proposed', pharmacyAId: 2, pharmacyBId: 5 };
    mocks.db.select.mockImplementationOnce(() => createLimitQuery([proposal]));

    const response = await request(app)
      .post('/api/exchange/proposals/10/feedback')
      .send({ rating: 3 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: '完了済みマッチングのみ評価できます' });
  });

  it('POST /proposals/:id/feedback returns 500 on unexpected error', async () => {
    const app = createApp();
    mocks.db.select.mockImplementationOnce(() => {
      throw new Error('DB connection lost');
    });

    const response = await request(app)
      .post('/api/exchange/proposals/10/feedback')
      .send({ rating: 3 });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: '取引評価の登録に失敗しました' });
  });
});

describe('exchange sub-routes: history', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('GET /history returns paginated exchange history', async () => {
    const app = createApp();
    const historyRows = [
      { id: 1, pharmacyAId: 2, pharmacyBId: 3, completedAt: '2026-02-01' },
      { id: 2, pharmacyAId: 2, pharmacyBId: 4, completedAt: '2026-01-15' },
    ];

    mocks.db.select
      .mockImplementationOnce(() => createPaginatedQuery(historyRows))
      .mockImplementationOnce(() => createWhereQuery([{ count: 2 }]))
      .mockImplementationOnce(() => createWhereQuery([
        { id: 2, name: '自薬局' },
        { id: 3, name: '相手A' },
        { id: 4, name: '相手B' },
      ]));

    const response = await request(app)
      .get('/api/exchange/history')
      .query({ page: 1, limit: 10 });

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data[0]).toEqual(expect.objectContaining({
      id: 1,
      pharmacyAName: '自薬局',
      pharmacyBName: '相手A',
    }));
    expect(response.body.pagination).toEqual(expect.objectContaining({
      page: 1,
      total: 2,
    }));
  });

  it('GET /history returns empty list when no history', async () => {
    const app = createApp();

    mocks.db.select
      .mockImplementationOnce(() => createPaginatedQuery([]))
      .mockImplementationOnce(() => createWhereQuery([{ count: 0 }]));

    const response = await request(app)
      .get('/api/exchange/history');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.pagination.total).toBe(0);
  });

  it('GET /history supports cursor pagination', async () => {
    const app = createApp();
    const cursorPayload = Buffer.from(JSON.stringify({
      completedAt: '2026-02-01T00:00:00.000Z',
      id: 99,
    }), 'utf-8').toString('base64url');

    const historyRows = [
      { id: 10, pharmacyAId: 2, pharmacyBId: 3, completedAt: '2026-01-31T00:00:00.000Z' },
      { id: 9, pharmacyAId: 2, pharmacyBId: 4, completedAt: '2026-01-30T00:00:00.000Z' },
      { id: 8, pharmacyAId: 2, pharmacyBId: 5, completedAt: '2026-01-29T00:00:00.000Z' },
    ];

    mocks.db.select
      .mockImplementationOnce(() => createPaginatedQuery(historyRows))
      .mockImplementationOnce(() => createWhereQuery([
        { id: 2, name: '自薬局' },
        { id: 3, name: '相手A' },
        { id: 4, name: '相手B' },
      ]));

    const response = await request(app)
      .get('/api/exchange/history')
      .query({ cursor: cursorPayload, limit: 2 });

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.pagination).toEqual(expect.objectContaining({
      mode: 'cursor',
      hasMore: true,
      limit: 2,
    }));
    expect(typeof response.body.pagination.nextCursor).toBe('string');
    expect(response.body.pagination.total).toBeUndefined();
    expect(response.body.pagination.totalPages).toBeUndefined();
  });

  it('GET /history returns 400 for invalid cursor', async () => {
    const app = createApp();

    const response = await request(app)
      .get('/api/exchange/history')
      .query({ cursor: 'invalid', limit: 2 });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'cursorが不正です' });
    expect(mocks.db.select).not.toHaveBeenCalled();
  });

  it('GET /history returns 500 on DB error', async () => {
    const app = createApp();
    mocks.db.select.mockImplementationOnce(() => {
      throw new Error('DB error');
    });

    const response = await request(app)
      .get('/api/exchange/history');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: '交換履歴の取得に失敗しました' });
  });
});

describe('exchange sub-routes: comments GET', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('GET /proposals/:id/comments returns paginated comments', async () => {
    const app = createApp();
    const proposal = { id: 1, pharmacyAId: 2, pharmacyBId: 3 };
    const comments = [
      { id: 10, proposalId: 1, authorPharmacyId: 2, authorName: '薬局A', body: 'test comment', isDeleted: false, createdAt: '2026-02-01', updatedAt: '2026-02-01' },
    ];

    mocks.db.select
      .mockImplementationOnce(() => createLimitQuery([proposal]))
      .mockImplementationOnce(() => createPaginatedQuery(comments))
      .mockImplementationOnce(() => createWhereQuery([{ count: 1 }]));

    const response = await request(app)
      .get('/api/exchange/proposals/1/comments');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toEqual(expect.objectContaining({
      id: 10,
      body: 'test comment',
    }));
    expect(response.body.pagination).toEqual(expect.objectContaining({
      total: 1,
    }));
  });

  it('GET /proposals/:id/comments masks deleted comment body', async () => {
    const app = createApp();
    const proposal = { id: 1, pharmacyAId: 2, pharmacyBId: 3 };
    const comments = [
      { id: 11, proposalId: 1, authorPharmacyId: 2, authorName: '薬局A', body: 'secret', isDeleted: true, createdAt: '2026-02-01', updatedAt: '2026-02-01' },
    ];

    mocks.db.select
      .mockImplementationOnce(() => createLimitQuery([proposal]))
      .mockImplementationOnce(() => createPaginatedQuery(comments))
      .mockImplementationOnce(() => createWhereQuery([{ count: 1 }]));

    const response = await request(app)
      .get('/api/exchange/proposals/1/comments');

    expect(response.status).toBe(200);
    expect(response.body.data[0].body).toBe('（削除済み）');
  });

  it('GET /proposals/:id/comments returns 400 for invalid id', async () => {
    const app = createApp();

    const response = await request(app)
      .get('/api/exchange/proposals/abc/comments');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: '不正なIDです' });
  });

  it('GET /proposals/:id/comments returns 404 when proposal not found', async () => {
    const app = createApp();
    mocks.db.select.mockImplementationOnce(() => createLimitQuery([]));

    const response = await request(app)
      .get('/api/exchange/proposals/999/comments');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'マッチングが見つかりません' });
  });

  it('GET /proposals/:id/comments returns 500 on unexpected error', async () => {
    const app = createApp();
    mocks.db.select.mockImplementationOnce(() => {
      throw new Error('connection lost');
    });

    const response = await request(app)
      .get('/api/exchange/proposals/1/comments');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'コメント一覧の取得に失敗しました' });
  });
});

describe('exchange sub-routes: comments POST', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('POST /proposals/:id/comments returns 400 for empty body', async () => {
    const app = createApp();
    const proposal = { id: 1, pharmacyAId: 2, pharmacyBId: 3 };
    mocks.db.select.mockImplementationOnce(() => createLimitQuery([proposal]));

    const response = await request(app)
      .post('/api/exchange/proposals/1/comments')
      .send({ body: '   ' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'コメント本文を入力してください' });
  });

  it('POST /proposals/:id/comments returns 400 for body exceeding 1000 chars', async () => {
    const app = createApp();
    const proposal = { id: 1, pharmacyAId: 2, pharmacyBId: 3 };
    mocks.db.select.mockImplementationOnce(() => createLimitQuery([proposal]));

    const response = await request(app)
      .post('/api/exchange/proposals/1/comments')
      .send({ body: 'x'.repeat(1001) });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'コメントは1000文字以内で入力してください' });
  });

  it('POST /proposals/:id/comments returns 404 when proposal not found', async () => {
    const app = createApp();
    mocks.db.select.mockImplementationOnce(() => createLimitQuery([]));

    const response = await request(app)
      .post('/api/exchange/proposals/999/comments')
      .send({ body: 'コメント' });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'マッチングが見つかりません' });
  });

  it('POST /proposals/:id/comments returns 201 on success', async () => {
    const app = createApp();
    const proposal = { id: 1, pharmacyAId: 2, pharmacyBId: 3 };
    const insertedComment = {
      id: 20,
      proposalId: 1,
      authorPharmacyId: 2,
      body: '新しいコメント',
      isDeleted: false,
      createdAt: '2026-02-28T00:00:00.000Z',
      updatedAt: '2026-02-28T00:00:00.000Z',
    };

    mocks.db.select.mockImplementationOnce(() => createLimitQuery([proposal]));
    mocks.db.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([insertedComment]),
          }),
        }),
      };
      return fn(tx);
    });
    mocks.createNotification.mockResolvedValue(true);

    const response = await request(app)
      .post('/api/exchange/proposals/1/comments')
      .send({ body: '新しいコメント' });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      message: 'コメントを投稿しました',
      comment: insertedComment,
    });
  });

  it('POST /proposals/:id/comments returns 429 on rate limit short interval', async () => {
    const app = createApp();
    const proposal = { id: 1, pharmacyAId: 2, pharmacyBId: 3 };

    mocks.db.select.mockImplementationOnce(() => createLimitQuery([proposal]));
    mocks.db.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn().mockResolvedValue(undefined),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{
                  body: '前回のコメント',
                  createdAt: new Date().toISOString(),
                }]),
              }),
            }),
          }),
        }),
      };
      return fn(tx);
    });

    const response = await request(app)
      .post('/api/exchange/proposals/1/comments')
      .send({ body: '連続投稿' });

    expect(response.status).toBe(429);
    expect(response.body).toEqual({ error: '短時間での連続投稿はできません。少し待ってから投稿してください。' });
  });

  it('POST /proposals/:id/comments returns 500 on unexpected error', async () => {
    const app = createApp();
    const proposal = { id: 1, pharmacyAId: 2, pharmacyBId: 3 };

    mocks.db.select.mockImplementationOnce(() => createLimitQuery([proposal]));
    mocks.db.transaction.mockRejectedValue(new Error('DB crash'));

    const response = await request(app)
      .post('/api/exchange/proposals/1/comments')
      .send({ body: 'コメント' });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'コメント投稿に失敗しました' });
  });
});

describe('exchange sub-routes: proposals print', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('GET /proposals/:id/print returns print payload', async () => {
    const app = createApp();
    const proposal = { id: 8, pharmacyAId: 2, pharmacyBId: 3 };
    const items = [{ id: 50, drugName: '薬A', quantity: 2 }];
    const pharmA = { name: '薬局A', phone: '03-0000-0001', fax: null, address: '東京都', prefecture: '東京都', licenseNumber: 'A-1' };
    const pharmB = { name: '薬局B', phone: '03-0000-0002', fax: null, address: '神奈川県', prefecture: '神奈川県', licenseNumber: 'B-1' };

    mocks.db.select
      .mockImplementationOnce(() => createLimitQuery([proposal]))
      .mockImplementationOnce(() => createJoinWhereQuery(items))
      .mockImplementationOnce(() => createLimitQuery([pharmA]))
      .mockImplementationOnce(() => createLimitQuery([pharmB]));

    const response = await request(app)
      .get('/api/exchange/proposals/8/print');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      proposal,
      items,
      pharmacyA: pharmA,
      pharmacyB: pharmB,
    });
  });

  it('GET /proposals/:id/print returns 404 when proposal not found', async () => {
    const app = createApp();
    mocks.db.select.mockImplementationOnce(() => createLimitQuery([]));

    const response = await request(app)
      .get('/api/exchange/proposals/999/print');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: '提案が見つかりません' });
  });
});

describe('exchange sub-routes: comments mutation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('PATCH /proposals/:id/comments/:commentId updates own comment', async () => {
    const app = createApp();
    mocks.db.select.mockImplementationOnce(() => createLimitQuery([{ id: 20, proposalId: 1, isDeleted: false }]));
    mocks.db.update.mockImplementationOnce(() => createUpdateQuery());

    const response = await request(app)
      .patch('/api/exchange/proposals/1/comments/20')
      .send({ body: '更新コメント' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'コメントを更新しました' });
    expect(mocks.db.update).toHaveBeenCalledTimes(1);
  });

  it('DELETE /proposals/:id/comments/:commentId soft-deletes own comment', async () => {
    const app = createApp();
    mocks.db.select.mockImplementationOnce(() => createLimitQuery([{ id: 20, proposalId: 1, isDeleted: false }]));
    mocks.db.update.mockImplementationOnce(() => createUpdateQuery());

    const response = await request(app)
      .delete('/api/exchange/proposals/1/comments/20');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'コメントを削除しました' });
    expect(mocks.db.update).toHaveBeenCalledTimes(1);
  });
});
