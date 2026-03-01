import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
  },
  getPharmacyRiskDetail: vi.fn(),
  loggerError: vi.fn(),
  requireLoginEnabled: { value: true },
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (
    req: { user?: { id: number; email: string; isAdmin: boolean } },
    res: { status: (code: number) => { json: (body: unknown) => void } },
    next: () => void,
  ) => {
    if (!mocks.requireLoginEnabled.value) {
      res.status(401).json({ error: 'ログインが必要です' });
      return;
    }
    req.user = { id: 1, email: 'pharmacy@example.com', isAdmin: false };
    next();
  },
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

import statisticsRouter, { clearStatisticsSummaryCacheForTests } from '../routes/statistics';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/statistics', statisticsRouter);
  return app;
}

function createGroupByQuery(rows: unknown[]) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    groupBy: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.groupBy.mockResolvedValue(rows);
  return query;
}

function createWhereQuery(rows: unknown[]) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockResolvedValue(rows);
  return query;
}

function mockSummarySelectSequence(): void {
  mocks.db.select
    .mockImplementationOnce(() => createGroupByQuery([
      { uploadType: 'dead_stock', count: 4, lastDate: '2026-03-01T00:00:00.000Z' },
      { uploadType: 'used_medication', count: 2, lastDate: '2026-03-01T01:00:00.000Z' },
    ]))
    .mockImplementationOnce(() => createWhereQuery([{ count: 5, totalValue: 12345 }]))
    .mockImplementationOnce(() => createWhereQuery([{
      sent: 8,
      received: 9,
      completed: 3,
      pendingAction: 4,
    }]))
    .mockImplementationOnce(() => createWhereQuery([{ totalCount: 6, totalValue: 7800, partnerCount: 4 }]))
    .mockImplementationOnce(() => createWhereQuery([{ candidateCount: 11 }]))
    .mockImplementationOnce(() => createWhereQuery([{ trustScore: 77, ratingCount: 5, positiveRate: 80 }]))
    .mockImplementationOnce(() => createWhereQuery([{ avgRating: 4.2, count: 5 }]))
    .mockImplementationOnce(() => createWhereQuery([{ count: 3 }]))
    .mockImplementationOnce(() => createWhereQuery([{ count: 2 }]));
}

describe('statistics routes', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clearStatisticsSummaryCacheForTests();
    mocks.requireLoginEnabled.value = true;
  });

  it('GET /api/statistics/summary returns aggregated summary payload', async () => {
    const app = createApp();
    mockSummarySelectSequence();
    mocks.getPharmacyRiskDetail.mockResolvedValue({
      riskScore: 61,
      bucketCounts: {
        expired: 1,
        within30: 2,
        within60: 3,
        within90: 0,
        within120: 0,
        over120: 0,
        unknown: 0,
      },
    });

    const response = await request(app).get('/api/statistics/summary');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      uploads: {
        deadStockCount: 4,
        usedMedicationCount: 2,
        lastDeadStockUpload: '2026-03-01T00:00:00.000Z',
        lastUsedMedicationUpload: '2026-03-01T01:00:00.000Z',
      },
      inventory: {
        deadStockItems: 5,
        deadStockTotalValue: 12345,
        riskScore: 61,
        bucketCounts: {
          expired: 1,
          within30: 2,
          within60: 3,
          within90: 0,
          within120: 0,
          over120: 0,
          unknown: 0,
        },
      },
      proposals: {
        sent: 8,
        received: 9,
        completed: 3,
        pendingAction: 4,
      },
      exchanges: {
        totalCount: 6,
        totalValue: 7800,
      },
      matching: {
        candidateCount: 11,
      },
      trust: {
        score: 77,
        ratingCount: 5,
        positiveRate: 80,
        avgRatingReceived: 4.2,
        feedbackCount: 5,
      },
      network: {
        favoriteCount: 3,
        tradingPartnerCount: 4,
      },
      alerts: {
        activeCount: 2,
      },
    });
  });

  it('GET /api/statistics/summary falls back when risk detail lookup fails', async () => {
    const app = createApp();
    mockSummarySelectSequence();
    mocks.getPharmacyRiskDetail.mockRejectedValue(new Error('risk service unavailable'));

    const response = await request(app).get('/api/statistics/summary');

    expect(response.status).toBe(200);
    expect(response.body.inventory.riskScore).toBe(0);
    expect(response.body.inventory.bucketCounts).toBeNull();
  });

  it('GET /api/statistics/summary uses short-lived cache to reduce repeated aggregation', async () => {
    const app = createApp();
    mockSummarySelectSequence();
    mocks.getPharmacyRiskDetail.mockResolvedValue({
      riskScore: 40,
      bucketCounts: null,
    });

    const first = await request(app).get('/api/statistics/summary');
    const second = await request(app).get('/api/statistics/summary');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(mocks.db.select).toHaveBeenCalledTimes(9);
    expect(mocks.getPharmacyRiskDetail).toHaveBeenCalledTimes(1);
  });

  it('GET /api/statistics/summary returns 500 when aggregation query fails', async () => {
    const app = createApp();
    mocks.db.select.mockImplementationOnce(() => {
      throw new Error('db unavailable');
    });

    const response = await request(app).get('/api/statistics/summary');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: '統計情報の取得に失敗しました' });
  });
});
