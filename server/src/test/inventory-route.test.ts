import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    delete: vi.fn(),
    insert: vi.fn(),
    transaction: vi.fn(),
  },
  getPharmacyRiskDetail: vi.fn(),
  invalidateAdminRiskSnapshotCache: vi.fn(),
  triggerMatchingRefreshOnUpload: vi.fn(),
  getBusinessHoursStatus: vi.fn(),
  writeLog: vi.fn(),
  getClientIp: vi.fn(),
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

vi.mock('../services/expiry-risk-service', () => ({
  getPharmacyRiskDetail: mocks.getPharmacyRiskDetail,
  invalidateAdminRiskSnapshotCache: mocks.invalidateAdminRiskSnapshotCache,
}));

vi.mock('../services/matching-refresh-service', () => ({
  triggerMatchingRefreshOnUpload: mocks.triggerMatchingRefreshOnUpload,
}));

vi.mock('../utils/business-hours-utils', () => ({
  getBusinessHoursStatus: mocks.getBusinessHoursStatus,
}));

vi.mock('../services/log-service', () => ({
  writeLog: mocks.writeLog,
  getClientIp: mocks.getClientIp,
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
  eq: vi.fn(() => ({})),
  and: vi.fn(() => ({})),
  or: vi.fn(() => ({})),
  like: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  notExists: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));

import inventoryRouter from '../routes/inventory';

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

function createWhereQuery(result: unknown) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockResolvedValue(result);
  return query;
}

function createInnerJoinOffsetQuery(result: unknown) {
  const query = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.offset.mockResolvedValue(result);
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

function createDeleteReturningQuery(result: unknown) {
  const query = {
    where: vi.fn(),
    returning: vi.fn(),
  };
  query.where.mockReturnValue(query);
  query.returning.mockResolvedValue(result);
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

function createValuesQuery(result?: unknown) {
  const query = {
    values: vi.fn(),
  };
  query.values.mockResolvedValue(result);
  return query;
}

function createValuesReturningQuery(result: unknown) {
  const query = {
    values: vi.fn(),
    returning: vi.fn(),
  };
  query.values.mockReturnValue(query);
  query.returning.mockResolvedValue(result);
  return query;
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/inventory', inventoryRouter);
  return app;
}

describe('inventory routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClientIp.mockReturnValue('127.0.0.1');
    mocks.getBusinessHoursStatus.mockReturnValue({ isOpen: true, statusText: '営業中' });
  });

  it('returns risk summary', async () => {
    const app = createApp();
    mocks.getPharmacyRiskDetail.mockResolvedValue({
      pharmacyId: 1,
      totalItems: 3,
      riskScore: 42,
      bucketCounts: { expired: 1, within30: 1, within60: 0, within90: 0, within120: 1, over120: 0, unknown: 0 },
      topRiskItems: [],
      computedAt: '2026-03-01T00:00:00.000Z',
    });

    const response = await request(app).get('/api/inventory/dead-stock/risk');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      pharmacyId: 1,
      riskScore: 42,
    }));
  });

  it('returns 404 when risk summary target is missing', async () => {
    const app = createApp();
    mocks.getPharmacyRiskDetail.mockRejectedValue(new Error('薬局が見つかりません'));

    const response = await request(app).get('/api/inventory/dead-stock/risk');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: '薬局が見つかりません' });
  });

  it('returns paginated dead stock list', async () => {
    const app = createApp();
    mocks.db.select
      .mockImplementationOnce(() => createOffsetQuery([
        { id: 1, pharmacyId: 1, drugName: '薬A', quantity: 10 },
      ]))
      .mockImplementationOnce(() => createWhereQuery([{ count: 1 }]));

    const response = await request(app).get('/api/inventory/dead-stock').query({ page: 1, limit: 50 });

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.pagination).toEqual({
      page: 1,
      limit: 50,
      total: 1,
      totalPages: 1,
    });
  });

  it('handles dead stock delete validation, not-found, and success', async () => {
    const app = createApp();

    const invalid = await request(app).delete('/api/inventory/dead-stock/abc');
    expect(invalid.status).toBe(400);

    mocks.db.delete.mockReturnValueOnce(createDeleteReturningQuery([]));
    const notFound = await request(app).delete('/api/inventory/dead-stock/10');
    expect(notFound.status).toBe(404);

    mocks.db.delete.mockReturnValueOnce(createDeleteReturningQuery([{ id: 10 }]));
    const success = await request(app).delete('/api/inventory/dead-stock/10');
    expect(success.status).toBe(200);
    expect(success.body).toEqual({ message: '削除しました' });
    expect(mocks.writeLog).toHaveBeenCalledWith('dead_stock_delete', expect.objectContaining({
      pharmacyId: 1,
      ipAddress: '127.0.0.1',
    }));
  });

  it('returns paginated used medication list', async () => {
    const app = createApp();
    mocks.db.select
      .mockImplementationOnce(() => createOffsetQuery([
        { id: 2, pharmacyId: 1, drugName: '薬B', monthlyUsage: 20 },
      ]))
      .mockImplementationOnce(() => createWhereQuery([{ count: 1 }]));

    const response = await request(app).get('/api/inventory/used-medication').query({ page: 1, limit: 50 });

    expect(response.status).toBe(200);
    expect(response.body.data[0]).toEqual(expect.objectContaining({ id: 2 }));
    expect(response.body.pagination.total).toBe(1);
  });

  it('resolves yj code from camera endpoint', async () => {
    const app = createApp();
    mocks.db.select
      .mockImplementationOnce(() => createLimitQuery([
        {
          id: 10,
          yjCode: '2171014F1020',
          drugName: '薬A',
          unit: '錠',
          yakkaPrice: '12.3',
        },
      ]))
      .mockImplementationOnce(() => createLimitQuery([
        {
          id: 50,
          gs1Code: '04912345678904',
          janCode: '4912345678904',
          packageDescription: '100錠',
          normalizedPackageLabel: '100錠',
        },
      ]));

    const response = await request(app)
      .post('/api/inventory/dead-stock/camera/resolve')
      .send({ rawCode: '2171014F1020' });

    expect(response.status).toBe(200);
    expect(response.body.codeType).toBe('yj');
    expect(response.body.match).toEqual(expect.objectContaining({
      drugMasterId: 10,
      drugMasterPackageId: 50,
      drugName: '薬A',
    }));
  });

  it('resolves gs1 code from camera endpoint', async () => {
    const app = createApp();
    mocks.db.select
      .mockImplementationOnce(() => createLimitQuery([
        {
          id: 50,
          drugMasterId: 10,
          gs1Code: '04912345678904',
          janCode: '4912345678904',
          packageDescription: '100錠',
          normalizedPackageLabel: '100錠',
        },
      ]))
      .mockImplementationOnce(() => createLimitQuery([
        {
          id: 10,
          yjCode: '2171014F1020',
          drugName: '薬A',
          unit: '錠',
          yakkaPrice: '12.3',
        },
      ]));

    const response = await request(app)
      .post('/api/inventory/dead-stock/camera/resolve')
      .send({ rawCode: '01049123456789041726063010LOT999' });

    expect(response.status).toBe(200);
    expect(response.body.codeType).toBe('gs1');
    expect(response.body.parsed).toEqual(expect.objectContaining({
      gtin: '04912345678904',
      expirationDate: '2026-06-30',
      lotNumber: 'LOT999',
    }));
    expect(response.body.match).toEqual(expect.objectContaining({
      drugMasterId: 10,
      drugMasterPackageId: 50,
      drugName: '薬A',
    }));
  });

  it('returns manual candidates for unmatched rows', async () => {
    const app = createApp();
    mocks.db.select
      .mockImplementationOnce(() => createLimitQuery([
        {
          id: 10,
          yjCode: '2171014F1020',
          drugName: '薬A',
          unit: '錠',
          yakkaPrice: '12.3',
        },
      ]))
      .mockImplementationOnce(() => createWhereQuery([
        {
          id: 50,
          drugMasterId: 10,
          gs1Code: '04912345678904',
          janCode: '4912345678904',
          packageDescription: '100錠',
          normalizedPackageLabel: '100錠',
        },
      ]));

    const response = await request(app)
      .get('/api/inventory/dead-stock/camera/manual-candidates')
      .query({ q: '薬A' });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      expect.objectContaining({
        drugMasterId: 10,
        drugMasterPackageId: 50,
        drugName: '薬A',
        packageLabel: '100錠',
      }),
    ]);
  });

  it('returns 400 when manual candidate keyword is too short', async () => {
    const app = createApp();
    const response = await request(app)
      .get('/api/inventory/dead-stock/camera/manual-candidates')
      .query({ q: '薬' });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('2文字以上');
    expect(mocks.db.select).not.toHaveBeenCalled();
  });

  it('returns 400 when manual candidate keyword is too long', async () => {
    const app = createApp();
    const response = await request(app)
      .get('/api/inventory/dead-stock/camera/manual-candidates')
      .query({ q: 'A'.repeat(81) });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('80文字以内');
    expect(mocks.db.select).not.toHaveBeenCalled();
  });

  it('returns null yakkaUnitPrice when master yakka price is missing', async () => {
    const app = createApp();
    mocks.db.select
      .mockImplementationOnce(() => createLimitQuery([
        {
          id: 10,
          yjCode: '2171014F1020',
          drugName: '薬A',
          unit: '錠',
          yakkaPrice: null,
        },
      ]))
      .mockImplementationOnce(() => createWhereQuery([
        {
          id: 50,
          drugMasterId: 10,
          gs1Code: '04912345678904',
          janCode: '4912345678904',
          packageDescription: '100錠',
          normalizedPackageLabel: '100錠',
        },
      ]));

    const response = await request(app)
      .get('/api/inventory/dead-stock/camera/manual-candidates')
      .query({ q: '薬A' });

    expect(response.status).toBe(200);
    expect(response.body.data[0]).toEqual(expect.objectContaining({
      drugMasterId: 10,
      yakkaUnitPrice: null,
    }));
  });

  it('returns 400 when camera confirm batch has invalid quantity', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/inventory/dead-stock/camera/confirm-batch')
      .send({
        items: [
          {
            rawCode: '2171014F1020',
            drugMasterId: 10,
            quantity: 0,
          },
        ],
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('数量は0より大きい値');
  });

  it('returns 400 when camera confirm batch has invalid expiration date format', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/inventory/dead-stock/camera/confirm-batch')
      .send({
        items: [
          {
            rawCode: '2171014F1020',
            drugMasterId: 10,
            quantity: 1,
            expirationDate: '2026-13-40',
          },
        ],
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('使用期限はYYYY-MM-DD形式');
  });

  it('returns 400 when camera confirm batch quantity is too large', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/inventory/dead-stock/camera/confirm-batch')
      .send({
        items: [
          {
            rawCode: '2171014F1020',
            drugMasterId: 10,
            quantity: 100001,
          },
        ],
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('数量は100000以下');
  });

  it('uses master values on camera confirm batch even when payload is tampered', async () => {
    const app = createApp();

    mocks.db.select
      .mockImplementationOnce(() => createWhereQuery([
        {
          id: 10,
          yjCode: '2171014F1020',
          drugName: '正規薬名',
          unit: '錠',
          yakkaPrice: '120',
        },
      ]))
      .mockImplementationOnce(() => createWhereQuery([
        {
          id: 50,
          drugMasterId: 10,
          packageDescription: '100錠',
          normalizedPackageLabel: '100錠',
        },
      ]));

    const uploadInsertQuery = createValuesReturningQuery([{ id: 999 }]);
    const deadStockInsertQuery = createValuesQuery();
    const tx = {
      insert: vi.fn()
        .mockReturnValueOnce(uploadInsertQuery)
        .mockReturnValueOnce(deadStockInsertQuery),
    };
    mocks.db.transaction.mockImplementation(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx));

    const response = await request(app)
      .post('/api/inventory/dead-stock/camera/confirm-batch')
      .send({
        items: [
          {
            rawCode: '01049123456789041726063010LOT999',
            drugMasterId: 10,
            drugMasterPackageId: 50,
            drugName: '改ざん薬名',
            drugCode: 'tampered-code',
            packageLabel: '改ざん包装',
            expirationDate: '2026-06-30',
            lotNumber: 'LOT999',
            quantity: 2,
            unit: '箱',
            yakkaUnitPrice: 1,
          },
        ],
      });

    expect(response.status).toBe(201);
    expect(deadStockInsertQuery.values).toHaveBeenCalledWith([
      expect.objectContaining({
        drugName: '正規薬名',
        unit: '錠',
        yakkaUnitPrice: '120',
        yakkaTotal: '240',
      }),
    ]);
    expect(deadStockInsertQuery.values).not.toHaveBeenCalledWith([
      expect.objectContaining({
        drugName: '改ざん薬名',
      }),
    ]);
    expect(mocks.triggerMatchingRefreshOnUpload).toHaveBeenCalledTimes(1);
  });

  it('returns browse inventory with business status and pagination', async () => {
    const app = createApp();
    mocks.db.select
      .mockImplementationOnce(() => createWhereQuery([]))
      .mockImplementationOnce(() => createInnerJoinOffsetQuery([
        {
          id: 100,
          pharmacyId: 2,
          drugName: '薬C',
          quantity: 5,
          unit: '錠',
          packageLabel: 'PTP',
          yakkaUnitPrice: '10',
          yakkaTotal: '50',
          expirationDate: '2026-06-01',
          pharmacyName: '相手薬局',
          prefecture: '東京都',
        },
      ]))
      .mockImplementationOnce(() => createWhereQuery([
        { pharmacyId: 2, dayOfWeek: 1, openTime: '09:00', closeTime: '18:00', isClosed: false, is24Hours: false },
      ]))
      .mockImplementationOnce(() => createWhereQuery([]))
      .mockImplementationOnce(() => createInnerJoinWhereQuery([{ count: 1 }]));

    const response = await request(app).get('/api/inventory/browse').query({ page: 1, limit: 50, search: '薬C' });

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toEqual(expect.objectContaining({
      id: 100,
      businessStatus: expect.objectContaining({ isOpen: true, isConfigured: true }),
    }));
    expect(response.body.pagination).toEqual({
      page: 1,
      limit: 50,
      total: 1,
      totalPages: 1,
    });
    expect(mocks.getBusinessHoursStatus).toHaveBeenCalledTimes(1);
  });
});
