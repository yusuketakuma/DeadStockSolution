import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
  },
  getBusinessHoursStatus: vi.fn(),
  haversineDistance: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 1, email: 'pharmacy@example.com', isAdmin: false };
    next();
  },
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../utils/business-hours-utils', () => ({
  getBusinessHoursStatus: mocks.getBusinessHoursStatus,
}));

vi.mock('../utils/geo-utils', () => ({
  haversineDistance: mocks.haversineDistance,
}));

vi.mock('../services/logger', () => ({
  logger: {
    error: mocks.loggerError,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  or: vi.fn(() => ({})),
  like: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  asc: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));

import pharmaciesRouter from '../routes/pharmacies';
import { eq } from 'drizzle-orm';

function createWhereQuery(result: unknown) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockResolvedValue(result);
  return query;
}

function createInnerJoinWhereQuery(result: unknown) {
  const query = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);
  query.where.mockResolvedValue(result);
  return query;
}

function createLimitQuery(result: unknown) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.limit.mockResolvedValue(result);
  return query;
}

function createOffsetQuery(result: unknown) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.offset.mockResolvedValue(result);
  return query;
}

function createInsertQuery() {
  const query = {
    values: vi.fn(),
  };
  query.values.mockReturnValue({
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  });
  return query;
}

function createDeleteQuery() {
  const query = {
    where: vi.fn(),
  };
  query.where.mockResolvedValue(undefined);
  return query;
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/pharmacies', pharmaciesRouter);
  return app;
}

describe('pharmacies routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.select.mockReset();
    mocks.db.insert.mockReset();
    mocks.db.delete.mockReset();
    mocks.loggerError.mockReset();
    mocks.getBusinessHoursStatus.mockReturnValue({ isOpen: true, statusText: '営業中' });
    mocks.haversineDistance.mockReturnValue(12.34);
  });

  it('returns paginated pharmacies with business status', async () => {
    const app = createApp();
    mocks.db.select
      .mockImplementationOnce(() => createLimitQuery([{ latitude: 35.0, longitude: 139.0 }]))
      .mockImplementationOnce(() => createWhereQuery([{ count: 1 }]))
      .mockImplementationOnce(() => createOffsetQuery([
        {
          id: 2,
          name: '相手薬局',
          prefecture: '東京都',
          address: 'A',
          phone: '03',
          fax: '03',
          latitude: 35.0,
          longitude: 139.0,
          distance: null,
        },
      ]))
      .mockImplementationOnce(() => createWhereQuery([
        { pharmacyId: 2, dayOfWeek: 1, openTime: '09:00', closeTime: '18:00', isClosed: false, is24Hours: false },
      ]))
      .mockImplementationOnce(() => createWhereQuery([]));

    const response = await request(app).get('/api/pharmacies').query({ page: 1, limit: 20, search: '相手' });

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toEqual(expect.objectContaining({
      id: 2,
      distance: 12.3,
      businessStatus: expect.objectContaining({ isOpen: true, isConfigured: true }),
    }));
    expect(response.body.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
  });

  it('uses distance sort fallback when current pharmacy has no coordinates', async () => {
    const app = createApp();
    mocks.db.select
      .mockImplementationOnce(() => createLimitQuery([{ latitude: null, longitude: null }]))
      .mockImplementationOnce(() => createWhereQuery([{ count: 0 }]))
      .mockImplementationOnce(() => createOffsetQuery([]));

    const response = await request(app).get('/api/pharmacies').query({ sortBy: 'distance', page: 1, limit: 20 });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
    expect(response.body.pagination.total).toBe(0);
  });

  it('computes distance with haversine fallback when DB distance is null', async () => {
    const app = createApp();
    mocks.db.select
      .mockImplementationOnce(() => createLimitQuery([{ latitude: 35.0, longitude: 139.0 }]))
      .mockImplementationOnce(() => createWhereQuery([{ count: 1 }]))
      .mockImplementationOnce(() => createOffsetQuery([
        {
          id: 3,
          name: '距離薬局',
          prefecture: '神奈川県',
          address: 'B',
          phone: '04',
          fax: '04',
          latitude: 35.1,
          longitude: 139.1,
          distance: null,
        },
      ]))
      .mockImplementationOnce(() => createWhereQuery([]))
      .mockImplementationOnce(() => createWhereQuery([]));

    const response = await request(app).get('/api/pharmacies').query({ sortBy: 'distance', page: 1, limit: 20 });

    expect(response.status).toBe(200);
    expect(response.body.data[0]).toEqual(expect.objectContaining({
      id: 3,
      distance: 12.3,
    }));
    expect(mocks.haversineDistance).toHaveBeenCalledTimes(1);
  });

  it('returns relationships grouped by type', async () => {
    const app = createApp();
    mocks.db.select.mockImplementationOnce(() => createInnerJoinWhereQuery([
      { id: 1, targetPharmacyId: 2, relationshipType: 'favorite', targetPharmacyName: 'A' },
      { id: 2, targetPharmacyId: 3, relationshipType: 'blocked', targetPharmacyName: 'B' },
    ]));

    const response = await request(app).get('/api/pharmacies/relationships');

    expect(response.status).toBe(200);
    expect(response.body.favorites).toHaveLength(1);
    expect(response.body.blocked).toHaveLength(1);
  });

  it('returns detail validation and lookup responses', async () => {
    const app = createApp();

    const invalid = await request(app).get('/api/pharmacies/abc');
    expect(invalid.status).toBe(400);

    mocks.db.select.mockImplementationOnce(() => createLimitQuery([]));
    const missing = await request(app).get('/api/pharmacies/99');
    expect(missing.status).toBe(404);

    mocks.db.select.mockImplementationOnce(() => createLimitQuery([
      { id: 2, name: '詳細薬局', prefecture: '東京都', address: 'A', phone: '03', fax: '03' },
    ]));
    const success = await request(app).get('/api/pharmacies/2');
    expect(success.status).toBe(200);
    expect(success.body).toEqual(expect.objectContaining({ id: 2, name: '詳細薬局' }));

    const eqMock = vi.mocked(eq);
    expect(eqMock).toHaveBeenCalledWith(expect.anything(), true);
  });

  it('handles favorite add/remove flows', async () => {
    const app = createApp();
    const insertQuery = createInsertQuery();
    const deleteQuery = createDeleteQuery();

    const self = await request(app).post('/api/pharmacies/1/favorite');
    expect(self.status).toBe(400);

    mocks.db.select.mockImplementationOnce(() => createLimitQuery([]));
    const missing = await request(app).post('/api/pharmacies/4/favorite');
    expect(missing.status).toBe(404);

    mocks.db.select.mockImplementationOnce(() => createLimitQuery([{ id: 4 }]));
    mocks.db.insert.mockReturnValue(insertQuery);
    const added = await request(app).post('/api/pharmacies/4/favorite');
    expect(added.status).toBe(200);
    expect(added.body).toEqual({ message: 'お気に入りに設定しました' });
    expect(insertQuery.values).toHaveBeenCalledTimes(1);

    mocks.db.delete.mockReturnValue(deleteQuery);
    const removed = await request(app).delete('/api/pharmacies/4/favorite');
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ message: 'お気に入りを解除しました' });
  });

  it('handles block add/remove flows', async () => {
    const app = createApp();
    const insertQuery = createInsertQuery();
    const deleteQuery = createDeleteQuery();

    const self = await request(app).post('/api/pharmacies/1/block');
    expect(self.status).toBe(400);

    mocks.db.select.mockImplementationOnce(() => createLimitQuery([{ id: 5 }]));
    mocks.db.insert.mockReturnValue(insertQuery);
    const added = await request(app).post('/api/pharmacies/5/block');
    expect(added.status).toBe(200);
    expect(added.body).toEqual({ message: 'ブロックしました' });

    mocks.db.delete.mockReturnValue(deleteQuery);
    const removed = await request(app).delete('/api/pharmacies/5/block');
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ message: 'ブロックを解除しました' });
  });
});
