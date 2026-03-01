import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  processPendingUploadConfirmJobs: vi.fn(),
  cleanupUploadConfirmJobs: vi.fn(),
}));

vi.mock('../services/upload-confirm-job-service', () => ({
  processPendingUploadConfirmJobs: mocks.processPendingUploadConfirmJobs,
  cleanupUploadConfirmJobs: mocks.cleanupUploadConfirmJobs,
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import internalUploadJobsRouter from '../routes/internal-upload-jobs';

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const ORIGINAL_UPLOAD_JOBS_CRON_SECRET = process.env.UPLOAD_JOBS_CRON_SECRET;

function createApp() {
  const app = express();
  app.use('/api/internal/upload-jobs', internalUploadJobsRouter);
  return app;
}

describe('internal upload jobs route auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
    delete process.env.UPLOAD_JOBS_CRON_SECRET;
    mocks.processPendingUploadConfirmJobs.mockResolvedValue(4);
    mocks.cleanupUploadConfirmJobs.mockResolvedValue(2);
  });

  afterEach(() => {
    if (typeof ORIGINAL_CRON_SECRET === 'string') {
      process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
    } else {
      delete process.env.CRON_SECRET;
    }
    if (typeof ORIGINAL_UPLOAD_JOBS_CRON_SECRET === 'string') {
      process.env.UPLOAD_JOBS_CRON_SECRET = ORIGINAL_UPLOAD_JOBS_CRON_SECRET;
    } else {
      delete process.env.UPLOAD_JOBS_CRON_SECRET;
    }
  });

  it('returns 503 when cron secret is not configured', async () => {
    const app = createApp();
    const response = await request(app).get('/api/internal/upload-jobs/retry');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'upload jobs cron is not configured' });
  });

  it('returns 401 when authorization header is invalid', async () => {
    process.env.UPLOAD_JOBS_CRON_SECRET = 'upload-secret';
    const app = createApp();

    const response = await request(app)
      .get('/api/internal/upload-jobs/retry')
      .set('Authorization', 'Bearer wrong-secret');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'unauthorized' });
    expect(mocks.processPendingUploadConfirmJobs).not.toHaveBeenCalled();
    expect(mocks.cleanupUploadConfirmJobs).not.toHaveBeenCalled();
  });

  it('processes and cleans jobs when authorized', async () => {
    process.env.UPLOAD_JOBS_CRON_SECRET = 'upload-secret';
    const app = createApp();

    const response = await request(app)
      .get('/api/internal/upload-jobs/retry')
      .set('Authorization', 'Bearer upload-secret');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: 'ok',
      processed: 4,
      cleaned: 2,
    });
    expect(mocks.processPendingUploadConfirmJobs).toHaveBeenCalledWith(1);
    expect(mocks.cleanupUploadConfirmJobs).toHaveBeenCalledWith(50);
  });

  it('uses query limits when provided', async () => {
    process.env.UPLOAD_JOBS_CRON_SECRET = 'upload-secret';
    const app = createApp();

    const response = await request(app)
      .get('/api/internal/upload-jobs/retry?limit=5&cleanupLimit=120')
      .set('Authorization', 'Bearer upload-secret');

    expect(response.status).toBe(200);
    expect(mocks.processPendingUploadConfirmJobs).toHaveBeenCalledWith(1);
    expect(mocks.cleanupUploadConfirmJobs).toHaveBeenCalledWith(120);
  });

  it('accepts POST for retry endpoint', async () => {
    process.env.UPLOAD_JOBS_CRON_SECRET = 'upload-secret';
    const app = createApp();

    const response = await request(app)
      .post('/api/internal/upload-jobs/retry')
      .set('Authorization', 'Bearer upload-secret');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: 'ok',
      processed: 4,
      cleaned: 2,
    });
    expect(mocks.processPendingUploadConfirmJobs).toHaveBeenCalledWith(1);
  });
});
