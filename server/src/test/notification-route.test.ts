import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDashboardUnreadCount: vi.fn(),
  markAsRead: vi.fn(),
  markAllDashboardAsRead: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 10, email: 'pharmacy@example.com', isAdmin: false };
    next();
  },
}));

vi.mock('../services/notification-service', () => ({
  getDashboardUnreadCount: mocks.getDashboardUnreadCount,
  markAsRead: mocks.markAsRead,
  markAllDashboardAsRead: mocks.markAllDashboardAsRead,
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function createApp() {
  const app = express();
  app.use(express.json());
  return app;
}

describe('notification routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /api/notifications/unread-count returns unread count', async () => {
    const app = createApp();
    const { default: notificationsRouter } = await import('../routes/notifications');
    app.use('/api/notifications', notificationsRouter);
    mocks.getDashboardUnreadCount.mockResolvedValue(3);

    const response = await request(app).get('/api/notifications/unread-count');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ unreadCount: 3 });
    expect(mocks.getDashboardUnreadCount).toHaveBeenCalledWith(10);
  });

  it('PATCH /api/notifications/:id/read returns 400 for invalid id', async () => {
    const app = createApp();
    const { default: notificationsRouter } = await import('../routes/notifications');
    app.use('/api/notifications', notificationsRouter);

    const response = await request(app).patch('/api/notifications/invalid/read');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: '不正なIDです' });
    expect(mocks.markAsRead).not.toHaveBeenCalled();
  });

  it('PATCH /api/notifications/:id/read returns 404 when target is missing', async () => {
    const app = createApp();
    const { default: notificationsRouter } = await import('../routes/notifications');
    app.use('/api/notifications', notificationsRouter);
    mocks.markAsRead.mockResolvedValue(false);

    const response = await request(app).patch('/api/notifications/999/read');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: '通知が見つかりません' });
    expect(mocks.markAsRead).toHaveBeenCalledWith(999, 10);
  });

  it('PATCH /api/notifications/:id/read marks one notification as read', async () => {
    const app = createApp();
    const { default: notificationsRouter } = await import('../routes/notifications');
    app.use('/api/notifications', notificationsRouter);
    mocks.markAsRead.mockResolvedValue(true);

    const response = await request(app).patch('/api/notifications/1/read');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: '既読にしました' });
    expect(mocks.markAsRead).toHaveBeenCalledWith(1, 10);
  });

  it('PATCH /api/notifications/read-all returns updated count', async () => {
    const app = createApp();
    const { default: notificationsRouter } = await import('../routes/notifications');
    app.use('/api/notifications', notificationsRouter);
    mocks.markAllDashboardAsRead.mockResolvedValue(5);

    const response = await request(app).patch('/api/notifications/read-all');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: '5件を既読にしました', count: 5 });
    expect(mocks.markAllDashboardAsRead).toHaveBeenCalledWith(10);
  });

});
