import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listUserRequests: vi.fn(),
  listRequestEventTimeline: vi.fn(),
  parseListPagination: vi.fn(() => ({ page: 1, limit: 50, offset: 0 })),
  sendPaginated: vi.fn((_res: express.Response, data: unknown[], page: number, limit: number, total: number) => {
    (_res as express.Response).json({ data, page, limit, total });
  }),
  handleAdminError: vi.fn((_err: unknown, _logCtx: string, msg: string, res: express.Response) => {
    res.status(500).json({ error: msg });
  }),
}));

function mockAdminUserRequestsTimelineDependencies() {
  vi.doMock('../services/admin-user-request-service', () => ({
    listUserRequests: mocks.listUserRequests,
  }));

  vi.doMock('../services/openclaw/request-event-service', () => ({
    listRequestEventTimeline: mocks.listRequestEventTimeline,
  }));

  vi.doMock('../routes/admin-utils', () => ({
    parseListPagination: mocks.parseListPagination,
    sendPaginated: mocks.sendPaginated,
    handleAdminError: mocks.handleAdminError,
  }));

  vi.doMock('../services/logger', () => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }));

  vi.doMock('../utils/request-utils', () => ({
    parsePositiveInt: vi.fn((val: unknown) => {
      const n = Number(val);
      return Number.isFinite(n) && n > 0 ? n : null;
    }),
  }));
}

async function createApp() {
  vi.resetModules();
  mockAdminUserRequestsTimelineDependencies();
  const { default: userRequestsRouter } = await import('../routes/admin-user-requests');
  const app = express();
  app.use(express.json());
  app.use('/admin', userRequestsRouter);
  return app;
}

describe('GET /admin/user-requests/:id/events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with events array for a valid request ID', async () => {
    const events = [
      {
        id: 1,
        requestId: 42,
        pharmacyId: 10,
        eventType: 'created',
        fromStatus: null,
        toStatus: 'pending_handoff',
        threadId: null,
        summary: null,
        note: '受付しました',
        metadataJson: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 2,
        requestId: 42,
        pharmacyId: 10,
        eventType: 'handoff_accepted',
        fromStatus: 'pending_handoff',
        toStatus: 'in_dialogue',
        threadId: 'thread-abc',
        summary: null,
        note: null,
        metadataJson: null,
        createdAt: '2026-01-01T01:00:00.000Z',
      },
    ];
    mocks.listRequestEventTimeline.mockResolvedValue(events);

    const app = await createApp();
    const res = await request(app).get('/admin/user-requests/42/events');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ events });
    expect(mocks.listRequestEventTimeline).toHaveBeenCalledWith(42);
  });

  it('returns 200 with empty events array for a request with no events', async () => {
    mocks.listRequestEventTimeline.mockResolvedValue([]);

    const app = await createApp();
    const res = await request(app).get('/admin/user-requests/99/events');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ events: [] });
    expect(mocks.listRequestEventTimeline).toHaveBeenCalledWith(99);
  });

  it('returns empty events array for an invalid (non-positive) ID without calling service', async () => {
    const app = await createApp();
    const res = await request(app).get('/admin/user-requests/0/events');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ events: [] });
    expect(mocks.listRequestEventTimeline).not.toHaveBeenCalled();
  });

  it('returns empty events array for a non-numeric ID without calling service', async () => {
    const app = await createApp();
    const res = await request(app).get('/admin/user-requests/abc/events');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ events: [] });
    expect(mocks.listRequestEventTimeline).not.toHaveBeenCalled();
  });

  it('returns 500 when service throws', async () => {
    mocks.listRequestEventTimeline.mockRejectedValue(new Error('DB error'));

    const app = await createApp();
    const res = await request(app).get('/admin/user-requests/42/events');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('タイムラインの取得に失敗しました');
  });
});
