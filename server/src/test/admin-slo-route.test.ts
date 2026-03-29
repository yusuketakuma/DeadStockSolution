import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getBreaches: vi.fn(),
  clearBreaches: vi.fn(),
  getBreachCount: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 1, email: 'admin@example.com', isAdmin: true };
    next();
  },
  requireAdmin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, res: { status: (code: number) => { json: (body: unknown) => void } }, next: () => void) => {
    if (!req.user?.isAdmin) {
      res.status(403).json({ error: '管理者権限が必要です' });
      return;
    }
    next();
  },
}));

vi.mock('../services/slo-tracking-service', () => ({
  getBreaches: mocks.getBreaches,
  clearBreaches: mocks.clearBreaches,
  getBreachCount: mocks.getBreachCount,
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../middleware/error-handler', () => ({
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

let adminSloRouter: express.Router;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminSloRouter);
  return app;
}

const sampleBreaches = [
  {
    id: 2,
    type: 'db_health' as const,
    details: 'DB 接続タイムアウト',
    timestamp: '2026-03-21T10:00:00.000Z',
  },
  {
    id: 1,
    type: 'readiness' as const,
    details: 'readiness チェック失敗',
    timestamp: '2026-03-21T09:00:00.000Z',
  },
];

describe('GET /api/admin/slo-breaches', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    ({ default: adminSloRouter } = await import('../routes/admin-slo'));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('200 と違反一覧を返す', async () => {
    mocks.getBreaches.mockReturnValue(sampleBreaches);
    mocks.getBreachCount.mockReturnValue(2);

    const response = await request(createApp()).get('/api/admin/slo-breaches');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(sampleBreaches);
    expect(response.body.total).toBe(2);
  });

  it('limit クエリパラメータを service に渡す', async () => {
    mocks.getBreaches.mockReturnValue([]);
    mocks.getBreachCount.mockReturnValue(0);

    await request(createApp()).get('/api/admin/slo-breaches?limit=10');

    expect(mocks.getBreaches).toHaveBeenCalledWith(10);
  });

  it('limit が 0 のとき 400 を返す', async () => {
    const response = await request(createApp()).get('/api/admin/slo-breaches?limit=0');

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });

  it('limit が 201 のとき 400 を返す', async () => {
    const response = await request(createApp()).get('/api/admin/slo-breaches?limit=201');

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });

  it('limit が文字列のとき 400 を返す', async () => {
    const response = await request(createApp()).get('/api/admin/slo-breaches?limit=abc');

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });

  it('サービスエラー時に 500 を返す', async () => {
    mocks.getBreaches.mockImplementation(() => {
      throw new Error('unexpected error');
    });

    const response = await request(createApp()).get('/api/admin/slo-breaches');

    expect(response.status).toBe(500);
    expect(response.body.error).toBeDefined();
  });
});

describe('DELETE /api/admin/slo-breaches', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    vi.resetModules();
    ({ default: adminSloRouter } = await import('../routes/admin-slo'));
  });

  it('200 と { ok: true } を返す', async () => {
    mocks.clearBreaches.mockReturnValue(undefined);

    const response = await request(createApp()).delete('/api/admin/slo-breaches');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(mocks.clearBreaches).toHaveBeenCalledOnce();
  });

  it('サービスエラー時に 500 を返す', async () => {
    mocks.clearBreaches.mockImplementation(() => {
      throw new Error('clear failed');
    });

    const response = await request(createApp()).delete('/api/admin/slo-breaches');

    expect(response.status).toBe(500);
    expect(response.body.error).toBeDefined();
  });
});
