import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listAdminUploadJobs: vi.fn(),
  getAdminUploadJobDetail: vi.fn(),
  cancelAdminUploadJob: vi.fn(),
  retryAdminUploadJob: vi.fn(),
  getAdminUploadJobErrorReport: vi.fn(),
  isUploadConfirmRetryUnavailableError: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../services/admin-upload-job-service', () => ({
  listAdminUploadJobs: mocks.listAdminUploadJobs,
  getAdminUploadJobDetail: mocks.getAdminUploadJobDetail,
  cancelAdminUploadJob: mocks.cancelAdminUploadJob,
  retryAdminUploadJob: mocks.retryAdminUploadJob,
  getAdminUploadJobErrorReport: mocks.getAdminUploadJobErrorReport,
  isUploadConfirmRetryUnavailableError: mocks.isUploadConfirmRetryUnavailableError,
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: mocks.loggerError,
  },
}));

import adminUploadJobsRouter from '../routes/admin-upload-jobs';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user?: { id: number; email: string; isAdmin: boolean } }).user = {
      id: 1,
      email: 'admin@example.com',
      isAdmin: true,
    };
    next();
  });
  app.use('/api/admin', adminUploadJobsRouter);
  return app;
}

describe('admin-upload-jobs route coverage: GET /upload-jobs filters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isUploadConfirmRetryUnavailableError.mockImplementation(
      (error: unknown) => Boolean(
        error
        && typeof error === 'object'
        && 'code' in error
        && (error as { code?: unknown }).code === 'UPLOAD_CONFIRM_RETRY_UNAVAILABLE',
      ),
    );
  });

  it('passes uploadType filter correctly', async () => {
    const app = createApp();
    mocks.listAdminUploadJobs.mockResolvedValueOnce({ data: [], total: 0 });

    const response = await request(app)
      .get('/api/admin/upload-jobs')
      .query({ uploadType: 'dead_stock' });

    expect(response.status).toBe(200);
    expect(mocks.listAdminUploadJobs).toHaveBeenCalledWith(expect.objectContaining({
      uploadType: 'dead_stock',
    }));
  });

  it('passes applyMode filter correctly', async () => {
    const app = createApp();
    mocks.listAdminUploadJobs.mockResolvedValueOnce({ data: [], total: 0 });

    const response = await request(app)
      .get('/api/admin/upload-jobs')
      .query({ applyMode: 'diff' });

    expect(response.status).toBe(200);
    expect(mocks.listAdminUploadJobs).toHaveBeenCalledWith(expect.objectContaining({
      applyMode: 'diff',
    }));
  });

  it('passes pharmacyId filter correctly', async () => {
    const app = createApp();
    mocks.listAdminUploadJobs.mockResolvedValueOnce({ data: [], total: 0 });

    const response = await request(app)
      .get('/api/admin/upload-jobs')
      .query({ pharmacyId: '42' });

    expect(response.status).toBe(200);
    expect(mocks.listAdminUploadJobs).toHaveBeenCalledWith(expect.objectContaining({
      pharmacyId: 42,
    }));
  });

  it('ignores invalid pharmacyId filter', async () => {
    const app = createApp();
    mocks.listAdminUploadJobs.mockResolvedValueOnce({ data: [], total: 0 });

    const response = await request(app)
      .get('/api/admin/upload-jobs')
      .query({ pharmacyId: 'abc' });

    expect(response.status).toBe(200);
    expect(mocks.listAdminUploadJobs).toHaveBeenCalledWith(expect.not.objectContaining({
      pharmacyId: expect.anything(),
    }));
  });

  it('ignores invalid status filter', async () => {
    const app = createApp();
    mocks.listAdminUploadJobs.mockResolvedValueOnce({ data: [], total: 0 });

    const response = await request(app)
      .get('/api/admin/upload-jobs')
      .query({ status: 'bogus' });

    expect(response.status).toBe(200);
    expect(mocks.listAdminUploadJobs).toHaveBeenCalledWith(expect.not.objectContaining({
      status: expect.anything(),
    }));
  });

  it('truncates keyword filter to 100 chars', async () => {
    const app = createApp();
    mocks.listAdminUploadJobs.mockResolvedValueOnce({ data: [], total: 0 });

    const longKeyword = 'x'.repeat(200);

    const response = await request(app)
      .get('/api/admin/upload-jobs')
      .query({ keyword: longKeyword });

    expect(response.status).toBe(200);
    expect(mocks.listAdminUploadJobs).toHaveBeenCalledWith(expect.objectContaining({
      keyword: 'x'.repeat(100),
    }));
  });

  it('returns 500 on list service error', async () => {
    const app = createApp();
    mocks.listAdminUploadJobs.mockRejectedValueOnce(new Error('DB error'));

    const response = await request(app)
      .get('/api/admin/upload-jobs');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'アップロードジョブ一覧の取得に失敗しました' });
  });
});

describe('admin-upload-jobs route coverage: GET /upload-jobs/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isUploadConfirmRetryUnavailableError.mockReturnValue(false);
  });

  it('returns 400 for invalid id', async () => {
    const app = createApp();

    const response = await request(app)
      .get('/api/admin/upload-jobs/abc');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: '不正なIDです' });
  });

  it('returns 404 when detail not found', async () => {
    const app = createApp();
    mocks.getAdminUploadJobDetail.mockResolvedValueOnce(null);

    const response = await request(app)
      .get('/api/admin/upload-jobs/999');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'ジョブが見つかりません' });
  });

  it('returns detail for valid id', async () => {
    const app = createApp();
    const detail = {
      id: 101, pharmacyId: 9, uploadType: 'dead_stock',
      status: 'completed', attempts: 1,
    };
    mocks.getAdminUploadJobDetail.mockResolvedValueOnce(detail);

    const response = await request(app)
      .get('/api/admin/upload-jobs/101');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(detail);
  });

  it('returns 500 on detail service error', async () => {
    const app = createApp();
    mocks.getAdminUploadJobDetail.mockRejectedValueOnce(new Error('DB error'));

    const response = await request(app)
      .get('/api/admin/upload-jobs/101');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'アップロードジョブ詳細の取得に失敗しました' });
  });
});

describe('admin-upload-jobs route coverage: PATCH /upload-jobs/:id/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isUploadConfirmRetryUnavailableError.mockReturnValue(false);
  });

  it('returns 400 for invalid id on cancel', async () => {
    const app = createApp();

    const response = await request(app)
      .patch('/api/admin/upload-jobs/0/cancel');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: '不正なIDです' });
  });

  it('returns 404 when cancel target not found', async () => {
    const app = createApp();
    mocks.cancelAdminUploadJob.mockResolvedValueOnce(null);

    const response = await request(app)
      .patch('/api/admin/upload-jobs/999/cancel');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'ジョブが見つかりません' });
  });

  it('returns 409 when cancel not possible (cancelable=false)', async () => {
    const app = createApp();
    mocks.cancelAdminUploadJob.mockResolvedValueOnce({
      id: 101, status: 'completed',
      canceledAt: null, cancelRequestedAt: null, cancelable: false,
    });

    const response = await request(app)
      .patch('/api/admin/upload-jobs/101/cancel');

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'このジョブはキャンセルできません' });
  });

  it('returns 409 when cancel race condition on cancelable job', async () => {
    const app = createApp();
    mocks.cancelAdminUploadJob.mockResolvedValueOnce({
      id: 101, status: 'processing',
      canceledAt: null, cancelRequestedAt: null, cancelable: true,
    });

    const response = await request(app)
      .patch('/api/admin/upload-jobs/101/cancel');

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'キャンセル要求の反映で競合しました。再度お試しください' });
  });

  it('returns deferred cancel message when cancelRequestedAt is set', async () => {
    const app = createApp();
    mocks.cancelAdminUploadJob.mockResolvedValueOnce({
      id: 101, status: 'processing',
      canceledAt: null, cancelRequestedAt: '2026-03-01T00:00:00.000Z', cancelable: true,
    });

    const response = await request(app)
      .patch('/api/admin/upload-jobs/101/cancel');

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('ジョブのキャンセルを受け付けました');
  });

  it('returns 500 on cancel service error', async () => {
    const app = createApp();
    mocks.cancelAdminUploadJob.mockRejectedValueOnce(new Error('DB error'));

    const response = await request(app)
      .patch('/api/admin/upload-jobs/101/cancel');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'アップロードジョブのキャンセルに失敗しました' });
  });
});

describe('admin-upload-jobs route coverage: POST /upload-jobs/:id/retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isUploadConfirmRetryUnavailableError.mockImplementation(
      (error: unknown) => Boolean(
        error
        && typeof error === 'object'
        && 'code' in error
        && (error as { code?: unknown }).code === 'UPLOAD_CONFIRM_RETRY_UNAVAILABLE',
      ),
    );
  });

  it('returns 400 for invalid id on retry', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/admin/upload-jobs/abc/retry');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: '不正なIDです' });
  });

  it('returns 404 when retry target not found', async () => {
    const app = createApp();
    mocks.retryAdminUploadJob.mockResolvedValueOnce(null);

    const response = await request(app)
      .post('/api/admin/upload-jobs/999/retry');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'ジョブが見つかりません' });
  });

  it('returns success on retry', async () => {
    const app = createApp();
    const retried = { id: 101, status: 'pending', attempts: 0 };
    mocks.retryAdminUploadJob.mockResolvedValueOnce(retried);

    const response = await request(app)
      .post('/api/admin/upload-jobs/101/retry');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: 'ジョブを再試行キューへ戻しました',
      job: retried,
    });
  });

  it('returns 500 on retry service error (non-retry-unavailable)', async () => {
    const app = createApp();
    mocks.retryAdminUploadJob.mockRejectedValueOnce(new Error('generic error'));

    const response = await request(app)
      .post('/api/admin/upload-jobs/101/retry');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'アップロードジョブの再試行に失敗しました' });
  });
});

describe('admin-upload-jobs route coverage: GET /upload-jobs/:id/error-report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isUploadConfirmRetryUnavailableError.mockReturnValue(false);
  });

  it('returns 400 for invalid id on error-report', async () => {
    const app = createApp();

    const response = await request(app)
      .get('/api/admin/upload-jobs/-1/error-report');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: '不正なIDです' });
  });

  it('returns 404 when no error report exists', async () => {
    const app = createApp();
    mocks.getAdminUploadJobErrorReport.mockResolvedValueOnce(null);

    const response = await request(app)
      .get('/api/admin/upload-jobs/101/error-report');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'エラーレポートがありません' });
  });

  it('returns JSON error report when format=json', async () => {
    const app = createApp();
    mocks.getAdminUploadJobErrorReport.mockResolvedValueOnce({
      filename: 'upload-job-101-error-report.json',
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ issues: [{ row: 2, code: 'MISSING_DRUG_NAME' }] }),
    });

    const response = await request(app)
      .get('/api/admin/upload-jobs/101/error-report?format=json');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.headers['content-disposition']).toContain('upload-job-101-error-report.json');
  });

  it('returns 500 on error-report service error', async () => {
    const app = createApp();
    mocks.getAdminUploadJobErrorReport.mockRejectedValueOnce(new Error('DB error'));

    const response = await request(app)
      .get('/api/admin/upload-jobs/101/error-report');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'エラーレポートの生成に失敗しました' });
  });
});
