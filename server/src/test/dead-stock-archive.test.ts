import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  archiveExpiredDeadStock: vi.fn(),
}));

vi.mock('../services/dead-stock-archive-service', () => ({
  archiveExpiredDeadStock: mocks.archiveExpiredDeadStock,
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../config/database', () => ({
  db: {
    update: vi.fn(),
  },
}));

import internalDeadStockArchiveRouter from '../routes/internal-dead-stock-archive';
import { archiveExpiredDeadStock } from '../services/dead-stock-archive-service';

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

function createApp() {
  const app = express();
  app.use('/api/internal/dead-stock', internalDeadStockArchiveRouter);
  return app;
}

describe('POST /api/internal/dead-stock/archive-expired', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
    delete process.env.DEAD_STOCK_ARCHIVE_CRON_SECRET;
    mocks.archiveExpiredDeadStock.mockResolvedValue({ archivedCount: 0 });
  });

  afterEach(() => {
    if (typeof ORIGINAL_CRON_SECRET === 'string') {
      process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
    } else {
      delete process.env.CRON_SECRET;
    }
    delete process.env.DEAD_STOCK_ARCHIVE_CRON_SECRET;
  });

  it('returns 503 when cron secret is not configured', async () => {
    const app = createApp();
    const response = await request(app)
      .post('/api/internal/dead-stock/archive-expired');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'dead stock archive cron is not configured' });
  });

  it('returns 401 when no authorization header provided', async () => {
    process.env.CRON_SECRET = 'test-secret';
    const app = createApp();
    const response = await request(app)
      .post('/api/internal/dead-stock/archive-expired');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'unauthorized' });
  });

  it('returns 401 when wrong authorization header provided', async () => {
    process.env.CRON_SECRET = 'test-secret';
    const app = createApp();
    const response = await request(app)
      .post('/api/internal/dead-stock/archive-expired')
      .set('Authorization', 'Bearer wrong-secret');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'unauthorized' });
  });

  it('returns 200 with archivedCount when authorized with CRON_SECRET', async () => {
    process.env.CRON_SECRET = 'test-secret';
    mocks.archiveExpiredDeadStock.mockResolvedValue({ archivedCount: 5 });
    const app = createApp();
    const response = await request(app)
      .post('/api/internal/dead-stock/archive-expired')
      .set('Authorization', 'Bearer test-secret');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'ok', archivedCount: 5 });
  });

  it('returns 200 with archivedCount 0 when no expired items', async () => {
    process.env.CRON_SECRET = 'test-secret';
    mocks.archiveExpiredDeadStock.mockResolvedValue({ archivedCount: 0 });
    const app = createApp();
    const response = await request(app)
      .post('/api/internal/dead-stock/archive-expired')
      .set('Authorization', 'Bearer test-secret');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'ok', archivedCount: 0 });
  });

  it('uses DEAD_STOCK_ARCHIVE_CRON_SECRET over CRON_SECRET when set', async () => {
    process.env.CRON_SECRET = 'fallback-secret';
    process.env.DEAD_STOCK_ARCHIVE_CRON_SECRET = 'specific-secret';
    mocks.archiveExpiredDeadStock.mockResolvedValue({ archivedCount: 3 });
    const app = createApp();

    // fallback should NOT work
    const responseWithFallback = await request(app)
      .post('/api/internal/dead-stock/archive-expired')
      .set('Authorization', 'Bearer fallback-secret');
    expect(responseWithFallback.status).toBe(401);

    // specific secret should work
    const responseWithSpecific = await request(app)
      .post('/api/internal/dead-stock/archive-expired')
      .set('Authorization', 'Bearer specific-secret');
    expect(responseWithSpecific.status).toBe(200);
  });

  it('returns 500 when archiveExpiredDeadStock throws', async () => {
    process.env.CRON_SECRET = 'test-secret';
    mocks.archiveExpiredDeadStock.mockRejectedValue(new Error('DB connection failed'));
    const app = createApp();
    const response = await request(app)
      .post('/api/internal/dead-stock/archive-expired')
      .set('Authorization', 'Bearer test-secret');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'dead stock archive failed' });
  });
});

describe('archiveExpiredDeadStock service', () => {
  // These tests verify service behavior via the mock expectations
  // since the actual DB calls require PGlite integration tests.

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
    delete process.env.DEAD_STOCK_ARCHIVE_CRON_SECRET;
    mocks.archiveExpiredDeadStock.mockResolvedValue({ archivedCount: 0 });
  });

  afterEach(() => {
    if (typeof ORIGINAL_CRON_SECRET === 'string') {
      process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
    } else {
      delete process.env.CRON_SECRET;
    }
    delete process.env.DEAD_STOCK_ARCHIVE_CRON_SECRET;
  });

  it('is called exactly once per authorized request', async () => {
    process.env.CRON_SECRET = 'test-secret';
    mocks.archiveExpiredDeadStock.mockResolvedValue({ archivedCount: 2 });
    const app = createApp();

    await request(app)
      .post('/api/internal/dead-stock/archive-expired')
      .set('Authorization', 'Bearer test-secret');

    expect(archiveExpiredDeadStock).toHaveBeenCalledTimes(1);
  });

  it('is not called when authorization fails', async () => {
    process.env.CRON_SECRET = 'test-secret';
    const app = createApp();

    await request(app)
      .post('/api/internal/dead-stock/archive-expired')
      .set('Authorization', 'Bearer wrong');

    expect(archiveExpiredDeadStock).not.toHaveBeenCalled();
  });
});
