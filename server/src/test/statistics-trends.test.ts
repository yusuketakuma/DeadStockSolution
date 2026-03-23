import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
  },
  getPharmacyRiskDetail: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (
    req: { user?: { id: number; email: string; isAdmin: boolean } },
    _res: unknown,
    next: () => void,
  ) => {
    req.user = { id: 1, email: 'pharmacy@example.com', isAdmin: false };
    next();
  },
  rejectAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/expiry-risk-service', () => ({
  getPharmacyRiskDetail: mocks.getPharmacyRiskDetail,
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: mocks.loggerError,
  },
}));

vi.mock('../services/statistics-cache-service', () => ({
  invalidateStatisticsSummaryCache: vi.fn(),
  invalidateStatisticsSummaryCacheForPharmacies: vi.fn(),
  clearStatisticsSummaryCacheForTests: vi.fn(),
  getCachedStatisticsSummary: vi.fn().mockReturnValue(null),
  setCachedStatisticsSummary: vi.fn(),
}));

import statisticsRouter from '../routes/statistics';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/statistics', statisticsRouter);
  return app;
}

function createOrderedQuery(rows: unknown[]) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockResolvedValue(rows);
  return query;
}

describe('GET /api/statistics/trends', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns 200 with trends, days, and startDate structure', async () => {
    const app = createApp();
    const trendRows = [
      { date: '2026-02-21', metrics: { deadStockCount: 10 } },
      { date: '2026-02-22', metrics: { deadStockCount: 12 } },
    ];
    mocks.db.select.mockImplementationOnce(() => createOrderedQuery(trendRows));

    const response = await request(app).get('/api/statistics/trends');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      trends: trendRows,
      days: 30,
    });
    expect(typeof response.body.startDate).toBe('string');
    expect(response.body.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns 90 days when days=90 is specified', async () => {
    const app = createApp();
    mocks.db.select.mockImplementationOnce(() => createOrderedQuery([]));

    const response = await request(app).get('/api/statistics/trends?days=90');

    expect(response.status).toBe(200);
    expect(response.body.days).toBe(90);
  });

  it('clamps days to 90 when days=999 is specified', async () => {
    const app = createApp();
    mocks.db.select.mockImplementationOnce(() => createOrderedQuery([]));

    const response = await request(app).get('/api/statistics/trends?days=999');

    expect(response.status).toBe(200);
    expect(response.body.days).toBe(90);
  });

  it('clamps days to 1 when days=-1 is specified', async () => {
    const app = createApp();
    mocks.db.select.mockImplementationOnce(() => createOrderedQuery([]));

    const response = await request(app).get('/api/statistics/trends?days=-1');

    expect(response.status).toBe(200);
    expect(response.body.days).toBe(1);
  });

  it('returns 500 when the database query fails', async () => {
    const app = createApp();
    mocks.db.select.mockImplementationOnce(() => {
      throw new Error('db connection lost');
    });

    const response = await request(app).get('/api/statistics/trends');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: '統計情報の取得に失敗しました' });
    expect(mocks.loggerError).toHaveBeenCalledOnce();
  });
});
