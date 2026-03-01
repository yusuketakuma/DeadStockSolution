import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getTimeline: vi.fn(),
  getTimelineUnreadCount: vi.fn(),
  markTimelineViewed: vi.fn(),
  getSmartDigest: vi.fn(),
  requireLoginEnabled: { value: true },
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (
    req: { user?: { id: number; email: string; isAdmin: boolean }; cookies?: Record<string, string> },
    res: { status: (code: number) => { json: (body: unknown) => void } },
    next: () => void,
  ) => {
    if (!mocks.requireLoginEnabled.value) {
      res.status(401).json({ error: 'ログインが必要です' });
      return;
    }
    req.user = { id: 1, email: 'pharmacy@example.com', isAdmin: false };
    next();
  },
}));

vi.mock('../services/timeline-service', () => ({
  getTimeline: mocks.getTimeline,
  getTimelineUnreadCount: mocks.getTimelineUnreadCount,
  markTimelineViewed: mocks.markTimelineViewed,
  getSmartDigest: mocks.getSmartDigest,
}));

vi.mock('../config/database', () => ({
  db: {},
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../services/system-event-service', () => ({
  recordHttpUnhandledError: vi.fn(),
}));

import timelineRouter from '../routes/timeline';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/timeline', timelineRouter);
  return app;
}

const sampleEvents = [
  {
    id: 'notification_1',
    source: 'notification',
    type: 'proposal_received',
    title: '仮マッチングが届いています',
    body: 'マッチング #1 を確認してください',
    timestamp: '2026-03-01T10:00:00.000Z',
    priority: 'high',
    isRead: false,
    actionPath: '/proposals/1',
  },
];

describe('timeline routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireLoginEnabled.value = true;
  });

  it('GET /api/timeline — 認証なしで 401 を返す', async () => {
    mocks.requireLoginEnabled.value = false;
    const app = createApp();

    const response = await request(app).get('/api/timeline');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'ログインが必要です' });
    expect(mocks.getTimeline).not.toHaveBeenCalled();
  });

  it('GET /api/timeline — 認証ありでイベント一覧を返す', async () => {
    const app = createApp();
    mocks.getTimeline.mockResolvedValue({
      events: sampleEvents,
      total: 1,
      hasMore: false,
    });

    const response = await request(app).get('/api/timeline');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      events: sampleEvents,
      total: 1,
      hasMore: false,
      page: 1,
      limit: 20,
    });
    expect(mocks.getTimeline).toHaveBeenCalledWith(
      {},
      1,
      { page: 1, limit: 20, priority: undefined, since: undefined },
    );
  });

  it('GET /api/timeline?priority=critical — critical フィルタが動作する', async () => {
    const app = createApp();
    const criticalEvents = [
      {
        ...sampleEvents[0],
        priority: 'critical',
      },
    ];
    mocks.getTimeline.mockResolvedValue({
      events: criticalEvents,
      total: 1,
      hasMore: false,
    });

    const response = await request(app).get('/api/timeline?priority=critical');

    expect(response.status).toBe(200);
    expect(response.body.events).toHaveLength(1);
    expect(response.body.events[0].priority).toBe('critical');
    expect(mocks.getTimeline).toHaveBeenCalledWith(
      {},
      1,
      expect.objectContaining({ priority: 'critical' }),
    );
  });

  it('GET /api/timeline — 無効な priority はフィルタしない（undefined で呼び出す）', async () => {
    const app = createApp();
    mocks.getTimeline.mockResolvedValue({
      events: sampleEvents,
      total: 1,
      hasMore: false,
    });

    const response = await request(app).get('/api/timeline?priority=invalid');

    expect(response.status).toBe(200);
    expect(mocks.getTimeline).toHaveBeenCalledWith(
      {},
      1,
      expect.objectContaining({ priority: undefined }),
    );
  });

  it('GET /api/timeline/unread-count — 未読数を返す', async () => {
    const app = createApp();
    mocks.getTimelineUnreadCount.mockResolvedValue(5);

    const response = await request(app).get('/api/timeline/unread-count');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ unreadCount: 5 });
    expect(mocks.getTimelineUnreadCount).toHaveBeenCalledWith({}, 1);
  });

  it('PATCH /api/timeline/mark-viewed — 閲覧済みマーク成功', async () => {
    const app = createApp();
    mocks.markTimelineViewed.mockResolvedValue(undefined);

    const response = await request(app).patch('/api/timeline/mark-viewed');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(mocks.markTimelineViewed).toHaveBeenCalledWith({}, 1);
  });

  it('GET /api/timeline/digest — ダイジェストを返す', async () => {
    const app = createApp();
    mocks.getSmartDigest.mockResolvedValue(sampleEvents);

    const response = await request(app).get('/api/timeline/digest');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ events: sampleEvents });
    expect(mocks.getSmartDigest).toHaveBeenCalledWith({}, 1);
  });

  it('GET /api/timeline — サービスエラー時に 500 を返す', async () => {
    const app = createApp();
    mocks.getTimeline.mockRejectedValue(new Error('DB接続エラー'));

    const response = await request(app).get('/api/timeline');

    expect(response.status).toBe(500);
    expect(response.body).toHaveProperty('error');
  });

  it('GET /api/timeline?since=2026-01-01T00:00:00.000Z — since パラメータが渡される', async () => {
    const app = createApp();
    mocks.getTimeline.mockResolvedValue({
      events: [],
      total: 0,
      hasMore: false,
    });

    const response = await request(app).get('/api/timeline?since=2026-01-01T00:00:00.000Z');

    expect(response.status).toBe(200);
    expect(mocks.getTimeline).toHaveBeenCalledWith(
      {},
      1,
      expect.objectContaining({ since: '2026-01-01T00:00:00.000Z' }),
    );
  });
});
