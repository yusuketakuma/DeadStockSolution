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
  handoffToOpenClaw: vi.fn(),
}));
vi.mock('../services/openclaw-log-context-service', () => ({
  buildOpenClawLogContext: vi.fn(),
}));
vi.mock('../services/proposal-timeline-service', () => ({
  buildProposalTimeline: vi.fn(),
  fetchProposalTimelineActionRows: vi.fn(),
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

function makeTx(pharmacies: { id: number; verificationStatus: string | null; isActive: boolean }[]) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(pharmacies),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
  };
}

describe('Admin Bulk Actions — activate / deactivate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recordAuditLog.mockResolvedValue({});
  });

  describe('POST /bulk-actions/execute — activate', () => {
    it('正常に一括有効化できる', async () => {
      mocks.db.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        return fn(makeTx([
          { id: 1, verificationStatus: 'verified', isActive: false },
          { id: 2, verificationStatus: 'verified', isActive: false },
        ]));
      });

      const app = createApp();
      const res = await request(app)
        .post('/api/admin/bulk-actions/execute')
        .send({ pharmacyIds: [1, 2], action: 'activate' });

      expect(res.status).toBe(200);
      expect(res.body.totalRequested).toBe(2);
      expect(res.body.succeeded).toBe(2);
      expect(res.body.failed).toBe(0);
    });

    it('activate の監査ログ action に admin_bulk_activate が記録される', async () => {
      mocks.db.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        return fn(makeTx([{ id: 1, verificationStatus: 'verified', isActive: false }]));
      });

      const app = createApp();
      await request(app)
        .post('/api/admin/bulk-actions/execute')
        .send({ pharmacyIds: [1], action: 'activate' });

      expect(mocks.writeLog).toHaveBeenCalledWith(
        'admin_bulk_activate',
        expect.objectContaining({ detail: expect.stringContaining('activate') }),
      );
    });

    it('activate が admin_bulk_verify として誤記録されない', async () => {
      mocks.db.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        return fn(makeTx([{ id: 1, verificationStatus: 'verified', isActive: false }]));
      });

      const app = createApp();
      await request(app)
        .post('/api/admin/bulk-actions/execute')
        .send({ pharmacyIds: [1], action: 'activate' });

      expect(mocks.writeLog).not.toHaveBeenCalledWith('admin_bulk_verify', expect.anything());
    });

    it('既に有効な薬局はスキップされる（成功扱い）', async () => {
      mocks.db.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        return fn(makeTx([{ id: 1, verificationStatus: 'verified', isActive: true }]));
      });

      const app = createApp();
      const res = await request(app)
        .post('/api/admin/bulk-actions/execute')
        .send({ pharmacyIds: [1], action: 'activate' });

      expect(res.status).toBe(200);
      expect(res.body.succeeded).toBe(1);
    });
  });

  describe('POST /bulk-actions/execute — deactivate', () => {
    it('正常に一括無効化できる', async () => {
      mocks.db.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        return fn(makeTx([
          { id: 1, verificationStatus: 'verified', isActive: true },
          { id: 2, verificationStatus: 'verified', isActive: true },
        ]));
      });

      const app = createApp();
      const res = await request(app)
        .post('/api/admin/bulk-actions/execute')
        .send({ pharmacyIds: [1, 2], action: 'deactivate' });

      expect(res.status).toBe(200);
      expect(res.body.totalRequested).toBe(2);
      expect(res.body.succeeded).toBe(2);
      expect(res.body.failed).toBe(0);
    });

    it('deactivate の監査ログ action に admin_bulk_deactivate が記録される', async () => {
      mocks.db.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        return fn(makeTx([{ id: 1, verificationStatus: 'verified', isActive: true }]));
      });

      const app = createApp();
      await request(app)
        .post('/api/admin/bulk-actions/execute')
        .send({ pharmacyIds: [1], action: 'deactivate' });

      expect(mocks.writeLog).toHaveBeenCalledWith(
        'admin_bulk_deactivate',
        expect.objectContaining({ detail: expect.stringContaining('deactivate') }),
      );
    });

    it('deactivate が admin_bulk_reject として誤記録されない', async () => {
      mocks.db.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        return fn(makeTx([{ id: 1, verificationStatus: 'verified', isActive: true }]));
      });

      const app = createApp();
      await request(app)
        .post('/api/admin/bulk-actions/execute')
        .send({ pharmacyIds: [1], action: 'deactivate' });

      expect(mocks.writeLog).not.toHaveBeenCalledWith('admin_bulk_reject', expect.anything());
    });

    it('既に無効な薬局はスキップされる（成功扱い）', async () => {
      mocks.db.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        return fn(makeTx([{ id: 1, verificationStatus: 'verified', isActive: false }]));
      });

      const app = createApp();
      const res = await request(app)
        .post('/api/admin/bulk-actions/execute')
        .send({ pharmacyIds: [1], action: 'deactivate' });

      expect(res.status).toBe(200);
      expect(res.body.succeeded).toBe(1);
    });
  });

  describe('POST /bulk-actions/execute — バリデーション', () => {
    it('action が activate / deactivate 以外は 400 を返す', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/bulk-actions/execute')
        .send({ pharmacyIds: [1], action: 'enable' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('verify / reject / activate / deactivate');
    });

    it('薬局IDが空の場合 400 を返す', async () => {
      const app = createApp();
      const res = await request(app)
        .post('/api/admin/bulk-actions/execute')
        .send({ pharmacyIds: [], action: 'activate' });

      expect(res.status).toBe(400);
    });

    it('薬局IDが 100 件を超える場合 400 を返す', async () => {
      const app = createApp();
      const ids = Array.from({ length: 101 }, (_, i) => i + 1);
      const res = await request(app)
        .post('/api/admin/bulk-actions/execute')
        .send({ pharmacyIds: ids, action: 'activate' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('最大100件');
    });
  });

  describe('POST /bulk-actions/execute — recordAuditLog との連携', () => {
    it('activate 実行時に recordAuditLog が activate action で呼ばれる', async () => {
      mocks.db.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        return fn(makeTx([{ id: 5, verificationStatus: 'verified', isActive: false }]));
      });

      const app = createApp();
      await request(app)
        .post('/api/admin/bulk-actions/execute')
        .send({ pharmacyIds: [5], action: 'activate' });

      expect(mocks.recordAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'activate' }),
      );
    });

    it('deactivate 実行時に recordAuditLog が deactivate action で呼ばれる', async () => {
      mocks.db.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
        return fn(makeTx([{ id: 5, verificationStatus: 'verified', isActive: true }]));
      });

      const app = createApp();
      await request(app)
        .post('/api/admin/bulk-actions/execute')
        .send({ pharmacyIds: [5], action: 'deactivate' });

      expect(mocks.recordAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'deactivate' }),
      );
    });
  });
});
