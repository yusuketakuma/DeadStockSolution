import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
  },
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 1, email: 'test@example.com', isAdmin: false };
    next();
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import notificationsRouter from '../routes/notifications';

function createSelectQuery(result: unknown) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockResolvedValue(result);
  return query;
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/notifications', notificationsRouter);
  return app;
}

describe('notifications routes /matches/:id/read', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.select.mockImplementation(() => createSelectQuery([{ id: 10, pharmacyId: 1 }]));
    mocks.db.update.mockImplementation(() => ({
      set: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(undefined),
      })),
    }));
    mocks.db.insert.mockImplementation(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
      })),
    }));
  });

  it('returns 400 for invalid id', async () => {
    const app = createApp();
    const response = await request(app).post('/api/notifications/matches/not-a-number/read');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: '不正なIDです' });
  });

  it('returns 404 when match notification does not exist', async () => {
    const app = createApp();
    mocks.db.select.mockImplementationOnce(() => createSelectQuery([]));

    const response = await request(app).post('/api/notifications/matches/99/read');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: '通知が見つかりません' });
  });

  it('returns 404 when notification belongs to another pharmacy', async () => {
    const app = createApp();
    mocks.db.select.mockImplementationOnce(() => createSelectQuery([{ id: 10, pharmacyId: 2 }]));

    const response = await request(app).post('/api/notifications/matches/10/read');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: '通知が見つかりません' });
  });

  it('marks match notification as read for owner pharmacy', async () => {
    const app = createApp();

    const response = await request(app).post('/api/notifications/matches/10/read');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: '既読にしました' });
    expect(mocks.db.update).toHaveBeenCalledTimes(1);
  });
});

describe('notifications routes /messages/:id/read', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.select.mockImplementation(() => createSelectQuery([{ id: 11, targetType: 'all', targetPharmacyId: null }]));
    mocks.db.insert.mockImplementation(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
      })),
    }));
  });

  it('returns 400 for invalid id', async () => {
    const app = createApp();
    const response = await request(app).post('/api/notifications/messages/invalid/read');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: '不正なIDです' });
  });

  it('returns 404 when message does not exist', async () => {
    const app = createApp();
    mocks.db.select.mockImplementationOnce(() => createSelectQuery([]));
    const response = await request(app).post('/api/notifications/messages/99/read');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'メッセージが見つかりません' });
  });

  it('returns 404 when message is not targeted to current pharmacy', async () => {
    const app = createApp();
    mocks.db.select.mockImplementationOnce(
      () => createSelectQuery([{ id: 12, targetType: 'pharmacy', targetPharmacyId: 2 }]),
    );
    const response = await request(app).post('/api/notifications/messages/12/read');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'メッセージが見つかりません' });
  });

  it('marks target message as read', async () => {
    const app = createApp();
    const response = await request(app).post('/api/notifications/messages/11/read');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: '既読にしました' });
    expect(mocks.db.insert).toHaveBeenCalledTimes(1);
  });
});

describe('notifications routes GET /', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deduplicates proposal event notifications against proposal-derived notices', async () => {
    const app = createApp();
    const proposalRows = [{
      id: 101,
      pharmacyAId: 2,
      pharmacyBId: 1,
      status: 'proposed',
      proposedAt: '2026-02-26T00:00:00.000Z',
    }];
    const notificationRows = [{
      id: 5001,
      pharmacyId: 1,
      type: 'proposal_received',
      title: '交換提案が届きました',
      message: '新しい交換提案',
      referenceType: 'proposal',
      referenceId: 101,
      isRead: false,
      readAt: null,
      createdAt: '2026-02-26T01:00:00.000Z',
    }];

    mocks.db.select
      .mockImplementationOnce(() => createSelectQuery(proposalRows))
      .mockImplementationOnce(() => createSelectQuery([]))
      .mockImplementationOnce(() => createSelectQuery([]))
      .mockImplementationOnce(() => createSelectQuery([]))
      .mockImplementationOnce(() => createSelectQuery([]))
      .mockImplementationOnce(() => createSelectQuery(notificationRows));

    const response = await request(app).get('/api/notifications');

    expect(response.status).toBe(200);
    expect(response.body.notices).toHaveLength(1);
    expect(response.body.notices[0]).toEqual(expect.objectContaining({
      id: 'notification-5001',
      type: 'inbound_request',
      unread: true,
      actionPath: '/proposals/101',
    }));
    expect(response.body.summary).toEqual(expect.objectContaining({
      unreadMessages: 0,
      actionableRequests: 1,
      total: 1,
    }));
  });

  it('supports cursor pagination for notices', async () => {
    const app = createApp();
    const cursor = Buffer.from(JSON.stringify({
      id: 'notification-12',
      priority: 3,
      createdAt: '2026-02-26T02:00:00.000Z',
    }), 'utf-8').toString('base64url');

    const notificationRows = [
      {
        id: 13,
        pharmacyId: 1,
        type: 'proposal_status_changed',
        title: 'ステータス更新3',
        message: 'message3',
        referenceType: 'proposal',
        referenceId: 3,
        isRead: false,
        readAt: null,
        createdAt: '2026-02-26T03:00:00.000Z',
      },
      {
        id: 12,
        pharmacyId: 1,
        type: 'proposal_status_changed',
        title: 'ステータス更新2',
        message: 'message2',
        referenceType: 'proposal',
        referenceId: 2,
        isRead: false,
        readAt: null,
        createdAt: '2026-02-26T02:00:00.000Z',
      },
      {
        id: 11,
        pharmacyId: 1,
        type: 'proposal_status_changed',
        title: 'ステータス更新1',
        message: 'message1',
        referenceType: 'proposal',
        referenceId: 1,
        isRead: false,
        readAt: null,
        createdAt: '2026-02-26T01:00:00.000Z',
      },
    ];

    mocks.db.select
      .mockImplementationOnce(() => createSelectQuery([]))
      .mockImplementationOnce(() => createSelectQuery([]))
      .mockImplementationOnce(() => createSelectQuery([]))
      .mockImplementationOnce(() => createSelectQuery([]))
      .mockImplementationOnce(() => createSelectQuery([]))
      .mockImplementationOnce(() => createSelectQuery(notificationRows));

    const response = await request(app)
      .get('/api/notifications')
      .query({ cursor, limit: 2 });

    expect(response.status).toBe(200);
    expect(response.body.notices).toHaveLength(1);
    expect(response.body.notices[0]).toEqual(expect.objectContaining({
      id: 'notification-11',
    }));
    expect(response.body.pagination).toEqual(expect.objectContaining({
      limit: 2,
      hasMore: false,
      nextCursor: null,
    }));
  });
});
