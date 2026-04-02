import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  triggerManualAutoSync: vi.fn(),
  triggerManualPackageAutoSync: vi.fn(),
}));

vi.mock('../services/drug-master/scheduler', () => ({
  triggerManualAutoSync: mocks.triggerManualAutoSync,
}));

vi.mock('../services/drug-package-scheduler', () => ({
  triggerManualPackageAutoSync: mocks.triggerManualPackageAutoSync,
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

let internalDrugMasterSyncRouter: (typeof import('../routes/internal-drug-master-sync'))['default'];

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;
const ORIGINAL_DRUG_MASTER_SYNC_CRON_SECRET = process.env.DRUG_MASTER_SYNC_CRON_SECRET;

function createApp() {
  const app = express();
  app.use('/api/internal/drug-master-sync', internalDrugMasterSyncRouter);
  return app;
}

describe('internal drug master sync route', () => {
  beforeEach(async () => {
    vi.useRealTimers();
    vi.resetAllMocks();
    vi.resetModules();
    ({ default: internalDrugMasterSyncRouter } = await import('../routes/internal-drug-master-sync'));
    delete process.env.CRON_SECRET;
    delete process.env.DRUG_MASTER_SYNC_CRON_SECRET;
    mocks.triggerManualAutoSync.mockResolvedValue({ updated: false, changed: false });
    mocks.triggerManualPackageAutoSync.mockResolvedValue({ updated: false, changed: false });
  });

  afterEach(() => {
    if (typeof ORIGINAL_CRON_SECRET === 'string') {
      process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
    } else {
      delete process.env.CRON_SECRET;
    }
    if (typeof ORIGINAL_DRUG_MASTER_SYNC_CRON_SECRET === 'string') {
      process.env.DRUG_MASTER_SYNC_CRON_SECRET = ORIGINAL_DRUG_MASTER_SYNC_CRON_SECRET;
    } else {
      delete process.env.DRUG_MASTER_SYNC_CRON_SECRET;
    }
  });

  it('returns 503 when cron secret is not configured', async () => {
    const app = createApp();

    const response = await request(app).post('/api/internal/drug-master-sync/run');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'drug master sync cron is not configured' });
    expect(mocks.triggerManualAutoSync).not.toHaveBeenCalled();
    expect(mocks.triggerManualPackageAutoSync).not.toHaveBeenCalled();
  });

  it('returns 401 when authorization header is invalid', async () => {
    process.env.DRUG_MASTER_SYNC_CRON_SECRET = 'drug-master-secret';
    const app = createApp();

    const response = await request(app)
      .post('/api/internal/drug-master-sync/run')
      .set('Authorization', 'Bearer wrong-secret');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'unauthorized' });
    expect(mocks.triggerManualAutoSync).not.toHaveBeenCalled();
    expect(mocks.triggerManualPackageAutoSync).not.toHaveBeenCalled();
  });

  it('runs both sync phases when authorized', async () => {
    process.env.DRUG_MASTER_SYNC_CRON_SECRET = 'drug-master-secret';
    mocks.triggerManualAutoSync.mockResolvedValueOnce({ updated: true, changed: true, source: 'mhlw' });
    mocks.triggerManualPackageAutoSync.mockResolvedValueOnce({ updated: false, changed: false, source: 'medis' });
    const app = createApp();

    const response = await request(app)
      .post('/api/internal/drug-master-sync/run')
      .set('Authorization', 'Bearer drug-master-secret');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      message: 'ok',
      drugSync: { updated: true, changed: true, source: 'mhlw' },
      packageSync: { updated: false, changed: false, source: 'medis' },
    }));
    expect(typeof response.body.durationMs).toBe('number');
    expect(mocks.triggerManualAutoSync).toHaveBeenCalledTimes(1);
    expect(mocks.triggerManualPackageAutoSync).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when either sync phase throws', async () => {
    process.env.DRUG_MASTER_SYNC_CRON_SECRET = 'drug-master-secret';
    mocks.triggerManualAutoSync.mockRejectedValueOnce(new Error('upstream unavailable'));
    const app = createApp();

    const response = await request(app)
      .post('/api/internal/drug-master-sync/run')
      .set('Authorization', 'Bearer drug-master-secret');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'drug master sync failed' });
    expect(mocks.triggerManualAutoSync).toHaveBeenCalledTimes(1);
    expect(mocks.triggerManualPackageAutoSync).not.toHaveBeenCalled();
  });
});
