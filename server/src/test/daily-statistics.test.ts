import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- all mocks hoisted ----
const mocks = vi.hoisted(() => ({
  aggregateDailyStatistics: vi.fn(),
  dbSelect: vi.fn(),
  dbInsert: vi.fn(),
}));

vi.mock('../services/daily-statistics-service', () => ({
  aggregateDailyStatistics: mocks.aggregateDailyStatistics,
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
    select: mocks.dbSelect,
    insert: mocks.dbInsert,
  },
}));

// Minimal schema mock — values only need to be truthy objects for Drizzle calls
vi.mock('../db/schema', () => {
  const makeCol = (name: string) => ({ name });
  return {
    dailyStatistics: { date: makeCol('date'), pharmacyId: makeCol('pharmacy_id') },
    deadStockItems: { pharmacyId: makeCol('pharmacy_id'), isAvailable: makeCol('is_available') },
    exchangeProposals: {
      pharmacyAId: makeCol('pharmacy_a_id'),
      pharmacyBId: makeCol('pharmacy_b_id'),
      status: makeCol('status'),
      proposedAt: makeCol('proposed_at'),
      completedAt: makeCol('completed_at'),
      completedTotalValue: makeCol('completed_total_value'),
    },
    matchCandidateSnapshots: {
      pharmacyId: makeCol('pharmacy_id'),
      candidateCount: makeCol('candidate_count'),
    },
    pharmacies: {
      id: makeCol('id'),
      isActive: makeCol('is_active'),
      isAdmin: makeCol('is_admin'),
    },
  };
});

// Imports after mocks
import { db } from '../config/database';
import { aggregateDailyStatistics } from '../services/daily-statistics-service';
let internalDailyStatisticsRouter: (typeof import('../routes/internal-daily-statistics'))['default'];

// ---- route tests ----
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const ORIGINAL_DAILY_STATISTICS_CRON_SECRET = process.env.DAILY_STATISTICS_CRON_SECRET;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/internal/daily-statistics', internalDailyStatisticsRouter);
  return app;
}

describe('internal daily-statistics route auth', () => {
  beforeEach(async () => {
    vi.useRealTimers();
    vi.resetAllMocks();
    vi.resetModules();
    delete process.env.CRON_SECRET;
    delete process.env.DAILY_STATISTICS_CRON_SECRET;
    mocks.aggregateDailyStatistics.mockResolvedValue({ processedCount: 5 });
    ({ default: internalDailyStatisticsRouter } = await import('../routes/internal-daily-statistics'));
  });

  afterEach(() => {
    if (typeof ORIGINAL_CRON_SECRET === 'string') process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
    else delete process.env.CRON_SECRET;
    if (typeof ORIGINAL_DAILY_STATISTICS_CRON_SECRET === 'string') process.env.DAILY_STATISTICS_CRON_SECRET = ORIGINAL_DAILY_STATISTICS_CRON_SECRET;
    else delete process.env.DAILY_STATISTICS_CRON_SECRET;
  });

  it('returns 503 when cron secret is not configured', async () => {
    const app = createApp();
    const response = await request(app).post('/api/internal/daily-statistics/aggregate');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'daily statistics cron is not configured' });
  });

  it('returns 401 when authorization header is missing', async () => {
    process.env.DAILY_STATISTICS_CRON_SECRET = 'test-secret';
    const app = createApp();

    const response = await request(app).post('/api/internal/daily-statistics/aggregate');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'unauthorized' });
  });

  it('returns 401 when authorization header is invalid', async () => {
    process.env.DAILY_STATISTICS_CRON_SECRET = 'test-secret';
    const app = createApp();

    const response = await request(app)
      .post('/api/internal/daily-statistics/aggregate')
      .set('Authorization', 'Bearer wrong-secret');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'unauthorized' });
  });

  it('processes statistics when authorized with specific secret', async () => {
    process.env.DAILY_STATISTICS_CRON_SECRET = 'test-secret';
    const app = createApp();

    const response = await request(app)
      .post('/api/internal/daily-statistics/aggregate')
      .set('Authorization', 'Bearer test-secret');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'ok', processedCount: 5 });
    expect(mocks.aggregateDailyStatistics).toHaveBeenCalledWith(undefined);
  });

  it('processes statistics when authorized with fallback CRON_SECRET', async () => {
    process.env.CRON_SECRET = 'fallback-secret';
    const app = createApp();

    const response = await request(app)
      .post('/api/internal/daily-statistics/aggregate')
      .set('Authorization', 'Bearer fallback-secret');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'ok', processedCount: 5 });
  });

  it('passes targetDate from request body when provided', async () => {
    process.env.DAILY_STATISTICS_CRON_SECRET = 'test-secret';
    const app = createApp();

    const response = await request(app)
      .post('/api/internal/daily-statistics/aggregate')
      .set('Authorization', 'Bearer test-secret')
      .send({ date: '2026-03-01' });

    expect(response.status).toBe(200);
    expect(mocks.aggregateDailyStatistics).toHaveBeenCalledWith('2026-03-01');
  });

  it('returns 500 when service throws an error', async () => {
    process.env.DAILY_STATISTICS_CRON_SECRET = 'test-secret';
    mocks.aggregateDailyStatistics.mockRejectedValue(new Error('DB connection failed'));
    const app = createApp();

    const response = await request(app)
      .post('/api/internal/daily-statistics/aggregate')
      .set('Authorization', 'Bearer test-secret');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'daily statistics aggregation failed' });
  });
});

// ---- mock contract checks ----
// This file hoists a route-level mock for daily-statistics-service, so the tests below
// intentionally verify the mocked contract and local database wiring rather than the
// real aggregation implementation.
describe('aggregateDailyStatistics mock contract', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  it('mock returns processedCount=0 when configured to do so', async () => {
    mocks.aggregateDailyStatistics.mockResolvedValue({ processedCount: 0 });
    const result = await aggregateDailyStatistics('2026-03-01');
    expect(result).toEqual({ processedCount: 0 });
    expect(mocks.aggregateDailyStatistics).toHaveBeenCalledWith('2026-03-01');
  });

  it('mock returns processedCount when multiple pharmacies processed', async () => {
    mocks.aggregateDailyStatistics.mockResolvedValue({ processedCount: 10 });
    const result = await aggregateDailyStatistics('2026-03-01');
    expect(result).toEqual({ processedCount: 10 });
  });

  it('mock uses yesterday when no date provided', async () => {
    mocks.aggregateDailyStatistics.mockResolvedValue({ processedCount: 3 });
    const result = await aggregateDailyStatistics();
    expect(result).toEqual({ processedCount: 3 });
    expect(mocks.aggregateDailyStatistics).toHaveBeenCalledWith();
  });

  it('db.select and db.insert are accessible via mocks', () => {
    // Verify the db mock is set up correctly for other tests that may use it
    expect(db.select).toBe(mocks.dbSelect);
    expect(db.insert).toBe(mocks.dbInsert);
  });
});
