import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeBulkPharmacyAction: vi.fn(),
  previewBulkAction: vi.fn(),
  parseBulkActionCsv: vi.fn(),
  writeLog: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

vi.mock('../services/admin-bulk-pharmacy-action-service', async () => {
  const actual = await vi.importActual<typeof import('../services/admin-bulk-pharmacy-action-service')>(
    '../services/admin-bulk-pharmacy-action-service',
  );

  return {
    ...actual,
    executeBulkPharmacyAction: mocks.executeBulkPharmacyAction,
    previewBulkAction: mocks.previewBulkAction,
  };
});

vi.mock('../services/admin-bulk-action-service', () => ({
  parseBulkActionCsv: mocks.parseBulkActionCsv,
}));

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

vi.mock('../routes/admin-write-limiter', () => ({
  adminWriteLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

async function createApp() {
  const { default: adminBulkActionsRouter } = await import('../routes/admin-bulk-actions');
  const app = express();
  app.use(express.json());
  app.use('/api/admin', (
    req: express.Request & { user?: { id: number; email: string; isAdmin: boolean } },
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    req.user = { id: 1, email: 'admin@example.com', isAdmin: true };
    next();
  }, adminBulkActionsRouter);
  return app;
}

describe('Admin Bulk Actions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getClientIp.mockReturnValue('127.0.0.1');
    mocks.executeBulkPharmacyAction.mockResolvedValue({
      message: '一括操作を実行しました（1件）',
      totalRequested: 1,
      succeeded: 1,
      failed: 0,
      results: [{ pharmacyId: 1, success: true }],
    });
    mocks.previewBulkAction.mockResolvedValue([]);
    mocks.parseBulkActionCsv.mockReturnValue({ rows: [], errors: [] });
  });

  describe('POST /bulk-actions/execute (verify)', () => {
    it('正常に一括承認できる', async () => {
      mocks.executeBulkPharmacyAction.mockResolvedValue({
        message: '一括承認を実行しました（2件）',
        totalRequested: 2,
        succeeded: 2,
        failed: 0,
        results: [
          { pharmacyId: 1, success: true },
          { pharmacyId: 2, success: true },
        ],
      });

      const app = await createApp();
      const res = await request(app)
        .post('/api/admin/bulk-actions/execute')
        .send({ pharmacyIds: [1, 2], action: 'verify' });

      expect(res.status).toBe(200);
      expect(res.body.totalRequested).toBe(2);
      expect(res.body.succeeded).toBe(2);
      expect(res.body.failed).toBe(0);
      expect(mocks.executeBulkPharmacyAction).toHaveBeenCalledWith({
        adminId: 1,
        pharmacyIds: [1, 2],
        action: 'verify',
        reason: undefined,
      });
    });

    it('薬局IDが空の場合400を返す', async () => {
      const app = await createApp();
      const res = await request(app)
        .post('/api/admin/bulk-actions/execute')
        .send({ pharmacyIds: [], action: 'verify' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('対象薬局ID');
      expect(mocks.executeBulkPharmacyAction).not.toHaveBeenCalled();
    });

    it('薬局IDが100件を超える場合400を返す', async () => {
      const app = await createApp();
      const ids = Array.from({ length: 101 }, (_, i) => i + 1);
      const res = await request(app)
        .post('/api/admin/bulk-actions/execute')
        .send({ pharmacyIds: ids, action: 'verify' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('最大100件');
      expect(mocks.executeBulkPharmacyAction).not.toHaveBeenCalled();
    });

    it('不正な薬局IDを含む場合400を返す', async () => {
      const app = await createApp();
      const res = await request(app)
        .post('/api/admin/bulk-actions/execute')
        .send({ pharmacyIds: [1, -1, 'abc'], action: 'verify' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('正の整数');
      expect(mocks.executeBulkPharmacyAction).not.toHaveBeenCalled();
    });

    it('サービス例外時は500を返す', async () => {
      mocks.executeBulkPharmacyAction.mockRejectedValue(new Error('db failed'));

      const app = await createApp();
      const res = await request(app)
        .post('/api/admin/bulk-actions/execute')
        .send({ pharmacyIds: [1], action: 'verify' });

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('一括操作に失敗');
    });
  });

  describe('POST /bulk-actions/execute (reject)', () => {
    it('正常に一括却下できる', async () => {
      mocks.executeBulkPharmacyAction.mockResolvedValue({
        message: '一括却下を実行しました（1件）',
        totalRequested: 1,
        succeeded: 1,
        failed: 0,
        results: [{ pharmacyId: 1, success: true }],
      });

      const app = await createApp();
      const res = await request(app)
        .post('/api/admin/bulk-actions/execute')
        .send({ pharmacyIds: [1], action: 'reject', reason: '不適切な登録' });

      expect(res.status).toBe(200);
      expect(res.body.totalRequested).toBe(1);
      expect(res.body.succeeded).toBe(1);
      expect(mocks.executeBulkPharmacyAction).toHaveBeenCalledWith({
        adminId: 1,
        pharmacyIds: [1],
        action: 'reject',
        reason: '不適切な登録',
      });
    });

    it('却下理由がない場合400を返す', async () => {
      const app = await createApp();
      const res = await request(app)
        .post('/api/admin/bulk-actions/execute')
        .send({ pharmacyIds: [1], action: 'reject' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('却下理由は必須');
      expect(mocks.executeBulkPharmacyAction).not.toHaveBeenCalled();
    });

    it('skip を含む結果でも成功レスポンスを返す', async () => {
      mocks.executeBulkPharmacyAction.mockResolvedValue({
        message: '一括却下を実行しました（1件）',
        totalRequested: 1,
        succeeded: 1,
        failed: 0,
        results: [{ pharmacyId: 1, success: true }],
      });

      const app = await createApp();
      const res = await request(app)
        .post('/api/admin/bulk-actions/execute')
        .send({ pharmacyIds: [1], action: 'reject', reason: '不適切' });

      expect(res.status).toBe(200);
      expect(res.body.succeeded).toBe(1);
    });
  });

  describe('POST /bulk-actions/execute', () => {
    it('activate action can be executed via generic endpoint', async () => {
      mocks.executeBulkPharmacyAction.mockResolvedValue({
        message: '一括有効化を実行しました（1件）',
        totalRequested: 1,
        succeeded: 1,
        failed: 0,
        results: [{ pharmacyId: 5, success: true }],
      });

      const app = await createApp();
      const res = await request(app)
        .post('/api/admin/bulk-actions/execute')
        .send({ pharmacyIds: [5], action: 'activate' });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('一括有効化');
      expect(res.body.succeeded).toBe(1);
      expect(mocks.executeBulkPharmacyAction).toHaveBeenCalledWith({
        adminId: 1,
        pharmacyIds: [5],
        action: 'activate',
        reason: undefined,
      });
    });

    it('returns 400 for invalid action', async () => {
      const app = await createApp();
      const res = await request(app)
        .post('/api/admin/bulk-actions/execute')
        .send({ pharmacyIds: [1], action: 'invalid' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('action');
      expect(mocks.executeBulkPharmacyAction).not.toHaveBeenCalled();
    });
  });
});
