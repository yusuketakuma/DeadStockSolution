import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
  },
  handoffToOpenClaw: vi.fn(),
  isOpenClawConnectorConfigured: vi.fn(),
  isOpenClawWebhookConfigured: vi.fn(),
  getOpenClawImplementationBranch: vi.fn(),
  buildOpenClawLogContext: vi.fn(),
  invalidateAuthUserCache: vi.fn(),
  geocodeAddress: vi.fn(),
  writeLog: vi.fn(),
  getClientIp: vi.fn(),
  fetchBusinessHourSettings: vi.fn(),
  validateBusinessHours: vi.fn(),
  validateSpecialBusinessHours: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 1, email: 'admin@example.com', isAdmin: true };
    next();
  },
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => {
    next();
  },
  invalidateAuthUserCache: mocks.invalidateAuthUserCache,
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/openclaw-service', () => ({
  handoffToOpenClaw: mocks.handoffToOpenClaw,
  isOpenClawConnectorConfigured: mocks.isOpenClawConnectorConfigured,
  isOpenClawWebhookConfigured: mocks.isOpenClawWebhookConfigured,
  getOpenClawImplementationBranch: mocks.getOpenClawImplementationBranch,
}));

vi.mock('../services/openclaw-log-context-service', () => ({
  buildOpenClawLogContext: mocks.buildOpenClawLogContext,
}));

vi.mock('../services/log-service', () => ({
  writeLog: mocks.writeLog,
  getClientIp: mocks.getClientIp,
}));

vi.mock('../services/geocode-service', () => ({
  geocodeAddress: mocks.geocodeAddress,
}));

vi.mock('../routes/business-hours', () => ({
  fetchBusinessHourSettings: mocks.fetchBusinessHourSettings,
  validateBusinessHours: mocks.validateBusinessHours,
  validateSpecialBusinessHours: mocks.validateSpecialBusinessHours,
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
  },
}));

vi.mock('../utils/validators', () => ({
  emailSchema: {
    safeParse: vi.fn((val: string) => {
      if (val.includes('@')) return { success: true, data: val };
      return { success: false, error: { issues: [{ message: 'メールアドレスが不正です' }] } };
    }),
  },
}));

vi.mock('../utils/path-utils', () => ({
  sanitizeInternalPath: vi.fn((path: string) => path),
  isSafeInternalPath: vi.fn(() => true),
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  or: vi.fn(() => ({})),
  desc: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  sql: vi.fn(() => ({})),
}));

vi.mock('express-rate-limit', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import adminRouter from '../routes/admin';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);
  return app;
}

function createPaginatedQuery(rows: unknown[]) {
  const query = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
    innerJoin: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.offset.mockResolvedValue(rows);
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

function createOrderByQuery(rows: unknown[]) {
  const query = {
    from: vi.fn(),
    orderBy: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.orderBy.mockResolvedValue(rows);
  return query;
}

function createFromQuery(result: unknown) {
  const query = {
    from: vi.fn(),
  };
  query.from.mockResolvedValue(result);
  return query;
}

function createJoinOrderByQuery(rows: unknown[]) {
  const query = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockResolvedValue(rows);
  return query;
}

function createUpdateQuery() {
  const query = {
    set: vi.fn(),
    where: vi.fn(),
    returning: vi.fn(),
  };
  query.set.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.returning.mockResolvedValue([{ id: 1, version: 2 }]);
  return query;
}

function createInsertQuery() {
  const query = {
    values: vi.fn(),
  };
  query.values.mockResolvedValue(undefined);
  return query;
}

describe('admin pharmacies list routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isOpenClawConnectorConfigured.mockReturnValue(true);
    mocks.isOpenClawWebhookConfigured.mockReturnValue(true);
    mocks.getOpenClawImplementationBranch.mockReturnValue('feature/openclaw');
    mocks.getClientIp.mockReturnValue('127.0.0.1');
  });

  it('GET /pharmacies/options returns pharmacy list', async () => {
    const app = createApp();
    const pharmacyRows = [
      { id: 1, name: '薬局A', isActive: true, isTestAccount: false },
      { id: 2, name: '薬局B', isActive: true, isTestAccount: true },
    ];

    mocks.db.select.mockImplementationOnce(() => createOrderByQuery(pharmacyRows));

    const response = await request(app)
      .get('/api/admin/pharmacies/options');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(2);
    expect(response.body.data[0]).toEqual(expect.objectContaining({ id: 1, name: '薬局A' }));
  });

  it('GET /pharmacies returns paginated pharmacies', async () => {
    const app = createApp();
    const pharmacyRows = [
      { id: 1, email: 'a@test.com', name: '薬局A', prefecture: '東京都', phone: '03-0000-0000', fax: null, isActive: true, isAdmin: false, isTestAccount: false, createdAt: '2026-01-01' },
    ];

    mocks.db.select
      .mockImplementationOnce(() => createPaginatedQuery(pharmacyRows))
      .mockImplementationOnce(() => createFromQuery([{ count: 1 }]));

    const response = await request(app)
      .get('/api/admin/pharmacies');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.pagination).toEqual(expect.objectContaining({
      page: 1,
      total: 1,
    }));
  });

  it('GET /history returns paginated exchange history with pharmacy names', async () => {
    const app = createApp();
    const historyRows = [
      { id: 1, proposalId: 10, pharmacyAId: 2, pharmacyBId: 3, totalValue: '5000', completedAt: '2026-02-01' },
    ];

    mocks.db.select
      .mockImplementationOnce(() => createPaginatedQuery(historyRows))
      .mockImplementationOnce(() => createWhereQuery([
        { id: 2, name: '薬局A' },
        { id: 3, name: '薬局B' },
      ]))
      .mockImplementationOnce(() => createFromQuery([{ count: 1 }]));

    const response = await request(app)
      .get('/api/admin/history');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toEqual(expect.objectContaining({
      pharmacyAName: '薬局A',
      pharmacyBName: '薬局B',
    }));
  });

  it('GET /messages returns paginated messages', async () => {
    const app = createApp();
    const messageRows = [
      { id: 1, senderAdminId: 1, targetType: 'all', targetPharmacyId: null, title: 'お知らせ', body: '内容', actionPath: '/test', createdAt: '2026-02-01' },
    ];

    mocks.db.select
      .mockImplementationOnce(() => createPaginatedQuery(messageRows))
      .mockImplementationOnce(() => createFromQuery([{ count: 1 }]));

    const response = await request(app)
      .get('/api/admin/messages');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toEqual(expect.objectContaining({
      title: 'お知らせ',
    }));
  });

  it('GET /requests returns paginated user requests with openclaw config', async () => {
    const app = createApp();
    const requestRows = [
      { id: 1, pharmacyId: 2, pharmacyName: '薬局A', requestText: '改善要望', openclawStatus: 'pending', openclawThreadId: null, openclawSummary: null, createdAt: '2026-02-01', updatedAt: '2026-02-01' },
    ];

    mocks.db.select
      .mockImplementationOnce(() => createPaginatedQuery(requestRows))
      .mockImplementationOnce(() => createFromQuery([{ count: 1 }]));

    const response = await request(app)
      .get('/api/admin/requests');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.connector).toEqual({
      configured: true,
      webhookConfigured: true,
      implementationBranch: 'feature/openclaw',
    });
  });
});

describe('admin pharmacies detail routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClientIp.mockReturnValue('127.0.0.1');
  });

  it('GET /pharmacies/:id returns pharmacy detail without passwordHash', async () => {
    const app = createApp();
    const pharmacyRow = {
      id: 5,
      email: 'test@test.com',
      name: '薬局テスト',
      passwordHash: 'hashed_secret',
      isActive: true,
    };

    mocks.db.select.mockImplementationOnce(() => createLimitQuery([pharmacyRow]));

    const response = await request(app)
      .get('/api/admin/pharmacies/5');

    expect(response.status).toBe(200);
    expect(response.body.name).toBe('薬局テスト');
    expect(response.body.passwordHash).toBeUndefined();
  });

  it('GET /pharmacies/:id returns 404 when not found', async () => {
    const app = createApp();
    mocks.db.select.mockImplementationOnce(() => createLimitQuery([]));

    const response = await request(app)
      .get('/api/admin/pharmacies/999');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: '薬局が見つかりません' });
  });

  it('GET /pharmacies/:id returns 400 for invalid id', async () => {
    const app = createApp();

    const response = await request(app)
      .get('/api/admin/pharmacies/abc');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: '不正なIDです' });
  });

  it('GET /pharmacies/:id/business-hours/settings returns settings', async () => {
    const app = createApp();
    const settingsData = { hours: [], specialHours: [], version: 1 };
    mocks.fetchBusinessHourSettings.mockResolvedValue(settingsData);

    const response = await request(app)
      .get('/api/admin/pharmacies/5/business-hours/settings');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(settingsData);
  });

  it('GET /pharmacies/:id/business-hours/settings returns 404 when pharmacy not found', async () => {
    const app = createApp();
    mocks.fetchBusinessHourSettings.mockRejectedValue(new Error('薬局が見つかりません'));

    const response = await request(app)
      .get('/api/admin/pharmacies/999/business-hours/settings');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: '薬局が見つかりません' });
  });

  it('PUT /pharmacies/:id returns 400 for invalid version', async () => {
    const app = createApp();

    const response = await request(app)
      .put('/api/admin/pharmacies/5')
      .send({ version: 'abc', name: 'new name' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'バージョン情報が不正です' });
  });

  it('PUT /pharmacies/:id returns 404 when pharmacy not found', async () => {
    const app = createApp();
    mocks.db.select.mockImplementationOnce(() => createLimitQuery([]));

    const response = await request(app)
      .put('/api/admin/pharmacies/999')
      .send({ version: 1, name: '新しい名前' });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: '薬局が見つかりません' });
  });

  it('PUT /pharmacies/:id returns 400 for invalid pharmacy name', async () => {
    const app = createApp();
    const existingRow = { id: 5, address: '東京都千代田区', prefecture: '東京都', isTestAccount: false, testAccountPassword: null };
    mocks.db.select.mockImplementationOnce(() => createLimitQuery([existingRow]));

    const response = await request(app)
      .put('/api/admin/pharmacies/5')
      .send({ version: 1, name: '' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: '薬局名は1〜100文字で入力してください' });
  });

  it('PUT /pharmacies/:id skips re-verification when target field value is unchanged', async () => {
    const app = createApp();
    const existingRow = {
      id: 5,
      email: 'same@test.com',
      name: '同じ薬局名',
      postalCode: '1000001',
      address: '東京都千代田区',
      phone: '03-0000-0000',
      fax: '03-0000-0001',
      licenseNumber: 'LIC-001',
      prefecture: '東京都',
      isTestAccount: false,
      testAccountPassword: null,
    };
    mocks.db.select.mockImplementationOnce(() => createLimitQuery([existingRow]));
    const updateQuery = createUpdateQuery();
    mocks.db.update.mockReturnValue(updateQuery);

    const response = await request(app)
      .put('/api/admin/pharmacies/5')
      .send({ version: 1, name: '同じ薬局名' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: '薬局情報を更新しました', version: 2 });
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });

  it('PUT /pharmacies/:id returns 503 when re-verification enqueue fails', async () => {
    const app = createApp();
    const existingRow = {
      id: 5,
      email: 'same@test.com',
      name: '旧薬局名',
      postalCode: '1000001',
      address: '東京都千代田区',
      phone: '03-0000-0000',
      fax: '03-0000-0001',
      licenseNumber: 'LIC-001',
      prefecture: '東京都',
      isTestAccount: false,
      testAccountPassword: null,
    };
    mocks.db.select.mockImplementationOnce(() => createLimitQuery([existingRow]));
    const updateQuery = createUpdateQuery();
    mocks.db.update.mockReturnValue(updateQuery);
    const insertReturningMock = vi.fn().mockRejectedValue(new Error('insert failed'));
    const insertValuesMock = vi.fn(() => ({ returning: insertReturningMock }));
    mocks.db.insert.mockReturnValue({ values: insertValuesMock });

    const response = await request(app)
      .put('/api/admin/pharmacies/5')
      .send({ version: 1, name: '新しい薬局名' });

    expect(response.status).toBe(503);
    expect(response.body.partialSuccess).toBe(true);
    expect(response.body.version).toBe(2);
    expect(response.body.verificationStatus).toBe('pending_verification');
  });

  it('PUT /pharmacies/:id/business-hours updates hours and returns new version', async () => {
    const app = createApp();
    mocks.validateBusinessHours.mockReturnValue({
      valid: [{
        dayOfWeek: 1,
        openTime: '09:00',
        closeTime: '18:00',
        isClosed: false,
        is24Hours: false,
      }],
    });
    mocks.validateSpecialBusinessHours.mockReturnValue({ provided: false, valid: [] });
    mocks.db.select.mockImplementationOnce(() => createLimitQuery([{ id: 5 }]));
    mocks.db.transaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ version: 2 }]),
            }),
          }),
        }),
        delete: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockResolvedValue(undefined),
        }),
      };
      return callback(tx);
    });

    const response = await request(app)
      .put('/api/admin/pharmacies/5/business-hours')
      .send({
        version: 1,
        hours: [{ dayOfWeek: 1, openTime: '09:00', closeTime: '18:00', isClosed: false, is24Hours: false }],
        specialHours: [],
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: '営業時間を更新しました', version: 2 });
  });

  it('PUT /pharmacies/:id/business-hours returns 409 when concurrent update detected', async () => {
    const app = createApp();
    mocks.validateBusinessHours.mockReturnValue({
      valid: [{
        dayOfWeek: 1,
        openTime: '09:00',
        closeTime: '18:00',
        isClosed: false,
        is24Hours: false,
      }],
    });
    mocks.validateSpecialBusinessHours.mockReturnValue({ provided: false, valid: [] });
    mocks.db.select.mockImplementationOnce(() => createLimitQuery([{ id: 5 }]));
    mocks.db.transaction.mockImplementationOnce(async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([]),
            }),
          }),
        }),
        delete: vi.fn(),
        insert: vi.fn(),
      };
      return callback(tx);
    });
    mocks.fetchBusinessHourSettings.mockResolvedValue({
      version: 3,
      hours: [],
      specialHours: [],
    });

    const response = await request(app)
      .put('/api/admin/pharmacies/5/business-hours')
      .send({ version: 1, hours: [], specialHours: [] });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      error: '他のデバイスまたはタブで更新されています。最新データを確認してください',
      latestData: {
        version: 3,
        hours: [],
        specialHours: [],
      },
    });
  });

  it('PUT /pharmacies/:id/toggle-active toggles active state', async () => {
    const app = createApp();
    mocks.db.select.mockImplementationOnce(() => createLimitQuery([{ isActive: true }]));
    const updateQuery = createUpdateQuery();
    mocks.db.update.mockReturnValue(updateQuery);

    const response = await request(app)
      .put('/api/admin/pharmacies/5/toggle-active');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: '薬局を無効にしました' });
    expect(mocks.db.update).toHaveBeenCalledTimes(1);
  });

  it('PUT /pharmacies/:id/toggle-active returns 404 when not found', async () => {
    const app = createApp();
    mocks.db.select.mockImplementationOnce(() => createLimitQuery([]));

    const response = await request(app)
      .put('/api/admin/pharmacies/999/toggle-active');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: '薬局が見つかりません' });
  });
});

describe('admin pharmacies actions routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isOpenClawConnectorConfigured.mockReturnValue(true);
    mocks.isOpenClawWebhookConfigured.mockReturnValue(true);
    mocks.getOpenClawImplementationBranch.mockReturnValue('feature/openclaw');
    mocks.getClientIp.mockReturnValue('127.0.0.1');
  });

  it('GET /exchanges returns paginated exchanges', async () => {
    const app = createApp();
    const exchangeRows = [
      { id: 1, pharmacyAId: 2, pharmacyBId: 3, status: 'proposed', proposedAt: '2026-02-01' },
    ];

    mocks.db.select
      .mockImplementationOnce(() => createPaginatedQuery(exchangeRows))
      .mockImplementationOnce(() => createFromQuery([{ count: 1 }]));

    const response = await request(app)
      .get('/api/admin/exchanges');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.pagination).toEqual(expect.objectContaining({
      total: 1,
    }));
  });

  it('GET /exchanges/:proposalId/comments returns comments for a proposal', async () => {
    const app = createApp();
    const proposalRows = [{ id: 10 }];
    const commentRows = [
      { id: 1, proposalId: 10, authorPharmacyId: 2, authorName: '薬局A', body: 'コメント', isDeleted: false, createdAt: '2026-02-01', updatedAt: '2026-02-01' },
    ];

    mocks.db.select
      .mockImplementationOnce(() => createLimitQuery(proposalRows))
      .mockImplementationOnce(() => createJoinOrderByQuery(commentRows));

    const response = await request(app)
      .get('/api/admin/exchanges/10/comments');

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toEqual(expect.objectContaining({
      id: 1,
      body: 'コメント',
    }));
  });

  it('GET /exchanges/:proposalId/comments masks deleted comment body', async () => {
    const app = createApp();
    mocks.db.select
      .mockImplementationOnce(() => createLimitQuery([{ id: 10 }]))
      .mockImplementationOnce(() => createJoinOrderByQuery([
        { id: 1, proposalId: 10, authorPharmacyId: 2, authorName: '薬局A', body: 'secret', isDeleted: true, createdAt: '2026-02-01', updatedAt: '2026-02-01' },
      ]));

    const response = await request(app)
      .get('/api/admin/exchanges/10/comments');

    expect(response.status).toBe(200);
    expect(response.body.data[0].body).toBe('（削除済み）');
  });

  it('GET /exchanges/:proposalId/comments returns 404 when proposal not found', async () => {
    const app = createApp();
    mocks.db.select.mockImplementationOnce(() => createLimitQuery([]));

    const response = await request(app)
      .get('/api/admin/exchanges/999/comments');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: 'マッチングが見つかりません' });
  });

  it('POST /messages returns 201 on valid broadcast message', async () => {
    const app = createApp();
    mocks.db.insert.mockImplementationOnce(() => createInsertQuery());

    const response = await request(app)
      .post('/api/admin/messages')
      .send({
        targetType: 'all',
        title: 'お知らせ',
        body: 'テスト本文',
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ message: '加盟薬局へメッセージを送信しました' });
  });

  it('POST /messages returns 400 for missing target type', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/admin/messages')
      .send({ title: 'タイトル', body: '本文' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: '送信対象が不正です' });
  });

  it('POST /messages returns 400 for missing title', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/admin/messages')
      .send({ targetType: 'all', body: '本文' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'タイトルは1〜100文字で入力してください' });
  });

  it('POST /messages returns 400 for missing body', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/admin/messages')
      .send({ targetType: 'all', title: 'タイトル' });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: '本文は1〜2000文字で入力してください' });
  });

  it('POST /messages returns 404 when target pharmacy not found', async () => {
    const app = createApp();
    mocks.db.select.mockImplementationOnce(() => createLimitQuery([]));

    const response = await request(app)
      .post('/api/admin/messages')
      .send({
        targetType: 'pharmacy',
        targetPharmacyId: 999,
        title: 'お知らせ',
        body: 'テスト本文',
      });

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: '送信先薬局が見つかりません' });
  });

  it('POST /messages returns 400 for pharmacy target without id', async () => {
    const app = createApp();

    const response = await request(app)
      .post('/api/admin/messages')
      .send({
        targetType: 'pharmacy',
        title: 'お知らせ',
        body: 'テスト本文',
      });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: '送信先薬局IDが不正です' });
  });

  it('POST /requests/:id/handoff re-handoffs request and updates state when accepted', async () => {
    const app = createApp();
    const requestRow = {
      id: 12,
      pharmacyId: 5,
      requestText: '再連携テスト',
      openclawStatus: 'pending_handoff',
    };

    mocks.db.select.mockImplementationOnce(() => createLimitQuery([requestRow]));
    mocks.buildOpenClawLogContext.mockResolvedValue([{ type: 'log' }]);
    mocks.handoffToOpenClaw.mockResolvedValue({
      accepted: true,
      connectorConfigured: true,
      implementationBranch: 'feature/openclaw',
      status: 'in_dialogue',
      note: null,
      threadId: 'thread-1',
      summary: 'accepted',
    });
    mocks.db.update.mockImplementationOnce(() => createUpdateQuery());

    const response = await request(app)
      .post('/api/admin/requests/12/handoff');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      message: 'OpenClawへ再連携しました',
      handoff: {
        accepted: true,
        connectorConfigured: true,
        implementationBranch: 'feature/openclaw',
        status: 'in_dialogue',
        note: null,
      },
    });
    expect(mocks.handoffToOpenClaw).toHaveBeenCalledTimes(1);
    expect(mocks.db.update).toHaveBeenCalledTimes(1);
  });
});
