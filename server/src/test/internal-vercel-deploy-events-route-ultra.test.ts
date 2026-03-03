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

describe('internal vercel deploy events ultra coverage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
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

  it('handles payload with no deployment id (no dedupe)', async () => {
    process.env.VERCEL_DEPLOY_WEBHOOK_SECRET = 'test-secret';
    const app = createApp();

    const response = await request(app)
      .post('/api/internal/vercel/deploy-events')
      .set('Authorization', 'Bearer test-secret')
      .send({
        type: 'deployment.created',
        payload: {
          state: 'BUILDING',
          target: 'preview',
        },
      });

    expect(response.status).toBe(202);
    expect(mocks.recordVercelDeployEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'deployment.created:BUILDING',
      level: 'warning',
    }));
  });

  it('handles body with no payload object', async () => {
    process.env.VERCEL_DEPLOY_WEBHOOK_SECRET = 'test-secret';
    const app = createApp();

    const response = await request(app)
      .post('/api/internal/vercel/deploy-events')
      .set('Authorization', 'Bearer test-secret')
      .send({
        type: 'deployment.unknown',
      });

    expect(response.status).toBe(202);
    expect(mocks.recordVercelDeployEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'deployment.unknown',
    }));
  });

  it('uses event field when type is not present', async () => {
    process.env.VERCEL_DEPLOY_WEBHOOK_SECRET = 'test-secret';
    const app = createApp();

    const response = await request(app)
      .post('/api/internal/vercel/deploy-events')
      .set('Authorization', 'Bearer test-secret')
      .send({
        event: 'my-event',
        payload: {
          id: 'dpl_ev',
          state: 'READY',
        },
      });

    expect(response.status).toBe(202);
    expect(mocks.recordVercelDeployEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'my-event:READY',
      level: 'info',
    }));
  });

  it('fallback eventType when neither type nor event nor state present', async () => {
    process.env.VERCEL_DEPLOY_WEBHOOK_SECRET = 'test-secret';
    const app = createApp();

    const response = await request(app)
      .post('/api/internal/vercel/deploy-events')
      .set('Authorization', 'Bearer test-secret')
      .send({});

    expect(response.status).toBe(202);
    expect(mocks.recordVercelDeployEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'deployment:unknown',
    }));
  });

  it('uses explicit message from body.message', async () => {
    process.env.VERCEL_DEPLOY_WEBHOOK_SECRET = 'test-secret';
    const app = createApp();

    const response = await request(app)
      .post('/api/internal/vercel/deploy-events')
      .set('Authorization', 'Bearer test-secret')
      .send({
        type: 'deployment.created',
        message: 'Custom message for deploy',
        payload: { id: 'dpl_msg', state: 'BUILDING' },
      });

    expect(response.status).toBe(202);
    expect(mocks.recordVercelDeployEvent).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Custom message for deploy',
    }));
  });

  it('falls back to error.message when no body.message', async () => {
    process.env.VERCEL_DEPLOY_WEBHOOK_SECRET = 'test-secret';
    const app = createApp();

    const response = await request(app)
      .post('/api/internal/vercel/deploy-events')
      .set('Authorization', 'Bearer test-secret')
      .send({
        type: 'deployment.error',
        payload: {
          id: 'dpl_err',
          state: 'ERROR',
          error: { message: 'Build failed' },
        },
      });

    expect(response.status).toBe(202);
    expect(mocks.recordVercelDeployEvent).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Build failed',
    }));
  });

  it('resolves level=error for failed state', async () => {
    process.env.VERCEL_DEPLOY_WEBHOOK_SECRET = 'test-secret';
    const app = createApp();

    const response = await request(app)
      .post('/api/internal/vercel/deploy-events')
      .set('Authorization', 'Bearer test-secret')
      .send({
        type: 'deployment.error',
        payload: { id: 'dpl_fail', state: 'FAILURE' },
      });

    expect(response.status).toBe(202);
    expect(mocks.recordVercelDeployEvent).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error',
    }));
  });

  it('resolves level=error for canceled state', async () => {
    process.env.VERCEL_DEPLOY_WEBHOOK_SECRET = 'test-secret';
    const app = createApp();

    const response = await request(app)
      .post('/api/internal/vercel/deploy-events')
      .set('Authorization', 'Bearer test-secret')
      .send({
        type: 'deployment.canceled',
        payload: { id: 'dpl_cancel', state: 'CANCELED' },
      });

    expect(response.status).toBe(202);
    expect(mocks.recordVercelDeployEvent).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error',
    }));
  });

  it('resolves level=warning for queued state', async () => {
    process.env.VERCEL_DEPLOY_WEBHOOK_SECRET = 'test-secret';
    const app = createApp();

    const response = await request(app)
      .post('/api/internal/vercel/deploy-events')
      .set('Authorization', 'Bearer test-secret')
      .send({
        type: 'deployment.created',
        payload: { id: 'dpl_queue', state: 'QUEUED' },
      });

    expect(response.status).toBe(202);
    expect(mocks.recordVercelDeployEvent).toHaveBeenCalledWith(expect.objectContaining({
      level: 'warning',
    }));
  });

  it('resolves level=warning when state is null', async () => {
    process.env.VERCEL_DEPLOY_WEBHOOK_SECRET = 'test-secret';
    const app = createApp();

    const response = await request(app)
      .post('/api/internal/vercel/deploy-events')
      .set('Authorization', 'Bearer test-secret')
      .send({
        type: 'deployment.unknown',
        payload: { id: 'dpl_null' },
      });

    expect(response.status).toBe(202);
    expect(mocks.recordVercelDeployEvent).toHaveBeenCalledWith(expect.objectContaining({
      level: 'warning',
    }));
  });

  it('handles exception in handler and returns 500', async () => {
    process.env.VERCEL_DEPLOY_WEBHOOK_SECRET = 'test-secret';
    mocks.recordVercelDeployEvent.mockRejectedValueOnce(new Error('unexpected error'));
    const app = createApp();

    const response = await request(app)
      .post('/api/internal/vercel/deploy-events')
      .set('Authorization', 'Bearer test-secret')
      .send({
        type: 'deployment.error',
        payload: { id: 'dpl_throw', state: 'ERROR' },
      });

    expect(response.status).toBe(500);
    expect(response.body.error).toBe('vercel deploy event ingest failed');
  });

  it('deduplicates repeated events with same id+state', async () => {
    process.env.VERCEL_DEPLOY_WEBHOOK_SECRET = 'test-secret';
    const app = createApp();

    // First request
    const res1 = await request(app)
      .post('/api/internal/vercel/deploy-events')
      .set('Authorization', 'Bearer test-secret')
      .send({
        type: 'deployment.created',
        payload: { id: 'dpl_dedup', state: 'READY' },
      });
    expect(res1.status).toBe(202);
    expect(res1.body.message).toBe('vercel deployment event recorded');

    // Second request (same id+state) - should be deduped
    const res2 = await request(app)
      .post('/api/internal/vercel/deploy-events')
      .set('Authorization', 'Bearer test-secret')
      .send({
        type: 'deployment.created',
        payload: { id: 'dpl_dedup', state: 'READY' },
      });
    expect(res2.status).toBe(202);
    expect(res2.body.message).toBe('vercel deployment event already recorded');
    expect(mocks.recordVercelDeployEvent).toHaveBeenCalledTimes(1);
  });

  it('handles whitespace-only VERCEL_DEPLOY_WEBHOOK_SECRET as unconfigured', async () => {
    process.env.VERCEL_DEPLOY_WEBHOOK_SECRET = '   ';
    const app = createApp();

    const response = await request(app)
      .post('/api/internal/vercel/deploy-events')
      .send({});

    expect(response.status).toBe(503);
  });

  it('handles non-string authorization header', async () => {
    process.env.VERCEL_DEPLOY_WEBHOOK_SECRET = 'test-secret';
    const app = createApp();

    const response = await request(app)
      .post('/api/internal/vercel/deploy-events')
      .send({});

    expect(response.status).toBe(401);
  });

  it('asString returns null for non-string value', async () => {
    process.env.VERCEL_DEPLOY_WEBHOOK_SECRET = 'test-secret';
    const app = createApp();

    const response = await request(app)
      .post('/api/internal/vercel/deploy-events')
      .set('Authorization', 'Bearer test-secret')
      .send({
        type: 123, // non-string type
        payload: {
          id: 456, // non-string id
          state: true, // non-string state
        },
      });

    expect(response.status).toBe(202);
    expect(mocks.recordVercelDeployEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'deployment:unknown',
    }));
  });
});
