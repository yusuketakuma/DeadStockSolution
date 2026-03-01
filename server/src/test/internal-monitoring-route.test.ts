import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getMonitoringKpiSnapshot: vi.fn(),
}));

vi.mock('../services/monitoring-kpi-service', () => ({
  getMonitoringKpiSnapshot: mocks.getMonitoringKpiSnapshot,
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import internalMonitoringRouter from '../routes/internal-monitoring';

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const ORIGINAL_UPLOAD_JOBS_CRON_SECRET = process.env.UPLOAD_JOBS_CRON_SECRET;
const ORIGINAL_MONITORING_CRON_SECRET = process.env.MONITORING_CRON_SECRET;

function createApp() {
  const app = express();
  app.use('/api/internal/monitoring', internalMonitoringRouter);
  return app;
}

describe('internal monitoring route auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
    delete process.env.UPLOAD_JOBS_CRON_SECRET;
    delete process.env.MONITORING_CRON_SECRET;
    mocks.getMonitoringKpiSnapshot.mockResolvedValue({
      status: 'healthy',
      metrics: {
        errorRate5xx: 0,
        uploadFailureRate: 0,
        pendingUploadStaleCount: 0,
      },
      thresholds: {
        errorRate5xx: 2,
        uploadFailureRate: 10,
        pendingStaleCount: 5,
        pendingStaleMinutes: 60,
      },
      breaches: {
        errorRate5xx: false,
        uploadFailureRate: false,
        pendingStaleCount: false,
      },
      context: {
        windowMinutes: 60,
        uploadWindowHours: 24,
      },
    });
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
    if (typeof ORIGINAL_MONITORING_CRON_SECRET === 'string') {
      process.env.MONITORING_CRON_SECRET = ORIGINAL_MONITORING_CRON_SECRET;
    } else {
      delete process.env.MONITORING_CRON_SECRET;
    }
  });

  it('returns 503 when monitoring cron secret is not configured', async () => {
    const app = createApp();
    const response = await request(app).get('/api/internal/monitoring/kpis');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'monitoring cron is not configured' });
  });

  it('returns 401 when authorization header is invalid', async () => {
    process.env.MONITORING_CRON_SECRET = 'monitoring-secret';
    const app = createApp();

    const response = await request(app)
      .get('/api/internal/monitoring/kpis')
      .set('Authorization', 'Bearer invalid-secret');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'unauthorized' });
    expect(mocks.getMonitoringKpiSnapshot).not.toHaveBeenCalled();
  });

  it('does not accept upload jobs secret as fallback', async () => {
    process.env.UPLOAD_JOBS_CRON_SECRET = 'upload-jobs-secret';
    const app = createApp();

    const response = await request(app)
      .get('/api/internal/monitoring/kpis')
      .set('Authorization', 'Bearer upload-jobs-secret');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'monitoring cron is not configured' });
    expect(mocks.getMonitoringKpiSnapshot).not.toHaveBeenCalled();
  });

  it('returns KPI snapshot when authorized', async () => {
    process.env.MONITORING_CRON_SECRET = 'monitoring-secret';
    const app = createApp();

    const response = await request(app)
      .get('/api/internal/monitoring/kpis?minutes=30')
      .set('Authorization', 'Bearer monitoring-secret');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      status: 'healthy',
      metrics: expect.any(Object),
    }));
    expect(mocks.getMonitoringKpiSnapshot).toHaveBeenCalledWith(30);
  });

  it('accepts POST requests', async () => {
    process.env.MONITORING_CRON_SECRET = 'monitoring-secret';
    const app = createApp();

    const response = await request(app)
      .post('/api/internal/monitoring/kpis')
      .set('Authorization', 'Bearer monitoring-secret');

    expect(response.status).toBe(200);
    expect(mocks.getMonitoringKpiSnapshot).toHaveBeenCalledWith(60);
  });
});
