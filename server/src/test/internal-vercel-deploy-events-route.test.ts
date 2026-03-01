import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  recordVercelDeployEvent: vi.fn(),
}));

vi.mock('../services/system-event-service', () => ({
  recordVercelDeployEvent: mocks.recordVercelDeployEvent,
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import internalVercelDeployEventsRouter from '../routes/internal-vercel-deploy-events';

const ORIGINAL_SECRET = process.env.VERCEL_DEPLOY_WEBHOOK_SECRET;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/internal/vercel', internalVercelDeployEventsRouter);
  return app;
}

describe('internal vercel deploy events route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recordVercelDeployEvent.mockResolvedValue(true);
    delete process.env.VERCEL_DEPLOY_WEBHOOK_SECRET;
  });

  afterEach(() => {
    if (typeof ORIGINAL_SECRET === 'string') {
      process.env.VERCEL_DEPLOY_WEBHOOK_SECRET = ORIGINAL_SECRET;
    } else {
      delete process.env.VERCEL_DEPLOY_WEBHOOK_SECRET;
    }
  });

  it('returns 503 when webhook secret is not configured', async () => {
    const app = createApp();
    const response = await request(app)
      .post('/api/internal/vercel/deploy-events')
      .send({ type: 'deployment.error' });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: 'vercel deploy webhook is not configured' });
  });

  it('returns 401 when authorization header is invalid', async () => {
    process.env.VERCEL_DEPLOY_WEBHOOK_SECRET = 'secret-token';
    const app = createApp();

    const response = await request(app)
      .post('/api/internal/vercel/deploy-events')
      .set('Authorization', 'Bearer invalid-token')
      .send({ type: 'deployment.error' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'unauthorized' });
    expect(mocks.recordVercelDeployEvent).not.toHaveBeenCalled();
  });

  it('records vercel deploy event when authorized', async () => {
    process.env.VERCEL_DEPLOY_WEBHOOK_SECRET = 'secret-token';
    const app = createApp();

    const response = await request(app)
      .post('/api/internal/vercel/deploy-events')
      .set('Authorization', 'Bearer secret-token')
      .send({
        type: 'deployment.error',
        payload: {
          id: 'dpl_123',
          url: 'deadstocksolution.vercel.app',
          state: 'ERROR',
          target: 'production',
          error: {
            message: 'Build failed: tsc error',
          },
        },
      });

    expect(response.status).toBe(202);
    expect(mocks.recordVercelDeployEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'deployment.error:ERROR',
      level: 'error',
      deploymentId: 'dpl_123',
      url: 'deadstocksolution.vercel.app',
    }));
  });

  it('returns 500 when event persistence fails', async () => {
    process.env.VERCEL_DEPLOY_WEBHOOK_SECRET = 'secret-token';
    mocks.recordVercelDeployEvent.mockResolvedValueOnce(false);
    const app = createApp();

    const response = await request(app)
      .post('/api/internal/vercel/deploy-events')
      .set('Authorization', 'Bearer secret-token')
      .send({
        type: 'deployment.error',
        payload: {
          id: 'dpl_500',
          state: 'ERROR',
        },
      });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'vercel deploy event ingest failed' });
  });
});
