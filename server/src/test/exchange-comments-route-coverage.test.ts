import express, { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    transaction: vi.fn(),
  },
  createNotification: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 1, email: 'test@example.com', isAdmin: false };
    next();
  },
}));

vi.mock('../config/database', () => ({ db: mocks.db }));

vi.mock('../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../services/notification-service', () => ({
  createNotification: mocks.createNotification,
}));

vi.mock('drizzle-orm', () => {
  const sqlFn = Object.assign(
    (..._args: unknown[]) => ({}),
    { raw: (..._args: unknown[]) => ({}) },
  );
  return {
    eq: vi.fn(() => ({})),
    and: vi.fn(() => ({})),
    or: vi.fn(() => ({})),
    asc: vi.fn(() => ({})),
    desc: vi.fn(() => ({})),
    sql: sqlFn,
  };
});

vi.mock('../utils/db-utils', () => ({
  rowCount: {},
}));

vi.mock('../db/schema', () => ({
  exchangeProposals: { id: 'id', pharmacyAId: 'pharmacyAId', pharmacyBId: 'pharmacyBId' },
  pharmacies: { id: 'id', name: 'name' },
  proposalComments: {
    id: 'id', proposalId: 'proposalId', authorPharmacyId: 'authorPharmacyId',
    body: 'body', isDeleted: 'isDeleted', createdAt: 'createdAt', updatedAt: 'updatedAt',
  },
}));

import exchangeCommentsRouter from '../routes/exchange-comments';

/**
 * Build a chainable query mock where every chain method returns itself,
 * and the terminal (limit or offset) resolves with the given result.
 *
 * The route uses: db.select({...}).from(table).where(cond).limit(1)
 * So db.select() must return an object with .from() -> .where() -> .limit() -> Promise
 */
function chainableSelect(result: unknown) {
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ['from', 'innerJoin', 'where', 'orderBy', 'offset']) {
    q[m] = vi.fn().mockReturnValue(q);
  }
  // limit is the terminal — returns a resolved promise (thenable)
  q.limit = vi.fn().mockReturnValue(Promise.resolve(result));
  return q;
}

function createApp() {
  const app = express();
  app.use(express.json());
  // The exchange-comments router doesn't apply requireLogin itself;
  // the parent exchange.ts router does. Set req.user manually.
  app.use((req: Request & { user?: { id: number; email: string; isAdmin: boolean } }, _res: Response, next: NextFunction) => {
    req.user = { id: 1, email: 'test@example.com', isAdmin: false };
    next();
  });
  app.use('/api/exchanges', exchangeCommentsRouter);
  return app;
}

function createAdminApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request & { user?: { id: number; email: string; isAdmin: boolean } }, _res: Response, next: NextFunction) => {
    req.user = { id: 1, email: 'admin@example.com', isAdmin: true };
    next();
  });
  app.use('/api/exchanges', exchangeCommentsRouter);
  return app;
}

describe('exchange-comments routes — coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /proposals/:id/comments', () => {
    it('creates a comment successfully', async () => {
      const app = createApp();
      const proposal = { id: 1, pharmacyAId: 1, pharmacyBId: 2 };

      // db.select({...}).from(...).where(...).limit(1)
      mocks.db.select.mockReturnValueOnce(chainableSelect([proposal]));

      const savedComment = {
        id: 10, proposalId: 1, authorPharmacyId: 1,
        body: 'テストコメント', isDeleted: false,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      };

      mocks.db.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txSelectChain = chainableSelect([]);
        const txMock = {
          execute: vi.fn().mockResolvedValue(undefined),
          select: vi.fn().mockReturnValue(txSelectChain),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([savedComment]),
            }),
          }),
        };
        return fn(txMock);
      });

      mocks.createNotification.mockResolvedValue(true);

      const res = await request(app)
        .post('/api/exchanges/proposals/1/comments')
        .send({ body: 'テストコメント' });

      expect(res.status).toBe(201);
      expect(res.body.message).toContain('コメントを投稿');
      expect(res.body.comment.body).toBe('テストコメント');
    });

    it('returns 404 when proposal not found', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValueOnce(chainableSelect([]));

      const res = await request(app)
        .post('/api/exchanges/proposals/999/comments')
        .send({ body: 'テスト' });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('マッチングが見つかりません');
    });

    it('returns 403 when admin tries to post', async () => {
      const app = createAdminApp();
      const proposal = { id: 1, pharmacyAId: 1, pharmacyBId: 2 };
      mocks.db.select.mockReturnValueOnce(chainableSelect([proposal]));

      const res = await request(app)
        .post('/api/exchanges/proposals/1/comments')
        .send({ body: 'テスト' });

      expect(res.status).toBe(403);
    });

    it('returns 400 for empty body', async () => {
      const app = createApp();
      const proposal = { id: 1, pharmacyAId: 1, pharmacyBId: 2 };
      mocks.db.select.mockReturnValueOnce(chainableSelect([proposal]));

      const res = await request(app)
        .post('/api/exchanges/proposals/1/comments')
        .send({ body: '' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('コメント本文を入力');
    });

    it('returns 400 for too long body', async () => {
      const app = createApp();
      const proposal = { id: 1, pharmacyAId: 1, pharmacyBId: 2 };
      mocks.db.select.mockReturnValueOnce(chainableSelect([proposal]));

      const res = await request(app)
        .post('/api/exchanges/proposals/1/comments')
        .send({ body: 'a'.repeat(1001) });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('1000文字以内');
    });

    it('returns 429 for short interval rate limit', async () => {
      const app = createApp();
      const proposal = { id: 1, pharmacyAId: 1, pharmacyBId: 2 };
      mocks.db.select.mockReturnValueOnce(chainableSelect([proposal]));

      mocks.db.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txSelectChain = chainableSelect([{
          body: 'previous comment',
          createdAt: new Date().toISOString(),
        }]);
        const txMock = {
          execute: vi.fn().mockResolvedValue(undefined),
          select: vi.fn().mockReturnValue(txSelectChain),
        };
        return fn(txMock);
      });

      const res = await request(app)
        .post('/api/exchanges/proposals/1/comments')
        .send({ body: 'new comment' });

      expect(res.status).toBe(429);
      expect(res.body.error).toContain('短時間での連続投稿');
    });

    it('returns 429 for duplicate body', async () => {
      const app = createApp();
      const proposal = { id: 1, pharmacyAId: 1, pharmacyBId: 2 };
      mocks.db.select.mockReturnValueOnce(chainableSelect([proposal]));

      const thirtySecsAgo = new Date(Date.now() - 30_000).toISOString();
      mocks.db.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const txSelectChain = chainableSelect([{
          body: 'duplicate body',
          createdAt: thirtySecsAgo,
        }]);
        const txMock = {
          execute: vi.fn().mockResolvedValue(undefined),
          select: vi.fn().mockReturnValue(txSelectChain),
        };
        return fn(txMock);
      });

      const res = await request(app)
        .post('/api/exchanges/proposals/1/comments')
        .send({ body: 'duplicate body' });

      expect(res.status).toBe(429);
      expect(res.body.error).toContain('同じ内容の連続投稿');
    });

    it('returns 400 for invalid proposal id', async () => {
      const app = createApp();

      const res = await request(app)
        .post('/api/exchanges/proposals/abc/comments')
        .send({ body: 'test' });

      expect(res.status).toBe(400);
    });

    it('returns 500 on unexpected error', async () => {
      const app = createApp();
      // Use mockImplementation to throw synchronously in the select chain
      mocks.db.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('DB error')),
          }),
        }),
      });

      const res = await request(app)
        .post('/api/exchanges/proposals/1/comments')
        .send({ body: 'test' });

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('コメント投稿に失敗');
    });
  });

  describe('GET /proposals/:id/comments', () => {
    it('returns paginated comments', async () => {
      const app = createApp();
      const proposal = { id: 1, pharmacyAId: 1, pharmacyBId: 2 };

      // First select: proposal lookup
      const proposalChain = chainableSelect([proposal]);
      // Second select: comments list (with offset as terminal)
      const commentsChain: Record<string, ReturnType<typeof vi.fn>> = {};
      for (const m of ['from', 'innerJoin', 'where', 'orderBy']) {
        commentsChain[m] = vi.fn().mockReturnValue(commentsChain);
      }
      commentsChain.limit = vi.fn().mockReturnValue(commentsChain);
      commentsChain.offset = vi.fn().mockResolvedValue([
        { id: 1, proposalId: 1, authorPharmacyId: 1, authorName: 'テスト薬局', body: 'こんにちは', isDeleted: false, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ]);

      // Third select: count
      const countChain: Record<string, ReturnType<typeof vi.fn>> = {};
      countChain.from = vi.fn().mockReturnValue(countChain);
      countChain.where = vi.fn().mockResolvedValue([{ count: 1 }]);

      mocks.db.select
        .mockReturnValueOnce(proposalChain)
        .mockReturnValueOnce(commentsChain)
        .mockReturnValueOnce(countChain);

      const res = await request(app)
        .get('/api/exchanges/proposals/1/comments');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].body).toBe('こんにちは');
      expect(res.body.pagination).toBeDefined();
    });

    it('returns deleted comment with placeholder text', async () => {
      const app = createApp();
      const proposal = { id: 1, pharmacyAId: 1, pharmacyBId: 2 };

      const proposalChain = chainableSelect([proposal]);
      const commentsChain: Record<string, ReturnType<typeof vi.fn>> = {};
      for (const m of ['from', 'innerJoin', 'where', 'orderBy']) {
        commentsChain[m] = vi.fn().mockReturnValue(commentsChain);
      }
      commentsChain.limit = vi.fn().mockReturnValue(commentsChain);
      commentsChain.offset = vi.fn().mockResolvedValue([
        { id: 1, proposalId: 1, authorPharmacyId: 1, authorName: 'テスト薬局', body: 'original', isDeleted: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ]);

      const countChain: Record<string, ReturnType<typeof vi.fn>> = {};
      countChain.from = vi.fn().mockReturnValue(countChain);
      countChain.where = vi.fn().mockResolvedValue([{ count: 1 }]);

      mocks.db.select
        .mockReturnValueOnce(proposalChain)
        .mockReturnValueOnce(commentsChain)
        .mockReturnValueOnce(countChain);

      const res = await request(app)
        .get('/api/exchanges/proposals/1/comments');

      expect(res.status).toBe(200);
      expect(res.body.data[0].body).toBe('（削除済み）');
    });

    it('returns 404 when proposal not found on GET', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValueOnce(chainableSelect([]));

      const res = await request(app)
        .get('/api/exchanges/proposals/999/comments');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('マッチングが見つかりません');
    });

    it('returns 400 for invalid proposal id on GET', async () => {
      const app = createApp();

      const res = await request(app)
        .get('/api/exchanges/proposals/abc/comments');

      expect(res.status).toBe(400);
    });

    it('returns 500 on database error for GET', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('DB error')),
          }),
        }),
      });

      const res = await request(app)
        .get('/api/exchanges/proposals/1/comments');

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('コメント一覧の取得に失敗');
    });
  });

  describe('PATCH /proposals/:id/comments/:commentId', () => {
    it('updates comment successfully', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValueOnce(chainableSelect([{
        id: 10, proposalId: 1, isDeleted: false,
      }]));
      mocks.db.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      });

      const res = await request(app)
        .patch('/api/exchanges/proposals/1/comments/10')
        .send({ body: '更新コメント' });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('コメントを更新');
    });

    it('returns 404 when comment not found', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValueOnce(chainableSelect([]));

      const res = await request(app)
        .patch('/api/exchanges/proposals/1/comments/999')
        .send({ body: '更新' });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('コメントが見つかりません');
    });

    it('returns 400 when editing deleted comment', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValueOnce(chainableSelect([{
        id: 10, proposalId: 1, isDeleted: true,
      }]));

      const res = await request(app)
        .patch('/api/exchanges/proposals/1/comments/10')
        .send({ body: '更新' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('削除済みコメントは編集できません');
    });

    it('returns 400 for empty body on edit', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValueOnce(chainableSelect([{
        id: 10, proposalId: 1, isDeleted: false,
      }]));

      const res = await request(app)
        .patch('/api/exchanges/proposals/1/comments/10')
        .send({ body: '' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('コメント本文を入力');
    });

    it('returns 400 for too long body on edit', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValueOnce(chainableSelect([{
        id: 10, proposalId: 1, isDeleted: false,
      }]));

      const res = await request(app)
        .patch('/api/exchanges/proposals/1/comments/10')
        .send({ body: 'x'.repeat(1001) });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('1000文字以内');
    });

    it('returns 403 when admin tries to edit', async () => {
      const app = createAdminApp();

      const res = await request(app)
        .patch('/api/exchanges/proposals/1/comments/10')
        .send({ body: '更新' });

      expect(res.status).toBe(403);
    });

    it('returns 400 for invalid comment id', async () => {
      const app = createApp();

      const res = await request(app)
        .patch('/api/exchanges/proposals/1/comments/abc')
        .send({ body: 'test' });

      expect(res.status).toBe(400);
    });

    it('returns 500 on database error', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('DB error')),
          }),
        }),
      });

      const res = await request(app)
        .patch('/api/exchanges/proposals/1/comments/10')
        .send({ body: 'test' });

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('コメント更新に失敗');
    });
  });

  describe('DELETE /proposals/:id/comments/:commentId', () => {
    it('deletes comment successfully (soft delete)', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValueOnce(chainableSelect([{
        id: 10, proposalId: 1, isDeleted: false,
      }]));
      mocks.db.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      });

      const res = await request(app)
        .delete('/api/exchanges/proposals/1/comments/10');

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('コメントを削除');
    });

    it('returns 404 when comment not found for delete', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValueOnce(chainableSelect([]));

      const res = await request(app)
        .delete('/api/exchanges/proposals/1/comments/999');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('コメントが見つかりません');
    });

    it('returns 400 when trying to delete already deleted comment', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValueOnce(chainableSelect([{
        id: 10, proposalId: 1, isDeleted: true,
      }]));

      const res = await request(app)
        .delete('/api/exchanges/proposals/1/comments/10');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('既に削除済み');
    });

    it('returns 403 when admin tries to delete', async () => {
      const app = createAdminApp();

      const res = await request(app)
        .delete('/api/exchanges/proposals/1/comments/10');

      expect(res.status).toBe(403);
    });

    it('returns 500 on database error', async () => {
      const app = createApp();
      mocks.db.select.mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('DB error')),
          }),
        }),
      });

      const res = await request(app)
        .delete('/api/exchanges/proposals/1/comments/10');

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('コメント削除に失敗');
    });
  });
});
