import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  sendExpiryReminders: vi.fn(),
  expireStaleProposals: vi.fn(),
}));

async function createApp() {
  vi.resetModules();
  vi.doMock('../services/exchange-execution-service', () => ({
    sendExpiryReminders: mocks.sendExpiryReminders,
    expireStaleProposals: mocks.expireStaleProposals,
  }));
  vi.doMock('../services/logger', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }));

  const { default: internalProposalExpiryRouter } = await import('../routes/internal-proposal-expiry');
  const app = express();
  app.use(express.json());
  app.use('/api/internal/proposals', internalProposalExpiryRouter);
  return app;
}

describe('internal proposal expiry route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PROPOSAL_EXPIRY_CRON_SECRET = 'proposal-secret';
  });

  afterEach(() => {
    delete process.env.PROPOSAL_EXPIRY_CRON_SECRET;
  });

  it('returns 401 when authorization header is missing', async () => {
    const app = await createApp();
    const res = await request(app).get('/api/internal/proposals/expire-stale');

    expect(res.status).toBe(401);
  });

  it('returns 503 when cron secret is not configured', async () => {
    delete process.env.PROPOSAL_EXPIRY_CRON_SECRET;
    const app = await createApp();
    const res = await request(app)
      .get('/api/internal/proposals/expire-stale')
      .set('Authorization', 'Bearer proposal-secret');

    expect(res.status).toBe(503);
  });

  it('accepts GET and merges reminder + expiry results', async () => {
    mocks.sendExpiryReminders.mockResolvedValue({ reminderCount: 2 });
    mocks.expireStaleProposals.mockResolvedValue({ expiredCount: 1 });
    const app = await createApp();

    const res = await request(app)
      .get('/api/internal/proposals/expire-stale')
      .set('Authorization', 'Bearer proposal-secret');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      message: 'ok',
      reminderCount: 2,
      expiredCount: 1,
    });
  });
});
