import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
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

  it('returns 403 when notification belongs to another pharmacy', async () => {
    const app = createApp();
    mocks.db.select.mockImplementationOnce(() => createSelectQuery([{ id: 10, pharmacyId: 2 }]));

    const response = await request(app).post('/api/notifications/matches/10/read');
    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'アクセス権限がありません' });
  });

  it('marks match notification as read for owner pharmacy', async () => {
    const app = createApp();

    const response = await request(app).post('/api/notifications/matches/10/read');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: '既読にしました' });
    expect(mocks.db.update).toHaveBeenCalledTimes(1);
  });
});

