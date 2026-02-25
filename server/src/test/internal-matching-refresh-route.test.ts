import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  processPendingMatchingRefreshJobs: vi.fn(),
}));

vi.mock('../services/matching-refresh-service', () => ({
  processPendingMatchingRefreshJobs: mocks.processPendingMatchingRefreshJobs,
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import internalMatchingRefreshRouter from '../routes/internal-matching-refresh';

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const ORIGINAL_MATCHING_REFRESH_CRON_SECRET = process.env.MATCHING_REFRESH_CRON_SECRET;

function createApp() {
  const app = express();
  app.use('/api/internal/matching-refresh', internalMatchingRefreshRouter);
  return app;
}

describe('internal matching refresh route auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
    delete process.env.MATCHING_REFRESH_CRON_SECRET;
    mocks.processPendingMatchingRefreshJobs.mockResolvedValue(3);
  });

  afterEach(() => {
    if (typeof ORIGINAL_CRON_SECRET === 'string') {
      process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
    } else {
      delete process.env.CRON_SECRET;
    }
    if (typeof ORIGINAL_MATCHING_REFRESH_CRON_SECRET === 'string') {
      process.env.MATCHING_REFRESH_CRON_SECRET = ORIGINAL_MATCHING_REFRESH_CRON_SECRET;
    } else {
      delete process.env.MATCHING_REFRESH_CRON_SECRET;
    }
  });

  it('returns 503 when cron secret is not configured', async () => {
    const app = createApp();
    const response = await request(app).get('/api/internal/matching-refresh/retry');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'matching refresh cron is not configured' });
  });

  it('returns 401 when authorization header is invalid', async () => {
    process.env.CRON_SECRET = 'test-secret';
    const app = createApp();

    const response = await request(app)
      .get('/api/internal/matching-refresh/retry')
      .set('Authorization', 'Bearer wrong-secret');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'unauthorized' });
  });

  it('processes pending jobs when authorized', async () => {
    process.env.MATCHING_REFRESH_CRON_SECRET = 'matching-secret';
    const app = createApp();

    const response = await request(app)
      .get('/api/internal/matching-refresh/retry')
      .set('Authorization', 'Bearer matching-secret');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'ok', processed: 3 });
    expect(mocks.processPendingMatchingRefreshJobs).toHaveBeenCalledWith(20);
  });
});

