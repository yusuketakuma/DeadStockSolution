import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
  handoffToOpenClaw: vi.fn(),
  buildOpenClawLogContext: vi.fn(),
  writeLog: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
  buildProposalTimeline: vi.fn(),
  fetchProposalTimelineActionRows: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 1, email: 'admin@example.com', isAdmin: true };
    next();
  },
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => { next(); },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/openclaw-service', () => ({
  handoffToOpenClaw: mocks.handoffToOpenClaw,
}));

vi.mock('../services/openclaw-log-context-service', () => ({
  buildOpenClawLogContext: mocks.buildOpenClawLogContext,
}));

vi.mock('../services/log-service', () => ({
  writeLog: mocks.writeLog,
  getClientIp: mocks.getClientIp,
}));

vi.mock('../services/proposal-timeline-service', () => ({
  buildProposalTimeline: mocks.buildProposalTimeline,
  fetchProposalTimelineActionRows: mocks.fetchProposalTimelineActionRows,
}));

vi.mock('../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../utils/path-utils', () => ({
  isSafeInternalPath: vi.fn((p: string) => p.startsWith('/')),
}));

vi.mock('express-rate-limit', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
  or: vi.fn(() => ({})),
  asc: vi.fn(() => ({})),
  gte: vi.fn(() => ({})),
  lte: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  isNull: vi.fn(() => ({})),
  exists: vi.fn(() => ({})),
  not: vi.fn(() => ({})),
  ilike: vi.fn(() => ({})),
  count: vi.fn(() => ({})),
  ne: vi.fn(() => ({})),
  lt: vi.fn(() => ({})),
  notInArray: vi.fn(() => ({})),
}));

import adminRouter from '../routes/admin';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  return app;
}

function createPaginatedQuery(rows: unknown[], total: number) {
  let callCount = 0;
  return () => {
    callCount++;
    const query = {
      from: vi.fn(),
      where: vi.fn(),
      orderBy: vi.fn(),
      limit: vi.fn(),
      offset: vi.fn(),
    };
    query.from.mockReturnValue(query);
    query.orderBy.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    if (callCount === 1) {
      query.offset.mockResolvedValue(rows);
    }
    return query;
  };
}

function createCountQuery(total: number) {
  const q = { from: vi.fn() };
  q.from.mockResolvedValue([{ count: total }]);
  return q;
}

function createLimitQuery(result: unknown) {
  const query = { from: vi.fn(), where: vi.fn(), limit: vi.fn() };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.limit.mockResolvedValue(result);
  return query;
}

function createJoinOrderByQuery(rows: unknown[]) {
  const query = { from: vi.fn(), innerJoin: vi.fn(), where: vi.fn(), orderBy: vi.fn() };
  query.from.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockResolvedValue(rows);
  return query;
}

function createInsertQuery() {
  const query = { values: vi.fn() };
  query.values.mockResolvedValue(undefined);
  return query;
}

describe('admin-pharmacies-actions ultra coverage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.writeLog.mockReturnValue(undefined);
    mocks.getClientIp.mockReturnValue('127.0.0.1');
  });

  describe('GET /exchanges', () => {
    it('returns paginated exchanges', async () => {
      const app = createApp();
      const exchangeRows = [{ id: 1 }, { id: 2 }];

      let selectCallNum = 0;
      mocks.db.select.mockImplementation(() => {
        selectCallNum++;
        if (selectCallNum === 1) {
          // Data query
          const q = { from: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), offset: vi.fn() };
          q.from.mockReturnValue(q);
          q.orderBy.mockReturnValue(q);
          q.limit.mockReturnValue(q);
          q.offset.mockResolvedValue(exchangeRows);
          return q;
        }
        // Count query
        return createCountQuery(2);
      });

      const res = await request(app).get('/api/admin/exchanges');
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });

    it('returns 500 on error', async () => {
      const app = createApp();
      mocks.db.select.mockImplementation(() => {
        throw new Error('db error');
      });

      const res = await request(app).get('/api/admin/exchanges');
      expect(res.status).toBe(500);
    });
  });

  describe('GET /exchanges/:proposalId/comments', () => {
    it('returns 400 for invalid proposalId', async () => {
      const app = createApp();
      const res = await request(app).get('/api/admin/exchanges/abc/comments');
      expect(res.status).toBe(400);
    });

    it('returns 404 when proposal not found', async () => {
      const app = createApp();
      mocks.db.select.mockImplementation(() => createLimitQuery([]));

      const res = await request(app).get('/api/admin/exchanges/999/comments');
      expect(res.status).toBe(404);
    });

    it('returns comments with deleted body masked', async () => {
      const app = createApp();
      let selectCall = 0;
      mocks.db.select.mockImplementation(() => {
        selectCall++;
        if (selectCall === 1) {
          return createLimitQuery([{ id: 1 }]);
        }
        return createJoinOrderByQuery([
          { id: 10, proposalId: 1, authorPharmacyId: 2, authorName: 'A薬局', body: '秘密', isDeleted: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
          { id: 11, proposalId: 1, authorPharmacyId: 3, authorName: 'B薬局', body: '公開', isDeleted: false, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        ]);
      });

      const res = await request(app).get('/api/admin/exchanges/1/comments');
      expect(res.status).toBe(200);
      expect(res.body.data[0].body).toBe('（削除済み）');
      expect(res.body.data[1].body).toBe('公開');
    });

    it('returns 500 on error', async () => {
      const app = createApp();
      mocks.db.select.mockImplementation(() => {
        throw new Error('db error');
      });

      const res = await request(app).get('/api/admin/exchanges/1/comments');
      expect(res.status).toBe(500);
    });
  });

  describe('GET /exchanges/:proposalId/timeline', () => {
    it('returns 400 for invalid proposalId', async () => {
      const app = createApp();
      const res = await request(app).get('/api/admin/exchanges/abc/timeline');
      expect(res.status).toBe(400);
    });

    it('returns 404 when proposal not found', async () => {
      const app = createApp();
      mocks.db.select.mockImplementation(() => createLimitQuery([]));

      const res = await request(app).get('/api/admin/exchanges/999/timeline');
      expect(res.status).toBe(404);
    });

    it('returns timeline with default pharmacy name when creator not found', async () => {
      const app = createApp();
      let selectCall = 0;
      mocks.db.select.mockImplementation(() => {
        selectCall++;
        if (selectCall === 1) {
          return createLimitQuery([{ id: 1, pharmacyAId: 10, proposedAt: '2026-01-01' }]);
        }
        // Creator pharmacy lookup - not found
        return createLimitQuery([]);
      });
      mocks.fetchProposalTimelineActionRows.mockResolvedValue([]);
      mocks.buildProposalTimeline.mockReturnValue([]);

      const res = await request(app).get('/api/admin/exchanges/1/timeline');
      expect(res.status).toBe(200);
      expect(mocks.buildProposalTimeline).toHaveBeenCalledWith(expect.objectContaining({
        proposalCreatorName: '提案元薬局',
      }));
    });

    it('returns 500 on error', async () => {
      const app = createApp();
      mocks.db.select.mockImplementation(() => {
        throw new Error('db error');
      });

      const res = await request(app).get('/api/admin/exchanges/1/timeline');
      expect(res.status).toBe(500);
    });
  });

  describe('POST /messages', () => {
    it('returns 400 for invalid targetType', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/messages')
        .send({ targetType: 'invalid', title: 'test', body: 'test body' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('送信対象が不正');
    });

    it('returns 400 when title is empty', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/messages')
        .send({ targetType: 'all', title: '', body: 'test body' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('タイトル');
    });

    it('returns 400 when title exceeds 100 chars', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/messages')
        .send({ targetType: 'all', title: 'a'.repeat(101), body: 'test body' });
      expect(res.status).toBe(400);
    });

    it('returns 400 when body is empty', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/messages')
        .send({ targetType: 'all', title: 'Test', body: '' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('本文');
    });

    it('returns 400 when body exceeds 2000 chars', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/messages')
        .send({ targetType: 'all', title: 'Test', body: 'x'.repeat(2001) });
      expect(res.status).toBe(400);
    });

    it('returns 400 when pharmacy target has invalid id', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/messages')
        .send({ targetType: 'pharmacy', targetPharmacyId: 'abc', title: 'Test', body: 'body' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('薬局ID');
    });

    it('returns 404 when target pharmacy not found', async () => {
      const app = createApp();
      mocks.db.select.mockImplementation(() => createLimitQuery([]));

      const res = await request(app)
        .post('/api/admin/messages')
        .send({ targetType: 'pharmacy', targetPharmacyId: 999, title: 'Test', body: 'body' });
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('薬局が見つかりません');
    });

    it('returns 400 for unsafe actionPath', async () => {
      const app = createApp();
      const { isSafeInternalPath } = await import('../utils/path-utils');
      (isSafeInternalPath as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);

      const res = await request(app)
        .post('/api/admin/messages')
        .send({ targetType: 'all', title: 'Test', body: 'body', actionPath: 'http://evil.com' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('遷移先パス');
    });

    it('sends message to all pharmacies', async () => {
      const app = createApp();
      mocks.db.insert.mockImplementation(() => createInsertQuery());

      const res = await request(app)
        .post('/api/admin/messages')
        .send({ targetType: 'all', title: 'テスト', body: 'テスト本文' });
      expect(res.status).toBe(201);
    });

    it('sends message to specific pharmacy', async () => {
      const app = createApp();
      mocks.db.select.mockImplementation(() => createLimitQuery([{ id: 5 }]));
      mocks.db.insert.mockImplementation(() => createInsertQuery());

      const res = await request(app)
        .post('/api/admin/messages')
        .send({ targetType: 'pharmacy', targetPharmacyId: 5, title: 'テスト', body: 'テスト本文' });
      expect(res.status).toBe(201);
    });

    it('returns 500 on error', async () => {
      const app = createApp();
      mocks.db.insert.mockImplementation(() => {
        throw new Error('db error');
      });

      const res = await request(app)
        .post('/api/admin/messages')
        .send({ targetType: 'all', title: 'テスト', body: 'テスト本文' });
      expect(res.status).toBe(500);
    });
  });

  describe('POST /requests/:id/handoff', () => {
    it('returns 400 for invalid id', async () => {
      const app = createApp();
      const res = await request(app).post('/api/admin/requests/abc/handoff');
      expect(res.status).toBe(400);
    });

    it('returns 404 when request not found', async () => {
      const app = createApp();
      mocks.db.select.mockImplementation(() => createLimitQuery([]));

      const res = await request(app).post('/api/admin/requests/999/handoff');
      expect(res.status).toBe(404);
    });

    it('returns 400 when request is completed', async () => {
      const app = createApp();
      mocks.db.select.mockImplementation(() => createLimitQuery([{
        id: 1, pharmacyId: 2, requestText: 'test', openclawStatus: 'completed',
      }]));

      const res = await request(app).post('/api/admin/requests/1/handoff');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('完了済み');
    });

    it('returns 400 when request is not pending_handoff', async () => {
      const app = createApp();
      mocks.db.select.mockImplementation(() => createLimitQuery([{
        id: 1, pharmacyId: 2, requestText: 'test', openclawStatus: 'in_progress',
      }]));

      const res = await request(app).post('/api/admin/requests/1/handoff');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('連携待ち');
    });

    it('returns 200 on accepted handoff', async () => {
      const app = createApp();
      mocks.db.select.mockImplementation(() => createLimitQuery([{
        id: 1, pharmacyId: 2, requestText: 'test', openclawStatus: 'pending_handoff',
      }]));
      mocks.buildOpenClawLogContext.mockResolvedValue({ operationLogs: [] });
      mocks.handoffToOpenClaw.mockResolvedValue({
        accepted: true,
        connectorConfigured: true,
        implementationBranch: 'main',
        status: 'accepted',
        note: 'OK',
        threadId: 'th_123',
        summary: 'Summary',
      });
      mocks.db.update.mockImplementation(() => ({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      }));

      const res = await request(app).post('/api/admin/requests/1/handoff');
      expect(res.status).toBe(200);
      expect(res.body.handoff.accepted).toBe(true);
    });

    it('returns 202 on non-accepted handoff', async () => {
      const app = createApp();
      mocks.db.select.mockImplementation(() => createLimitQuery([{
        id: 1, pharmacyId: 2, requestText: 'test', openclawStatus: 'pending_handoff',
      }]));
      mocks.buildOpenClawLogContext.mockResolvedValue(undefined);
      mocks.handoffToOpenClaw.mockResolvedValue({
        accepted: false,
        connectorConfigured: false,
        implementationBranch: null,
        status: 'pending',
        note: 'Not ready',
      });

      const res = await request(app).post('/api/admin/requests/1/handoff');
      expect(res.status).toBe(202);
      expect(res.body.handoff.accepted).toBe(false);
    });

    it('handles context collection failure gracefully', async () => {
      const app = createApp();
      mocks.db.select.mockImplementation(() => createLimitQuery([{
        id: 1, pharmacyId: 2, requestText: 'test', openclawStatus: 'pending_handoff',
      }]));
      mocks.buildOpenClawLogContext.mockRejectedValue(new Error('context error'));
      mocks.handoffToOpenClaw.mockResolvedValue({
        accepted: true,
        connectorConfigured: true,
        implementationBranch: 'main',
        status: 'accepted',
        note: 'OK',
        threadId: 'th_456',
        summary: 'Summary',
      });
      mocks.db.update.mockImplementation(() => ({
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
      }));

      const res = await request(app).post('/api/admin/requests/1/handoff');
      expect(res.status).toBe(200);
    });

    it('returns 500 on error', async () => {
      const app = createApp();
      mocks.db.select.mockImplementation(() => {
        throw new Error('db error');
      });

      const res = await request(app).post('/api/admin/requests/1/handoff');
      expect(res.status).toBe(500);
    });
  });
});
