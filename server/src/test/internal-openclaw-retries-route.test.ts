import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  processPendingOpenClawRetries: vi.fn(),
  getOpenClawRetryQueueSnapshot: vi.fn(),
}));

vi.mock('../services/openclaw-retry-service', () => ({
  processPendingOpenClawRetries: mocks.processPendingOpenClawRetries,
  getOpenClawRetryQueueSnapshot: mocks.getOpenClawRetryQueueSnapshot,
}));

vi.mock('../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import internalOpenClawRetriesRouter from '../routes/internal-openclaw-retries';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/internal/openclaw-retries', internalOpenClawRetriesRouter);
  return app;
}

describe('internal openclaw retries route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENCLAW_RETRIES_CRON_SECRET = 'secret-123';
  });

  afterEach(() => {
    delete process.env.OPENCLAW_RETRIES_CRON_SECRET;
  });

  it('returns 401 when authorization header is missing', async () => {
    const res = await request(createApp()).get('/api/internal/openclaw-retries/run');
    expect(res.status).toBe(401);
  });

  it('returns 503 when cron secret is not configured', async () => {
    delete process.env.OPENCLAW_RETRIES_CRON_SECRET;
    const res = await request(createApp())
      .get('/api/internal/openclaw-retries/run')
      .set('Authorization', 'Bearer secret-123');
    expect(res.status).toBe(503);
  });

  it('runs pending retries and returns stats', async () => {
    mocks.processPendingOpenClawRetries.mockResolvedValue({
      processed: 2,
      completed: 1,
      deferred: 1,
      failed: 0,
      skipped: 0,
    });
    mocks.getOpenClawRetryQueueSnapshot.mockResolvedValue({
      pending: 3,
      processing: 0,
      completed: 5,
      failed: 1,
    });

    const res = await request(createApp())
      .post('/api/internal/openclaw-retries/run?limit=10')
      .set('Authorization', 'Bearer secret-123');

    expect(res.status).toBe(200);
    expect(mocks.processPendingOpenClawRetries).toHaveBeenCalledWith(10);
    expect(res.body.processed).toBe(2);
    expect(res.body.stats.pending).toBe(3);
  });
});
