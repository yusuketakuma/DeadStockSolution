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
      nextCursor: null,
    });

    const response = await request(app).get('/api/timeline');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      events: sampleEvents,
      total: 1,
      hasMore: false,
      nextCursor: null,
      limit: 20,
      pagination: {
        mode: 'cursor',
        limit: 20,
        hasMore: false,
        nextCursor: null,
      },
    });
    expect(mocks.getTimeline).toHaveBeenCalledWith(
      {},
      1,
      { cursor: undefined, limit: 20, priority: undefined, since: undefined },
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
      nextCursor: null,
    });

    const response = await request(app).get('/api/timeline?priority=critical');

    expect(response.status).toBe(200);
    expect(response.body.events).toHaveLength(1);
    expect(response.body.events[0].priority).toBe('critical');
    expect(mocks.getTimeline).toHaveBeenCalledWith(
      {},
      1,
      expect.objectContaining({ priority: 'critical', cursor: undefined }),
    );
  });

  it('GET /api/timeline — 無効な priority はフィルタしない（undefined で呼び出す）', async () => {
    const app = createApp();
    mocks.getTimeline.mockResolvedValue({
      events: sampleEvents,
      total: 1,
      hasMore: false,
      nextCursor: null,
    });

    const response = await request(app).get('/api/timeline?priority=invalid');

    expect(response.status).toBe(200);
    expect(mocks.getTimeline).toHaveBeenCalledWith(
      {},
      1,
      expect.objectContaining({ priority: undefined, cursor: undefined }),
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

  it('GET /api/timeline/bootstrap — 初期データをまとめて返す', async () => {
    const app = createApp();
    mocks.getTimeline.mockResolvedValue({
      events: sampleEvents,
      total: 1,
      hasMore: false,
      nextCursor: null,
    });
    mocks.getSmartDigest.mockResolvedValue(sampleEvents);
    mocks.getTimelineUnreadCount.mockResolvedValue(7);

    const response = await request(app).get('/api/timeline/bootstrap').query({ limit: 10 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      timeline: {
        events: sampleEvents,
        total: 1,
        hasMore: false,
        nextCursor: null,
        limit: 10,
        pagination: {
          mode: 'cursor',
          limit: 10,
          hasMore: false,
          nextCursor: null,
        },
      },
      digest: { events: sampleEvents },
      unreadCount: 7,
    });
    expect(mocks.getTimeline).toHaveBeenCalledWith(
      {},
      1,
      { limit: 10, priority: undefined, since: undefined, cursor: undefined },
    );
    expect(mocks.getSmartDigest).toHaveBeenCalledWith({}, 1);
    expect(mocks.getTimelineUnreadCount).toHaveBeenCalledWith({}, 1);
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
      nextCursor: null,
    });

    const response = await request(app).get('/api/timeline?since=2026-01-01T00:00:00.000Z');

    expect(response.status).toBe(200);
    expect(mocks.getTimeline).toHaveBeenCalledWith(
      {},
      1,
      expect.objectContaining({ since: '2026-01-01T00:00:00.000Z', cursor: undefined }),
    );
  });

  it('GET /api/timeline?cursor=... — cursor パラメータが渡される', async () => {
    const app = createApp();
    const cursor = Buffer.from(JSON.stringify({
      timestamp: '2026-03-01T10:00:00.000Z',
      id: 'notification_1',
    }), 'utf-8').toString('base64url');

    mocks.getTimeline.mockResolvedValue({
      events: [],
      total: 10,
      hasMore: true,
      nextCursor: 'next-cursor',
    });

    const response = await request(app).get('/api/timeline').query({ cursor, limit: 10 });

    expect(response.status).toBe(200);
    expect(response.body.pagination).toEqual({
      mode: 'cursor',
      limit: 10,
      hasMore: true,
      nextCursor: 'next-cursor',
    });
    expect(mocks.getTimeline).toHaveBeenCalledWith(
      {},
      1,
      expect.objectContaining({
        limit: 10,
        cursor: {
          timestamp: '2026-03-01T10:00:00.000Z',
          id: 'notification_1',
        },
      }),
    );
  });

  it('GET /api/timeline?cursor=invalid — 不正な cursor は 400 を返す', async () => {
    const app = createApp();

    const response = await request(app).get('/api/timeline').query({ cursor: 'invalid' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'cursorが不正です' });
    expect(mocks.getTimeline).not.toHaveBeenCalled();
  });
});
