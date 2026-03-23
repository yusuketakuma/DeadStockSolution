import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
  },
  getObservabilitySnapshot: vi.fn(),
  getMonitoringKpiSnapshot: vi.fn(),
  getLogPushStats: vi.fn(),
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

vi.mock('../services/openclaw-log-push-service', () => ({
  getLogPushStats: mocks.getLogPushStats,
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
  const chain: Record<string, unknown> = {};
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockResolvedValue(result);
  chain.innerJoin = vi.fn().mockReturnValue(chain);
  chain.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

describe('GET /stats — new KPI fields', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes activeRate30d, proposalCompletionRate, and monthlyExchangeValue in response', async () => {
    // 9 parallel queries in fetchAdminStatsSnapshot:
    // 1. pharmacyCount
    // 2. activePharmacyCount
    // 3. uploadCount
    // 4. proposalCount
    // 5. historyCount (completed proposals)
    // 6. pickupCount
    // 7. exchangeAmount
    // 8. activePharmacies30d (distinct pharmacyId with login in last 30d)
    // 9. monthlyExchangeValue
    mocks.db.select
      .mockReturnValueOnce(createSelectChain([{ count: 20 }]))            // pharmacyCount
      .mockReturnValueOnce(createSelectChain([{ count: 15 }]))            // activePharmacyCount
      .mockReturnValueOnce(createSelectChain([{ count: 100 }]))           // uploadCount
      .mockReturnValueOnce(createSelectChain([{ count: 40 }]))            // proposalCount
      .mockReturnValueOnce(createSelectChain([{ count: 10 }]))            // historyCount
      .mockReturnValueOnce(createSelectChain([{ count: 200 }]))           // pickupCount
      .mockReturnValueOnce(createSelectChain([{ total: 500000 }]))        // exchangeAmount
      .mockReturnValueOnce(createSelectChain([{ count: 8 }]))             // activePharmacies30d
      .mockReturnValueOnce(createSelectChain([{ total: 120000 }]));       // monthlyExchangeValue

    const app = createApp();
    const res = await request(app).get('/api/admin/stats');

    expect(res.status).toBe(200);

    // existing fields still present
    expect(res.body.totalPharmacies).toBe(20);
    expect(res.body.activePharmacies).toBe(15);
    expect(res.body.inactivePharmacies).toBe(5);

    // new KPI fields
    expect(typeof res.body.activeRate30d).toBe('number');
    expect(typeof res.body.proposalCompletionRate).toBe('number');
    expect(typeof res.body.monthlyExchangeValue).toBe('number');

    // activeRate30d = 8 active in 30d / 20 total = 0.4
    expect(res.body.activeRate30d).toBeCloseTo(0.4);

    // proposalCompletionRate = 10 completed / 40 total = 0.25
    expect(res.body.proposalCompletionRate).toBeCloseTo(0.25);

    // monthlyExchangeValue = 120000
    expect(res.body.monthlyExchangeValue).toBe(120000);
  });

  it('returns activeRate30d = 0 when there are no pharmacies', async () => {
    mocks.db.select
      .mockReturnValueOnce(createSelectChain([{ count: 0 }]))   // pharmacyCount
      .mockReturnValueOnce(createSelectChain([{ count: 0 }]))   // activePharmacyCount
      .mockReturnValueOnce(createSelectChain([{ count: 0 }]))   // uploadCount
      .mockReturnValueOnce(createSelectChain([{ count: 0 }]))   // proposalCount
      .mockReturnValueOnce(createSelectChain([{ count: 0 }]))   // historyCount
      .mockReturnValueOnce(createSelectChain([{ count: 0 }]))   // pickupCount
      .mockReturnValueOnce(createSelectChain([{ total: 0 }]))   // exchangeAmount
      .mockReturnValueOnce(createSelectChain([{ count: 0 }]))   // activePharmacies30d
      .mockReturnValueOnce(createSelectChain([{ total: 0 }]));  // monthlyExchangeValue

    const app = createApp();
    const res = await request(app).get('/api/admin/stats');

    expect(res.status).toBe(200);
    expect(res.body.activeRate30d).toBe(0);
    expect(res.body.proposalCompletionRate).toBe(0);
    expect(res.body.monthlyExchangeValue).toBe(0);
  });

  it('returns proposalCompletionRate = 0 when there are no proposals', async () => {
    mocks.db.select
      .mockReturnValueOnce(createSelectChain([{ count: 10 }]))  // pharmacyCount
      .mockReturnValueOnce(createSelectChain([{ count: 8 }]))   // activePharmacyCount
      .mockReturnValueOnce(createSelectChain([{ count: 5 }]))   // uploadCount
      .mockReturnValueOnce(createSelectChain([{ count: 0 }]))   // proposalCount (zero)
      .mockReturnValueOnce(createSelectChain([{ count: 0 }]))   // historyCount
      .mockReturnValueOnce(createSelectChain([{ count: 0 }]))   // pickupCount
      .mockReturnValueOnce(createSelectChain([{ total: 0 }]))   // exchangeAmount
      .mockReturnValueOnce(createSelectChain([{ count: 3 }]))   // activePharmacies30d
      .mockReturnValueOnce(createSelectChain([{ total: 0 }]));  // monthlyExchangeValue

    const app = createApp();
    const res = await request(app).get('/api/admin/stats');

    expect(res.status).toBe(200);
    expect(res.body.proposalCompletionRate).toBe(0);
  });

  it('handles null monthlyExchangeValue total gracefully', async () => {
    mocks.db.select
      .mockReturnValueOnce(createSelectChain([{ count: 5 }]))    // pharmacyCount
      .mockReturnValueOnce(createSelectChain([{ count: 4 }]))    // activePharmacyCount
      .mockReturnValueOnce(createSelectChain([{ count: 2 }]))    // uploadCount
      .mockReturnValueOnce(createSelectChain([{ count: 3 }]))    // proposalCount
      .mockReturnValueOnce(createSelectChain([{ count: 1 }]))    // historyCount
      .mockReturnValueOnce(createSelectChain([{ count: 5 }]))    // pickupCount
      .mockReturnValueOnce(createSelectChain([{ total: null }])) // exchangeAmount (null)
      .mockReturnValueOnce(createSelectChain([{ count: 2 }]))    // activePharmacies30d
      .mockReturnValueOnce(createSelectChain([{ total: null }])); // monthlyExchangeValue (null)

    const app = createApp();
    const res = await request(app).get('/api/admin/stats');

    expect(res.status).toBe(200);
    expect(res.body.monthlyExchangeValue).toBe(0);
    expect(res.body.totalExchangeValue).toBe(0);
  });
});
