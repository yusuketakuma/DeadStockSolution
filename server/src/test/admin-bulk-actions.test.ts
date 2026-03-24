import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    transaction: vi.fn(),
  },
  writeLog: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
  handoffToOpenClaw: vi.fn(),
  buildOpenClawLogContext: vi.fn(),
  buildProposalTimeline: vi.fn(),
  fetchProposalTimelineActionRows: vi.fn(),
  invalidateAuthUserCache: vi.fn(),
  recordAuditLog: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 1, email: 'admin@example.com', isAdmin: true };
    next();
  },
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => { next(); },
  invalidateAuthUserCache: mocks.invalidateAuthUserCache,
}));

vi.mock('../config/database', () => ({ db: mocks.db }));
vi.mock('../services/log-service', () => ({
  writeLog: mocks.writeLog,
  getClientIp: mocks.getClientIp,
}));
vi.mock('../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../middleware/error-handler', () => ({
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));
vi.mock('../services/openclaw-service', () => ({
  handoffToOpenClaw: mocks.handoffToOpenClaw,
}));
vi.mock('../services/openclaw-log-context-service', () => ({
  buildOpenClawLogContext: mocks.buildOpenClawLogContext,
}));
vi.mock('../services/proposal-timeline-service', () => ({
  buildProposalTimeline: mocks.buildProposalTimeline,
  fetchProposalTimelineActionRows: mocks.fetchProposalTimelineActionRows,
}));
vi.mock('../utils/path-utils', () => ({
  isSafeInternalPath: (path: string) => path.startsWith('/'),
}));
vi.mock('../services/audit-log-service', () => ({
  recordAuditLog: mocks.recordAuditLog,
}));
vi.mock('drizzle-orm', () => {
  const sqlFn = Object.assign(
    (..._args: unknown[]) => ({}),
    { raw: (..._args: unknown[]) => ({}) },
  );
  return {
    eq: vi.fn(() => ({})),
    and: vi.fn(() => ({})),
    desc: vi.fn(() => ({})),
    inArray: vi.fn(() => ({})),
    sql: sqlFn,
  };
});
vi.mock('express-rate-limit', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import adminRouter from '../routes/admin';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  return app;
}

describe('Admin Bulk Actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recordAuditLog.mockResolvedValue({});
  });

  describe('POST /bulk-actions/execute (verify)', () => {
    it('正常に一括承認できる', async () => {
      mocks.db.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([
                { id: 1, verificationStatus: 'pending_verification' },
                { id: 2, verificationStatus: 'pending_verification' },
              ]),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
        };
        return fn(tx);
      });

      const app = createApp();
      const res = await request(app)
        .post('/api/admin/bulk-actions/execute')
        .send({ pharmacyIds: [1, 2], action: 'verify' });

      expect(res.status).toBe(200);
      expect(res.body.totalRequested).toBe(2);
      expect(res.body.succeeded).toBe(2);
      expect(res.body.failed).toBe(0);
    });

    it('薬局IDが空の場合400を返す', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/bulk-actions/execute')
        .send({ pharmacyIds: [], action: 'verify' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('対象薬局ID');
    });

    it('薬局IDが100件を超える場合400を返す', async () => {
      const app = createApp();
      const ids = Array.from({ length: 101 }, (_, i) => i + 1);
      const res = await request(app)
        .post('/api/admin/bulk-actions/execute')
        .send({ pharmacyIds: ids, action: 'verify' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('最大100件');
    });

    it('不正な薬局IDを含む場合400を返す', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/bulk-actions/execute')
        .send({ pharmacyIds: [1, -1, 'abc'], action: 'verify' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('正の整数');
    });

    it('存在しない薬局IDの場合500を返す（トランザクションロールバック）', async () => {
      mocks.db.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
        };
        return fn(tx);
      });

      const app = createApp();
      const res = await request(app)
        .post('/api/admin/bulk-actions/execute')
        .send({ pharmacyIds: [999], action: 'verify' });

      expect(res.status).toBe(500);
    });

    it('既に承認済みの場合はスキップ（成功扱い）', async () => {
      mocks.db.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([
                { id: 1, verificationStatus: 'verified' },
              ]),
            }),
          }),
        };
        return fn(tx);
      });

      const app = createApp();
      const res = await request(app)
        .post('/api/admin/bulk-actions/execute')
        .send({ pharmacyIds: [1], action: 'verify' });

      expect(res.status).toBe(200);
      expect(res.body.succeeded).toBe(1);
    });
  });

  describe('POST /bulk-actions/execute (reject)', () => {
    it('正常に一括却下できる', async () => {
      mocks.db.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([
                { id: 1, verificationStatus: 'pending_verification' },
              ]),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
        };
        return fn(tx);
      });

      const app = createApp();
      const res = await request(app)
        .post('/api/admin/bulk-actions/execute')
        .send({ pharmacyIds: [1], action: 'reject', reason: '不適切な登録' });

      expect(res.status).toBe(200);
      expect(res.body.totalRequested).toBe(1);
      expect(res.body.succeeded).toBe(1);
    });

    it('却下理由なしの場合400を返す', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/bulk-actions/execute')
        .send({ pharmacyIds: [1], action: 'reject' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('却下理由は必須');
    });

    it('既に却下済みの場合はスキップ（成功扱い）', async () => {
      mocks.db.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([
                { id: 1, verificationStatus: 'rejected' },
              ]),
            }),
          }),
        };
        return fn(tx);
      });

      const app = createApp();
      const res = await request(app)
        .post('/api/admin/bulk-actions/execute')
        .send({ pharmacyIds: [1], action: 'reject', reason: '不適切' });

      expect(res.status).toBe(200);
      expect(res.body.succeeded).toBe(1);
    });
  });

  describe('POST /bulk-actions/execute', () => {
    it('activate action can be executed via generic endpoint', async () => {
      mocks.db.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        const tx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([
                { id: 5, verificationStatus: 'verified', isActive: false },
              ]),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
        };
        return fn(tx);
      });

      const app = createApp();
      const res = await request(app)
        .post('/api/admin/bulk-actions/execute')
        .send({ pharmacyIds: [5], action: 'activate' });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('一括有効化');
      expect(res.body.succeeded).toBe(1);
    });

    it('returns 400 for invalid action', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/bulk-actions/execute')
        .send({ pharmacyIds: [1], action: 'invalid' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('action');
    });
  });
});
