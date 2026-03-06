import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
  },
  getObservabilitySnapshot: vi.fn(),
  getMonitoringKpiSnapshot: vi.fn(),
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/observability-service', () => ({
  getObservabilitySnapshot: mocks.getObservabilitySnapshot,
}));

vi.mock('../services/monitoring-kpi-service', () => ({
  getMonitoringKpiSnapshot: mocks.getMonitoringKpiSnapshot,
}));

vi.mock('../services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../middleware/error-handler', () => ({
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  gte: vi.fn(() => ({})),
  sql: Object.assign(
    vi.fn(() => ({})),
    { raw: vi.fn(() => ({})) },
  ),
}));

import adminStatsRouter from '../routes/admin-stats';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminStatsRouter);
  return app;
}

function createSelectChain(result: unknown[]) {
  // Create a "thenable" chain: the chain itself can be used as a Promise
  // and also supports .from().where() or .from().innerJoin().where()
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockResolvedValue(result);
  chain.innerJoin = vi.fn().mockReturnValue(chain);
  // Make the chain itself thenable for cases like db.select().from(table) without .where()
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

describe('admin-stats routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /stats', () => {
    it('returns aggregated stats', async () => {
      // The route makes 7 parallel queries via Promise.all
      // Each resolves to [{ count: N }] or [{ total: N }]
      mocks.db.select
        .mockReturnValueOnce(createSelectChain([{ count: 20 }]))   // pharmacyCount
        .mockReturnValueOnce(createSelectChain([{ count: 15 }]))   // activePharmacyCount
        .mockReturnValueOnce(createSelectChain([{ count: 100 }]))  // uploadCount
        .mockReturnValueOnce(createSelectChain([{ count: 50 }]))   // proposalCount
        .mockReturnValueOnce(createSelectChain([{ count: 30 }]))   // historyCount
        .mockReturnValueOnce(createSelectChain([{ count: 200 }]))  // pickupCount
        .mockReturnValueOnce(createSelectChain([{ total: 500000 }])); // exchangeAmount

      const app = createApp();
      const res = await request(app).get('/api/admin/stats');

      expect(res.status).toBe(200);
      expect(res.body.totalPharmacies).toBe(20);
      expect(res.body.activePharmacies).toBe(15);
      expect(res.body.inactivePharmacies).toBe(5);
      expect(res.body.totalUploads).toBe(100);
      expect(res.body.totalProposals).toBe(50);
      expect(res.body.totalExchanges).toBe(30);
      expect(res.body.totalPickupItems).toBe(200);
      expect(res.body.totalExchangeValue).toBe(500000);
    });

    it('returns 500 on db error', async () => {
      mocks.db.select.mockImplementation(() => {
        throw new Error('db connection failed');
      });

      const app = createApp();
      const res = await request(app).get('/api/admin/stats');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('統計情報の取得に失敗しました');
    });
  });

  describe('GET /alerts', () => {
    it('returns alert counts', async () => {
      // 5 parallel queries: failedUploadJobs, stalledUploadJobs, unreadNotifications, unreadMatchNotifications, pendingProposals
      mocks.db.select
        .mockReturnValueOnce(createSelectChain([{ count: 3 }]))   // failedUploadJobs
        .mockReturnValueOnce(createSelectChain([{ count: 1 }]))   // stalledUploadJobs
        .mockReturnValueOnce(createSelectChain([{ count: 5 }]))   // unreadNotifications
        .mockReturnValueOnce(createSelectChain([{ count: 2 }]))   // unreadMatchNotifications
        .mockReturnValueOnce(createSelectChain([{ count: 4 }]));  // pendingProposals

      const app = createApp();
      const res = await request(app).get('/api/admin/alerts');

      expect(res.status).toBe(200);
      expect(res.body.failedUploadJobs24h).toBe(3);
      expect(res.body.stalledUploadJobs24h).toBe(1);
      expect(res.body.unreadNotifications).toBe(7); // 5 + 2
      expect(res.body.pendingProposalActions24h).toBe(4);
    });

    it('returns 500 on db error', async () => {
      mocks.db.select.mockImplementation(() => {
        throw new Error('db connection failed');
      });

      const app = createApp();
      const res = await request(app).get('/api/admin/alerts');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('アラート集計の取得に失敗しました');
    });
  });

  describe('GET /kpis', () => {
    it('returns KPI snapshot with default minutes', async () => {
      const snapshot = {
        status: 'healthy',
        metrics: { errorRate5xx: 0, uploadFailureRate: 0, pendingUploadStaleCount: 0 },
        thresholds: {},
        breaches: {},
      };
      mocks.getMonitoringKpiSnapshot.mockResolvedValue(snapshot);

      const app = createApp();
      const res = await request(app).get('/api/admin/kpis');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(mocks.getMonitoringKpiSnapshot).toHaveBeenCalledWith(60);
    });

    it('accepts custom minutes parameter', async () => {
      mocks.getMonitoringKpiSnapshot.mockResolvedValue({ status: 'healthy' });

      const app = createApp();
      await request(app).get('/api/admin/kpis?minutes=30');

      expect(mocks.getMonitoringKpiSnapshot).toHaveBeenCalledWith(30);
    });

    it('falls back to 60 when minutes is NaN', async () => {
      mocks.getMonitoringKpiSnapshot.mockResolvedValue({ status: 'healthy' });

      const app = createApp();
      await request(app).get('/api/admin/kpis?minutes=abc');

      expect(mocks.getMonitoringKpiSnapshot).toHaveBeenCalledWith(60);
    });

    it('returns 500 on service error', async () => {
      mocks.getMonitoringKpiSnapshot.mockRejectedValue(new Error('kpi error'));

      const app = createApp();
      const res = await request(app).get('/api/admin/kpis');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('KPI監視情報の取得に失敗しました');
    });
  });

  describe('GET /observability', () => {
    it('returns observability snapshot with default minutes', async () => {
      const snapshot = {
        windowMinutes: 60,
        totalRequests: 100,
        totalErrors5xx: 2,
        errorRate5xx: 0.02,
      };
      mocks.getObservabilitySnapshot.mockReturnValue(snapshot);

      const app = createApp();
      const res = await request(app).get('/api/admin/observability');

      expect(res.status).toBe(200);
      expect(res.body.windowMinutes).toBe(60);
      expect(mocks.getObservabilitySnapshot).toHaveBeenCalledWith(60);
    });

    it('accepts custom minutes parameter', async () => {
      mocks.getObservabilitySnapshot.mockReturnValue({});

      const app = createApp();
      await request(app).get('/api/admin/observability?minutes=15');

      expect(mocks.getObservabilitySnapshot).toHaveBeenCalledWith(15);
    });

    it('falls back to 60 when minutes is NaN', async () => {
      mocks.getObservabilitySnapshot.mockReturnValue({});

      const app = createApp();
      await request(app).get('/api/admin/observability?minutes=invalid');

      expect(mocks.getObservabilitySnapshot).toHaveBeenCalledWith(60);
    });

    it('returns 500 on service error', async () => {
      mocks.getObservabilitySnapshot.mockImplementation(() => {
        throw new Error('observability error');
      });

      const app = createApp();
      const res = await request(app).get('/api/admin/observability');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('監視情報の取得に失敗しました');
    });
  });
});
