import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
  },
  getOpenClawRetryQueueSnapshot: vi.fn(),
  isMissingOpenClawRetrySchemaError: vi.fn(),
}));

function mockAdminOpenClawRetriesDependencies() {
  vi.doMock('../middleware/auth', () => ({
    requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
      req.user = { id: 1, email: 'admin@example.com', isAdmin: true };
      next();
    },
    requireAdmin: (_req: unknown, _res: unknown, next: () => void) => { next(); },
  }));

  vi.doMock('../config/database', () => ({ db: mocks.db }));

  vi.doMock('../services/logger', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }));

  vi.doMock('../services/openclaw/retry-service', () => ({
    getOpenClawRetryQueueSnapshot: mocks.getOpenClawRetryQueueSnapshot,
    isMissingOpenClawRetrySchemaError: mocks.isMissingOpenClawRetrySchemaError,
  }));

  vi.doMock('drizzle-orm', () => ({
    eq: vi.fn(() => ({})),
    and: vi.fn(() => ({})),
    desc: vi.fn(() => ({})),
    count: vi.fn(() => ({})),
  }));

  vi.doMock('express-rate-limit', () => ({
    default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  }));
}

let adminOpenClawRetriesRouter: express.Router;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminOpenClawRetriesRouter);
  return app;
}

const defaultStats = {
  pending: 2,
  processing: 1,
  completed: 10,
  failed: 1,
};

const sampleJob = {
  id: 1,
  requestId: 42,
  pharmacyId: 5,
  pharmacyName: 'テスト薬局',
  status: 'pending',
  attemptCount: 0,
  maxAttempts: 3,
  nextRetryAt: '2026-03-24T10:00:00.000Z',
  lastAttemptAt: null,
  completedAt: null,
  lastError: 'connection refused',
  triggerReason: 'initial_failure',
  createdAt: '2026-03-23T09:00:00.000Z',
  updatedAt: '2026-03-23T09:00:00.000Z',
  requestText: 'テスト要望',
};

describe('GET /admin/openclaw-retries', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockAdminOpenClawRetriesDependencies();
    const { default: router } = await import('../routes/admin-openclaw-retries');
    adminOpenClawRetriesRouter = router;
    mocks.getOpenClawRetryQueueSnapshot.mockResolvedValue(defaultStats);
    mocks.isMissingOpenClawRetrySchemaError.mockReturnValue(false);
  });

  it('リトライジョブ一覧と統計情報を返す', async () => {
    // db.select chain: first call → job rows, second call → count
    mocks.db.select
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    offset: vi.fn().mockResolvedValue([sampleJob]),
                  }),
                }),
              }),
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ value: 1 }]),
        }),
      });

    const app = createApp();
    const res = await request(app).get('/api/admin/openclaw-retries');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].requestId).toBe(42);
    expect(res.body.stats).toEqual(defaultStats);
    expect(res.body.pagination.total).toBe(1);
  });

  it('status フィルタを受け付ける', async () => {
    mocks.db.select
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    offset: vi.fn().mockResolvedValue([]),
                  }),
                }),
              }),
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ value: 0 }]),
        }),
      });

    const app = createApp();
    const res = await request(app).get('/api/admin/openclaw-retries?status=failed');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.stats).toEqual(defaultStats);
  });

  it('不正な status パラメータはフィルタなしとして扱われる', async () => {
    mocks.db.select
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    offset: vi.fn().mockResolvedValue([sampleJob]),
                  }),
                }),
              }),
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ value: 1 }]),
        }),
      });

    const app = createApp();
    const res = await request(app).get('/api/admin/openclaw-retries?status=unknown_value');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('DB エラー時に 500 を返す', async () => {
    mocks.getOpenClawRetryQueueSnapshot.mockRejectedValue(new Error('DB connection failed'));

    const app = createApp();
    const res = await request(app).get('/api/admin/openclaw-retries');

    expect(res.status).toBe(500);
    expect(res.body.error).toBeTruthy();
  });

  it('ジョブが存在しない場合は空配列を返す', async () => {
    mocks.db.select
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    offset: vi.fn().mockResolvedValue([]),
                  }),
                }),
              }),
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ value: 0 }]),
        }),
      });

    const app = createApp();
    const res = await request(app).get('/api/admin/openclaw-retries');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.pagination.total).toBe(0);
    expect(res.body.stats.pending).toBe(2);
  });

  it('retry schema が未反映でも空配列でフォールバックする', async () => {
    const missingSchemaError = Object.assign(new Error('relation "openclaw_retry_jobs" does not exist'), { code: '42P01' });
    mocks.isMissingOpenClawRetrySchemaError.mockReturnValue(true);
    mocks.db.select
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                  limit: vi.fn().mockReturnValue({
                    offset: vi.fn().mockRejectedValue(missingSchemaError),
                  }),
                }),
              }),
            }),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockRejectedValue(missingSchemaError),
        }),
      });

    const app = createApp();
    const res = await request(app).get('/api/admin/openclaw-retries');

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
    expect(res.body.stats).toEqual(defaultStats);
  });
});
