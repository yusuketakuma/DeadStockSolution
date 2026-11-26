import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  initRealtimeInfrastructure: vi.fn(),
  isRealtimeSharedDeliveryConfigured: vi.fn(),
  subscribeRealtimeClient: vi.fn(),
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
}));

vi.mock('../services/realtime-service', () => ({
  initRealtimeInfrastructure: mocks.initRealtimeInfrastructure,
  isRealtimeSharedDeliveryConfigured: mocks.isRealtimeSharedDeliveryConfigured,
  isRealtimeTopic: (value: unknown) => value === 'timeline' || value === 'messages',
  subscribeRealtimeClient: mocks.subscribeRealtimeClient,
}));

import realtimeRouter from '../routes/realtime';

function createApp() {
  const app = express();
  app.use('/api/realtime', realtimeRouter);
  return app;
}

describe('GET /api/realtime/stream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.initRealtimeInfrastructure.mockResolvedValue(undefined);
    mocks.subscribeRealtimeClient.mockImplementation(({ res }: { res: express.Response }) => {
      res.status(200).end();
      return () => undefined;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns 503 on Workers without a shared delivery channel so clients fall back to polling', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' });
    mocks.isRealtimeSharedDeliveryConfigured.mockReturnValue(false);

    const res = await request(createApp()).get('/api/realtime/stream?topics=messages');

    expect(res.status).toBe(503);
    expect(mocks.subscribeRealtimeClient).not.toHaveBeenCalled();
  });

  it('subscribes on Workers when a shared delivery channel is configured', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Cloudflare-Workers' });
    mocks.isRealtimeSharedDeliveryConfigured.mockReturnValue(true);

    const res = await request(createApp()).get('/api/realtime/stream?topics=messages');

    expect(res.status).toBe(200);
    expect(mocks.subscribeRealtimeClient).toHaveBeenCalledWith(expect.objectContaining({
      pharmacyId: 1,
      topics: ['messages'],
    }));
  });

  it('keeps in-process delivery on Node.js without a shared channel', async () => {
    mocks.isRealtimeSharedDeliveryConfigured.mockReturnValue(false);

    const res = await request(createApp()).get('/api/realtime/stream?topics=timeline');

    expect(res.status).toBe(200);
    expect(mocks.subscribeRealtimeClient).toHaveBeenCalledTimes(1);
  });

  it('rejects unknown topics', async () => {
    const res = await request(createApp()).get('/api/realtime/stream?topics=unknown');

    expect(res.status).toBe(400);
  });
});
