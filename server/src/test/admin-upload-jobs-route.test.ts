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

describe('admin upload jobs routes', () => {
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

  it('GET /upload-jobs returns paginated list', async () => {
    const app = createApp();
    mocks.listAdminUploadJobs.mockResolvedValueOnce({
      data: [
        {
          id: 101,
          pharmacyId: 9,
          pharmacyName: '青葉薬局',
          uploadType: 'dead_stock',
          originalFilename: 'dead-stock.xlsx',
          status: 'pending',
          applyMode: 'replace',
          attempts: 0,
          deduplicated: false,
          cancelable: true,
          canceledAt: null,
          createdAt: '2026-02-28T00:00:00.000Z',
          updatedAt: '2026-02-28T00:00:00.000Z',
          completedAt: null,
          partialSummary: null,
          errorReportAvailable: false,
        },
      ],
      total: 1,
    });

    const response = await request(app)
      .get('/api/admin/upload-jobs')
      .query({ page: 1, limit: 20, status: 'pending' });

    expect(response.status).toBe(200);
    expect(response.body.pagination).toEqual(expect.objectContaining({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    }));
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toEqual(expect.objectContaining({
      id: 101,
      cancelable: true,
    }));
    expect(mocks.listAdminUploadJobs).toHaveBeenCalledWith(expect.objectContaining({
      page: 1,
      limit: 20,
      status: 'pending',
    }));
  });

  it('GET /upload-jobs normalizes cancelled alias and keyword filter', async () => {
    const app = createApp();
    mocks.listAdminUploadJobs.mockResolvedValueOnce({
      data: [],
      total: 0,
    });

    const response = await request(app)
      .get('/api/admin/upload-jobs')
      .query({
        page: 1,
        limit: 10,
        status: 'cancelled',
        keyword: 'partial failure',
      });

    expect(response.status).toBe(200);
    expect(mocks.listAdminUploadJobs).toHaveBeenCalledWith(expect.objectContaining({
      page: 1,
      limit: 10,
      status: 'canceled',
      keyword: 'partial failure',
    }));
  });

  it('PATCH /upload-jobs/:id/cancel cancels job', async () => {
    const app = createApp();
    mocks.cancelAdminUploadJob.mockResolvedValueOnce({
      id: 101,
      status: 'failed',
      canceledAt: '2026-02-28T01:00:00.000Z',
      cancelRequestedAt: '2026-02-28T01:00:00.000Z',
      cancelable: false,
    });

    const response = await request(app)
      .patch('/api/admin/upload-jobs/101/cancel');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: 'ジョブをキャンセルしました',
      job: {
        id: 101,
        status: 'failed',
        canceledAt: '2026-02-28T01:00:00.000Z',
        cancelRequestedAt: '2026-02-28T01:00:00.000Z',
        cancelable: false,
      },
    });
  });

  it('POST /upload-jobs/:id/retry returns 409 when retry is unavailable', async () => {
    const app = createApp();
    mocks.retryAdminUploadJob.mockRejectedValueOnce(Object.assign(
      new Error('元ファイルが保持されていないため再試行できません'),
      {
        code: 'UPLOAD_CONFIRM_RETRY_UNAVAILABLE',
      },
    ));

    const response = await request(app)
      .post('/api/admin/upload-jobs/101/retry');

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: '元ファイルが保持されていないため再試行できません',
      code: 'UPLOAD_CONFIRM_RETRY_UNAVAILABLE',
    });
  });

  it('GET /upload-jobs/:id/error-report returns csv attachment', async () => {
    const app = createApp();
    mocks.getAdminUploadJobErrorReport.mockResolvedValueOnce({
      filename: 'upload-job-101-error-report-20260228010101.csv',
      contentType: 'text/csv; charset=utf-8',
      body: 'rowNumber,issueCode\n2,MISSING_DRUG_NAME',
      issueCount: 1,
    });

    const response = await request(app)
      .get('/api/admin/upload-jobs/101/error-report?format=csv');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('attachment; filename="upload-job-101-error-report-20260228010101.csv"');
    expect(response.text).toContain('MISSING_DRUG_NAME');
  });
});
