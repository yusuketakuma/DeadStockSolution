import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAdminDdsConnectionStatus: vi.fn(),
  issueDdsBootstrapToken: vi.fn(),
  rotateDdsControlToken: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 7, email: 'admin@example.com', isAdmin: true };
    next();
  },
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../routes/admin-write-limiter', () => ({
  adminWriteLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../services/openclaw/admin-runtime-status-service', () => ({
  getAdminDdsConnectionStatus: mocks.getAdminDdsConnectionStatus,
}));

vi.mock('../services/dds-agent-service', () => ({
  issueDdsBootstrapToken: mocks.issueDdsBootstrapToken,
  rotateDdsControlToken: mocks.rotateDdsControlToken,
}));

vi.mock('../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

let adminRouter: (typeof import('../routes/admin'))['default'];

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  return app;
}

describe('admin openclaw connect routes', () => {
  beforeEach(async () => {
    vi.useRealTimers();
    vi.resetAllMocks();
    vi.resetModules();
    ({ default: adminRouter } = await import('../routes/admin'));
  });

  it('GET /openclaw/dds-agent returns connection status', async () => {
    mocks.getAdminDdsConnectionStatus.mockResolvedValue({
      environment: 'production',
      connected: true,
      agentId: 'agent-1',
      agentName: 'DDS Agent',
      lastSeenAt: '2026-03-24T10:00:00.000Z',
      queuedJobs: 2,
      awaitingUser: 1,
      latestPrUrl: 'https://github.com/org/repo/pull/42',
      runtimeDigest: {
        generatedAt: '2026-03-24T10:10:00.000Z',
        latestConnection: null,
        bufferedErrors: { count: 0, bySeverity: {}, bySource: {}, recent: [] },
        codexResults: { todayCount: 0, todayByStatus: {}, recent: [] },
      },
    });

    const res = await request(createApp()).get('/api/admin/openclaw/dds-agent');

    expect(res.status).toBe(200);
    expect(res.body.data.connected).toBe(true);
    expect(res.body.data.runtimeDigest.bufferedErrors.count).toBe(0);
    expect(mocks.getAdminDdsConnectionStatus).toHaveBeenCalledTimes(1);
  });

  it('POST /openclaw/bootstrap-token issues bootstrap token for current admin', async () => {
    mocks.issueDdsBootstrapToken.mockResolvedValue({
      token: 'bootstrap-123',
      expiresAt: '2026-03-24T11:00:00.000Z',
      environment: 'production',
      registerUrl: 'https://example.com/api/openclaw/connect/register',
      callbackUrl: 'https://example.com/api/openclaw/callback',
      commandsUrl: 'https://example.com/api/openclaw/commands',
      healthUrl: 'https://example.com/api/health/openclaw',
    });

    const res = await request(createApp())
      .post('/api/admin/openclaw/bootstrap-token')
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.data.token).toBe('bootstrap-123');
    expect(mocks.issueDdsBootstrapToken).toHaveBeenCalledWith(7);
  });

  it('POST /openclaw/control-token/rotate rotates the current control token', async () => {
    mocks.rotateDdsControlToken.mockResolvedValue(undefined);

    const res = await request(createApp())
      .post('/api/admin/openclaw/control-token/rotate')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('ローテーション');
    expect(mocks.rotateDdsControlToken).toHaveBeenCalledTimes(1);
  });
});
