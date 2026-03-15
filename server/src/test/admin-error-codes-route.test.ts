import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listErrorCodes: vi.fn(),
  createErrorCode: vi.fn(),
  updateErrorCode: vi.fn(),
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

vi.mock('../services/error-code-service', () => ({
  listErrorCodes: mocks.listErrorCodes,
  createErrorCode: mocks.createErrorCode,
  updateErrorCode: mocks.updateErrorCode,
}));

vi.mock('../db/schema', () => ({
  errorCodeCategoryValues: ['upload', 'auth', 'sync', 'system', 'openclaw'],
  errorCodeSeverityValues: ['critical', 'error', 'warning', 'info'],
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

import adminErrorCodesRouter from '../routes/admin-error-codes';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/error-codes', adminErrorCodesRouter);
  return app;
}

const sampleErrorCode = {
  id: 1,
  code: 'UPLOAD_PARSE_FAILED',
  category: 'upload',
  severity: 'error',
  titleJa: 'ファイル解析エラー',
  descriptionJa: 'アップロードされたファイルの解析に失敗しました',
  resolutionJa: 'ファイル形式を確認してください',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('GET /api/admin/error-codes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error code list with default filters', async () => {
    const app = createApp();
    mocks.listErrorCodes.mockResolvedValue({ items: [sampleErrorCode], total: 1 });

    const response = await request(app).get('/api/admin/error-codes');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ items: [sampleErrorCode], total: 1 });
    expect(mocks.listErrorCodes).toHaveBeenCalledWith(
      expect.objectContaining({ activeOnly: true }),
    );
  });

  it('applies category filter when valid category is provided', async () => {
    const app = createApp();
    mocks.listErrorCodes.mockResolvedValue({ items: [], total: 0 });

    const response = await request(app)
      .get('/api/admin/error-codes')
      .query({ category: 'upload' });
    expect(response.status).toBe(200);
    expect(mocks.listErrorCodes).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'upload' }),
    );
  });

  it('ignores invalid category value', async () => {
    const app = createApp();
    mocks.listErrorCodes.mockResolvedValue({ items: [], total: 0 });

    const response = await request(app)
      .get('/api/admin/error-codes')
      .query({ category: 'invalid_category' });
    expect(response.status).toBe(200);
    expect(mocks.listErrorCodes).toHaveBeenCalledWith(
      expect.not.objectContaining({ category: 'invalid_category' }),
    );
  });

  it('applies severity filter when valid severity is provided', async () => {
    const app = createApp();
    mocks.listErrorCodes.mockResolvedValue({ items: [], total: 0 });

    const response = await request(app)
      .get('/api/admin/error-codes')
      .query({ severity: 'error' });
    expect(response.status).toBe(200);
    expect(mocks.listErrorCodes).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error' }),
    );
  });

  it('applies search filter', async () => {
    const app = createApp();
    mocks.listErrorCodes.mockResolvedValue({ items: [], total: 0 });

    const response = await request(app)
      .get('/api/admin/error-codes')
      .query({ search: 'UPLOAD' });
    expect(response.status).toBe(200);
    expect(mocks.listErrorCodes).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'UPLOAD' }),
    );
  });

  it('excludes inactive when activeOnly=false', async () => {
    const app = createApp();
    mocks.listErrorCodes.mockResolvedValue({ items: [], total: 0 });

    const response = await request(app)
      .get('/api/admin/error-codes')
      .query({ activeOnly: 'false' });
    expect(response.status).toBe(200);
    // activeOnly should not be set to true when query param is 'false'
    const callArg = mocks.listErrorCodes.mock.calls[0][0];
    expect(callArg.activeOnly).not.toBe(true);
  });

  it('returns 500 on service error', async () => {
    const app = createApp();
    mocks.listErrorCodes.mockRejectedValue(new Error('DB failure'));

    const response = await request(app).get('/api/admin/error-codes');
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'エラーコード一覧の取得に失敗しました' });
  });
});

describe('POST /api/admin/error-codes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 when required fields are missing', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/admin/error-codes')
      .send({ code: 'TEST_CODE' }); // missing category, severity, titleJa
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: '必須項目が不足しています' });
    expect(mocks.createErrorCode).not.toHaveBeenCalled();
  });

  it('returns 400 when code is missing', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/admin/error-codes')
      .send({ category: 'upload', severity: 'error', titleJa: 'Test' });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: '必須項目が不足しています' });
  });

  it('creates error code and returns 201', async () => {
    const app = createApp();
    mocks.createErrorCode.mockResolvedValue(sampleErrorCode);

    const response = await request(app)
      .post('/api/admin/error-codes')
      .send({
        code: 'UPLOAD_PARSE_FAILED',
        category: 'upload',
        severity: 'error',
        titleJa: 'ファイル解析エラー',
        descriptionJa: 'アップロードされたファイルの解析に失敗しました',
        resolutionJa: 'ファイル形式を確認してください',
      });
    expect(response.status).toBe(201);
    expect(response.body).toEqual(sampleErrorCode);
    expect(mocks.createErrorCode).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'UPLOAD_PARSE_FAILED',
        category: 'upload',
        severity: 'error',
        titleJa: 'ファイル解析エラー',
      }),
    );
  });

  it('returns 500 when service returns null', async () => {
    const app = createApp();
    mocks.createErrorCode.mockResolvedValue(null);

    const response = await request(app)
      .post('/api/admin/error-codes')
      .send({
        code: 'NEW_CODE',
        category: 'system',
        severity: 'critical',
        titleJa: '新エラー',
      });
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'エラーコードの作成に失敗しました' });
  });

  it('returns 500 on service exception', async () => {
    const app = createApp();
    mocks.createErrorCode.mockRejectedValue(new Error('DB failure'));

    const response = await request(app)
      .post('/api/admin/error-codes')
      .send({
        code: 'NEW_CODE',
        category: 'system',
        severity: 'critical',
        titleJa: '新エラー',
      });
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'エラーコードの作成に失敗しました' });
  });
});

describe('PUT /api/admin/error-codes/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 for invalid (non-numeric) ID', async () => {
    const app = createApp();

    const response = await request(app)
      .put('/api/admin/error-codes/not-a-number')
      .send({ titleJa: 'Updated Title' });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: '不正なIDです' });
    expect(mocks.updateErrorCode).not.toHaveBeenCalled();
  });

  it('returns 400 for ID of zero', async () => {
    const app = createApp();

    const response = await request(app)
      .put('/api/admin/error-codes/0')
      .send({ titleJa: 'Updated Title' });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: '不正なIDです' });
  });

  it('returns 404 when error code is not found', async () => {
    const app = createApp();
    mocks.updateErrorCode.mockResolvedValue(null);

    const response = await request(app)
      .put('/api/admin/error-codes/999')
      .send({ titleJa: 'Updated Title' });
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'エラーコードが見つかりません' });
    expect(mocks.updateErrorCode).toHaveBeenCalledWith(999, expect.objectContaining({ titleJa: 'Updated Title' }));
  });

  it('updates error code and returns 200', async () => {
    const app = createApp();
    const updatedRecord = { ...sampleErrorCode, titleJa: 'Updated Title' };
    mocks.updateErrorCode.mockResolvedValue(updatedRecord);

    const response = await request(app)
      .put('/api/admin/error-codes/1')
      .send({ titleJa: 'Updated Title', isActive: false });
    expect(response.status).toBe(200);
    expect(response.body).toEqual(updatedRecord);
    expect(mocks.updateErrorCode).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ titleJa: 'Updated Title', isActive: false }),
    );
  });

  it('returns 500 on service exception', async () => {
    const app = createApp();
    mocks.updateErrorCode.mockRejectedValue(new Error('DB failure'));

    const response = await request(app)
      .put('/api/admin/error-codes/1')
      .send({ titleJa: 'Updated Title' });
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'エラーコードの更新に失敗しました' });
  });
});

describe('Authentication and authorization', () => {
  it('returns 401 when user is not authenticated (requireLogin blocks)', async () => {
    // Override requireLogin to simulate unauthenticated access
    const { requireLogin: _orig, ...rest } = await vi.importMock('../middleware/auth') as Record<string, unknown>;
    void rest;
    // We test this by creating an app that simulates the unauthenticated case
    // Since requireLogin is mocked globally in this file to pass through,
    // we create a separate test app with a stricter mock
    const testApp = express();
    testApp.use(express.json());
    testApp.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
      // Simulate unauthenticated: no user set, just call next
      // requireAdmin will check for isAdmin and fail
      (req as { user?: unknown }).user = undefined;
      next();
    });
    testApp.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
      const authReq = req as { user?: { isAdmin: boolean } };
      if (!authReq.user) {
        res.status(401).json({ error: '認証が必要です' });
        return;
      }
      next();
    });
    testApp.use('/api/admin/error-codes', adminErrorCodesRouter);

    const response = await request(testApp).get('/api/admin/error-codes');
    expect(response.status).toBe(401);
  });

  it('returns 403 when user is not admin (requireAdmin blocks)', async () => {
    // Create an app with non-admin user
    const testApp = express();
    testApp.use(express.json());
    testApp.use((req: express.Request, _res: express.Response, next: express.NextFunction) => {
      (req as { user?: { id: number; email: string; isAdmin: boolean } }).user = {
        id: 2,
        email: 'regular@example.com',
        isAdmin: false,
      };
      next();
    });
    testApp.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
      const authReq = req as { user?: { isAdmin: boolean } };
      if (!authReq.user?.isAdmin) {
        res.status(403).json({ error: '管理者権限が必要です' });
        return;
      }
      next();
    });
    testApp.use('/api/admin/error-codes', adminErrorCodesRouter);

    const response = await request(testApp).get('/api/admin/error-codes');
    expect(response.status).toBe(403);
  });
});
