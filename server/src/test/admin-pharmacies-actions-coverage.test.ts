import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
  },
  writeLog: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
  handoffToOpenClaw: vi.fn(),
  buildOpenClawLogContext: vi.fn(),
  buildProposalTimeline: vi.fn(),
  fetchProposalTimelineActionRows: vi.fn(),
  mapOpenClawStatusToWorkflowStatus: vi.fn(),
  isMissingOpenClawSchemaError: vi.fn(),
  updateOpenClawWorkItem: vi.fn(),
}));

function mockAdminPharmaciesActionCoverageDependencies() {
  vi.doMock('../middleware/auth', () => ({
    requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
      req.user = { id: 1, email: 'admin@example.com', isAdmin: true };
      next();
    },
    requireAdmin: (_req: unknown, _res: unknown, next: () => void) => { next(); },
  }));

  vi.doMock('../config/database', () => ({ db: mocks.db }));

  vi.doMock('../services/log-service', () => ({
    writeLog: mocks.writeLog,
    getClientIp: mocks.getClientIp,
  }));

  vi.doMock('../services/logger', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }));

  vi.doMock('../middleware/error-handler', () => ({
    getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
  }));

  vi.doMock('../services/openclaw-service', () => ({
    handoffToOpenClaw: mocks.handoffToOpenClaw,
  }));

  vi.doMock('../services/openclaw-log-context-service', () => ({
    buildOpenClawLogContext: mocks.buildOpenClawLogContext,
  }));

  vi.doMock('../services/proposal-timeline-service', () => ({
    buildProposalTimeline: mocks.buildProposalTimeline,
    fetchProposalTimelineActionRows: mocks.fetchProposalTimelineActionRows,
  }));

  vi.doMock('../services/openclaw-thread-service', () => ({
    mapOpenClawStatusToWorkflowStatus: mocks.mapOpenClawStatusToWorkflowStatus,
    isMissingOpenClawSchemaError: mocks.isMissingOpenClawSchemaError,
    updateOpenClawWorkItem: mocks.updateOpenClawWorkItem,
  }));

  vi.doMock('../utils/path-utils', () => ({
    isSafeInternalPath: (path: string) => path.startsWith('/'),
  }));

  vi.doMock('drizzle-orm', () => {
    const sqlFn = Object.assign(
      (..._args: unknown[]) => ({}),
      { raw: (..._args: unknown[]) => ({}) },
    );
    return {
      eq: vi.fn(() => ({})),
      and: vi.fn(() => ({})),
      desc: vi.fn(() => ({})),
      sql: sqlFn,
    };
  });

  vi.doMock('express-rate-limit', () => ({
    default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  }));
}

let adminRouter: express.Router;

async function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  return app;
}

function createLimitQuery(result: unknown) {
  const query = { from: vi.fn(), leftJoin: vi.fn(), where: vi.fn(), limit: vi.fn(), offset: vi.fn(), orderBy: vi.fn() };
  query.from.mockReturnValue(query);
  query.leftJoin.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.offset.mockResolvedValue(result);
  return query;
}

describe('admin-pharmacies-actions routes — coverage', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockAdminPharmaciesActionCoverageDependencies();
    ({ default: adminRouter } = await import('../routes/admin'));
    mocks.mapOpenClawStatusToWorkflowStatus.mockReturnValue('analyzing');
    mocks.isMissingOpenClawSchemaError.mockImplementation((err: unknown) => (
      typeof err === 'object' && err !== null && (err as { code?: string }).code === '42P01'
    ));
  });

  describe('POST /messages', () => {
    it('returns 400 for invalid targetType', async () => {
      const app = await createApp();

      const res = await request(app)
        .post('/api/admin/messages')
        .send({ targetType: 'invalid', title: 'テスト', body: '本文' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('送信対象が不正');
    });

    it('returns 400 for empty title', async () => {
      const app = await createApp();

      const res = await request(app)
        .post('/api/admin/messages')
        .send({ targetType: 'all', title: '', body: '本文' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('タイトル');
    });

    it('returns 400 for too long title', async () => {
      const app = await createApp();

      const res = await request(app)
        .post('/api/admin/messages')
        .send({ targetType: 'all', title: 'a'.repeat(101), body: '本文' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('タイトル');
    });

    it('returns 400 for empty body', async () => {
      const app = await createApp();

      const res = await request(app)
        .post('/api/admin/messages')
        .send({ targetType: 'all', title: 'テスト', body: '' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('本文');
    });

    it('returns 400 for too long body', async () => {
      const app = await createApp();

      const res = await request(app)
        .post('/api/admin/messages')
        .send({ targetType: 'all', title: 'テスト', body: 'a'.repeat(2001) });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('本文');
    });

    it('returns 400 for pharmacy target without valid id', async () => {
      const app = await createApp();

      const res = await request(app)
        .post('/api/admin/messages')
        .send({ targetType: 'pharmacy', title: 'テスト', body: '本文' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('送信先薬局ID');
    });

    it('returns 404 when target pharmacy not found', async () => {
      const app = await createApp();
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      const res = await request(app)
        .post('/api/admin/messages')
        .send({ targetType: 'pharmacy', targetPharmacyId: 999, title: 'テスト', body: '本文' });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('送信先薬局が見つかりません');
    });

    it('returns 400 for unsafe action path', async () => {
      const app = await createApp();

      const res = await request(app)
        .post('/api/admin/messages')
        .send({ targetType: 'all', title: 'テスト', body: '本文', actionPath: 'javascript:alert(1)' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('遷移先パスが不正');
    });

    it('sends message to all successfully', async () => {
      const app = await createApp();
      mocks.db.insert.mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });

      const res = await request(app)
        .post('/api/admin/messages')
        .send({ targetType: 'all', title: 'テスト通知', body: 'テスト本文' });

      expect(res.status).toBe(201);
      expect(res.body.message).toContain('メッセージを送信');
    });

    it('sends message to specific pharmacy successfully', async () => {
      const app = await createApp();
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: 5 }]),
          }),
        }),
      });
      mocks.db.insert.mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });

      const res = await request(app)
        .post('/api/admin/messages')
        .send({ targetType: 'pharmacy', targetPharmacyId: 5, title: 'テスト', body: '本文', actionPath: '/dashboard' });

      expect(res.status).toBe(201);
    });
  });

  describe('POST /requests/:id/handoff', () => {
    it('returns 404 when request not found', async () => {
      const app = await createApp();
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
      });

      const res = await request(app)
        .post('/api/admin/requests/999/handoff');

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('要望が見つかりません');
    });

    it('returns 400 for completed request', async () => {
      const app = await createApp();
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{
                id: 1, pharmacyId: 5, requestText: 'テスト要望',
                openclawStatus: 'completed',
              }]),
            }),
          }),
        }),
      });

      const res = await request(app)
        .post('/api/admin/requests/1/handoff');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('完了済み要望は再連携できません');
    });

    it('returns 400 for non-retryable status', async () => {
      const app = await createApp();
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{
                id: 1, pharmacyId: 5, requestText: 'テスト要望',
                openclawStatus: 'implementing',
                workflowStatus: 'implementing',
              }]),
            }),
          }),
        }),
      });

      const res = await request(app)
        .post('/api/admin/requests/1/handoff');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('連携待ちまたは失敗');
    });

    it('performs handoff successfully (accepted)', async () => {
      const app = await createApp();
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{
                id: 1, pharmacyId: 5, requestText: 'テスト要望',
                openclawStatus: 'pending_handoff',
                openclawThreadId: null,
                workflowStatus: 'queued',
              }]),
            }),
          }),
        }),
      });
      mocks.buildOpenClawLogContext.mockResolvedValue({ logs: [] });
      mocks.handoffToOpenClaw.mockResolvedValue({
        accepted: true,
        connectorConfigured: true,
        implementationBranch: 'main',
        status: 'implementing',
        note: null,
        threadId: 'thread-1',
        summary: 'テスト要約',
      });
      mocks.db.update.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
      });

      const res = await request(app)
        .post('/api/admin/requests/1/handoff');

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('OpenClawへ再連携');
    });

    it('performs handoff with pending status (202)', async () => {
      const app = await createApp();
      mocks.db.select.mockReturnValue({
        from: vi.fn().mockReturnValue({
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{
                id: 1, pharmacyId: 5, requestText: 'テスト要望',
                openclawStatus: 'pending_handoff',
                openclawThreadId: null,
                workflowStatus: 'queued',
              }]),
            }),
          }),
        }),
      });
      mocks.buildOpenClawLogContext.mockResolvedValue(undefined);
      mocks.handoffToOpenClaw.mockResolvedValue({
        accepted: false,
        connectorConfigured: false,
        implementationBranch: null,
        status: 'pending_handoff',
        note: '保留中',
      });

      const res = await request(app)
        .post('/api/admin/requests/1/handoff');

      expect(res.status).toBe(202);
      expect(res.body.message).toContain('保留中');
    });

    it('returns 400 for invalid request id', async () => {
      const app = await createApp();

      const res = await request(app)
        .post('/api/admin/requests/abc/handoff');

      expect(res.status).toBe(400);
    });
  });
});
