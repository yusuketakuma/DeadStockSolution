import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runPredictiveAlertsJob: vi.fn(),
}));

vi.mock('../services/predictive-alert-service', () => ({
  runPredictiveAlertsJob: mocks.runPredictiveAlertsJob,
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import internalPredictiveAlertsRouter from '../routes/internal-predictive-alerts';

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const ORIGINAL_PREDICTIVE_ALERTS_CRON_SECRET = process.env.PREDICTIVE_ALERTS_CRON_SECRET;

function createApp() {
  const app = express();
  app.use('/api/internal/predictive-alerts', internalPredictiveAlertsRouter);
  return app;
}

describe('internal predictive alerts route auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
    delete process.env.PREDICTIVE_ALERTS_CRON_SECRET;
    mocks.runPredictiveAlertsJob.mockResolvedValue({
      processedPharmacies: 2,
      generatedAlerts: 2,
      nearExpiryAlerts: 1,
      excessStockAlerts: 1,
      duplicateAlerts: 0,
      failedAlerts: 0,
      generatedAt: '2026-02-28T00:00:00.000Z',
    });
  });

  afterEach(() => {
    if (typeof ORIGINAL_CRON_SECRET === 'string') {
      process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
    } else {
      delete process.env.CRON_SECRET;
    }

    if (typeof ORIGINAL_PREDICTIVE_ALERTS_CRON_SECRET === 'string') {
      process.env.PREDICTIVE_ALERTS_CRON_SECRET = ORIGINAL_PREDICTIVE_ALERTS_CRON_SECRET;
    } else {
      delete process.env.PREDICTIVE_ALERTS_CRON_SECRET;
    }
  });

  it('returns 503 when cron secret is not configured', async () => {
    const app = createApp();
    const response = await request(app).get('/api/internal/predictive-alerts/run');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'predictive alerts cron is not configured' });
  });

  it('returns 401 when authorization header is invalid', async () => {
    process.env.PREDICTIVE_ALERTS_CRON_SECRET = 'predictive-secret';
    const app = createApp();

    const response = await request(app)
      .get('/api/internal/predictive-alerts/run')
      .set('Authorization', 'Bearer wrong-secret');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'unauthorized' });
    expect(mocks.runPredictiveAlertsJob).not.toHaveBeenCalled();
  });

  it('does not accept CRON_SECRET as fallback', async () => {
    process.env.CRON_SECRET = 'shared-cron-secret';
    const app = createApp();

    const response = await request(app)
      .get('/api/internal/predictive-alerts/run')
      .set('Authorization', 'Bearer shared-cron-secret');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'predictive alerts cron is not configured' });
    expect(mocks.runPredictiveAlertsJob).not.toHaveBeenCalled();
  });

  it('runs predictive alert job when authorized', async () => {
    process.env.PREDICTIVE_ALERTS_CRON_SECRET = 'predictive-secret';
    const app = createApp();

    const response = await request(app)
      .get('/api/internal/predictive-alerts/run?nearExpiryDays=20&excessStockMonths=4')
      .set('Authorization', 'Bearer predictive-secret');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: 'ok',
      processedPharmacies: 2,
      generatedAlerts: 2,
      nearExpiryAlerts: 1,
      excessStockAlerts: 1,
      duplicateAlerts: 0,
      failedAlerts: 0,
      generatedAt: '2026-02-28T00:00:00.000Z',
    });
    expect(mocks.runPredictiveAlertsJob).toHaveBeenCalledWith({
      nearExpiryDays: 20,
      excessStockMonths: 4,
    });
  });
});
