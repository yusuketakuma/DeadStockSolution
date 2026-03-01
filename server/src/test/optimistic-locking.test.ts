import cookieParser from 'cookie-parser';
import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── モック定義 ──────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
  },
  writeLog: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
  geocodeAddress: vi.fn(() => ({ lat: 35.6762, lng: 139.6503 })),
  hashPassword: vi.fn(() => Promise.resolve('hashed_password')),
  verifyPassword: vi.fn(() => Promise.resolve(true)),
  deriveSessionVersion: vi.fn(() => 'session-v1'),
  generateToken: vi.fn(() => 'mock-token'),
  invalidateAuthUserCache: vi.fn(),
}));

vi.mock('../config/database', () => ({
  db: mocks.db,
}));

vi.mock('../services/log-service', () => ({
  writeLog: mocks.writeLog,
  getClientIp: mocks.getClientIp,
}));

vi.mock('../services/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../services/geocode-service', () => ({
  geocodeAddress: mocks.geocodeAddress,
}));

vi.mock('../services/auth-service', () => ({
  hashPassword: mocks.hashPassword,
  verifyPassword: mocks.verifyPassword,
  deriveSessionVersion: mocks.deriveSessionVersion,
  generateToken: mocks.generateToken,
  verifyToken: vi.fn(),
}));

vi.mock('../middleware/auth', () => ({
  requireLogin: (req: { user?: { id: number; email: string; isAdmin: boolean } }, _res: unknown, next: () => void) => {
    req.user = { id: 1, email: 'test@example.com', isAdmin: false };
    next();
  },
  invalidateAuthUserCache: mocks.invalidateAuthUserCache,
}));

vi.mock('../middleware/csrf', () => ({
  clearCsrfCookie: vi.fn(),
  csrfProtection: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../services/openclaw-service', () => ({
  handoffToOpenClaw: vi.fn(() => Promise.resolve({
    accepted: true,
    connectorConfigured: true,
    implementationBranch: 'review',
    status: 'in_dialogue',
    threadId: 'thread-1',
    summary: null,
    note: 'ok',
  })),
}));

// ── ヘルパー関数 ──────────────────────────────────────────

function createSelectChain(rows: unknown[]) {
  const limitMock = vi.fn().mockResolvedValue(rows);
  // orderBy を thenable にする（終端で await 可能かつ .limit() チェーンも可能）
  const orderByMock = vi.fn(() => Object.assign(Promise.resolve(rows), { limit: limitMock }));
  const whereMock = vi.fn(() => Object.assign(Promise.resolve(rows), { limit: limitMock, orderBy: orderByMock }));
  const fromMock = vi.fn(() => Object.assign(Promise.resolve(rows), { where: whereMock, orderBy: orderByMock }));
  return { from: fromMock, where: whereMock, limit: limitMock, orderBy: orderByMock };
}

function createUpdateChain(result: unknown[]) {
  const returningMock = vi.fn().mockResolvedValue(result);
  const whereMock = vi.fn(() => ({ returning: returningMock }));
  const setMock = vi.fn(() => ({ where: whereMock }));
  return { set: setMock, where: whereMock, returning: returningMock };
}

async function createAccountApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  const { default: accountRouter } = await import('../routes/account');
  app.use('/api/account', accountRouter);
  return app;
}

async function createBusinessHoursApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  const { default: businessHoursRouter } = await import('../routes/business-hours');
  app.use('/api/business-hours', businessHoursRouter);
  return app;
}

// ── テスト ──────────────────────────────────────────

describe('Optimistic Locking - Account Update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return version in GET /account response', async () => {
    const app = await createAccountApp();
    const accountData = {
      id: 1,
      email: 'test@example.com',
      name: 'テスト薬局',
      postalCode: '1000001',
      address: '千代田区1-1',
      phone: '03-1234-5678',
      fax: '03-1234-5679',
      licenseNumber: 'ABC123',
      prefecture: '東京都',
      isAdmin: false,
      version: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
    };

    mocks.db.select.mockReturnValue(createSelectChain([accountData]));

    const res = await request(app).get('/api/account');

    expect(res.status).toBe(200);
    expect(res.body.version).toBe(3);
    expect(res.body.name).toBe('テスト薬局');
  });

  it('should update successfully when version matches', async () => {
    const app = await createAccountApp();
    const updatedData = {
      id: 1,
      email: 'test@example.com',
      isAdmin: false,
      isActive: true,
      version: 2,
      passwordHash: 'hashed',
    };

    const updateChain = createUpdateChain([updatedData]);
    mocks.db.update.mockReturnValue(updateChain);
    mocks.db.select.mockReturnValue(createSelectChain([{
      id: 1,
      email: 'test@example.com',
      name: '旧薬局名',
      postalCode: '1000001',
      address: '千代田区1-1',
      phone: '03-1234-5678',
      fax: '03-1234-5679',
      licenseNumber: 'ABC123',
      prefecture: '東京都',
      isTestAccount: false,
      testAccountPassword: null,
    }]));

    // Mock for re-verification trigger (db.insert for userRequests)
    const insertReturningMock = vi.fn().mockResolvedValue([{ id: 99 }]);
    const insertValuesMock = vi.fn(() => ({ returning: insertReturningMock }));
    mocks.db.insert.mockReturnValue({ values: insertValuesMock });

    const res = await request(app)
      .put('/api/account')
      .send({
        name: '更新薬局',
        version: 1,
      });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('アカウント情報を更新しました');
    expect(res.body.version).toBe(2);
    expect(mocks.invalidateAuthUserCache).toHaveBeenCalledWith(1);
  });

  it('should return 409 Conflict when version does not match', async () => {
    const app = await createAccountApp();

    // update が 0 行を返す = 楽観的ロック競合
    const updateChain = createUpdateChain([]);
    mocks.db.update.mockReturnValue(updateChain);

    // 409 返却時に最新データを取得する select 呼び出し
    const latestData = {
      id: 1,
      email: 'test@example.com',
      name: '他デバイスで更新された名前',
      postalCode: '1000001',
      address: '千代田区1-1',
      phone: '03-1234-5678',
      fax: '03-1234-5679',
      licenseNumber: 'ABC123',
      prefecture: '東京都',
      isAdmin: false,
      version: 5,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    mocks.db.select.mockReturnValue(createSelectChain([latestData]));

    const res = await request(app)
      .put('/api/account')
      .send({
        name: '自分の変更',
        version: 3,
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('他のデバイスまたはタブで更新されています');
    expect(res.body.latestData).toBeDefined();
    expect(res.body.latestData.name).toBe('他デバイスで更新された名前');
    expect(res.body.latestData.version).toBe(5);
  });

  it('should return 400 when version is missing', async () => {
    const app = await createAccountApp();

    const res = await request(app)
      .put('/api/account')
      .send({
        name: '更新薬局',
        // version 省略
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('バージョン情報が不正です');
  });

  it('should return 400 when version is not a positive integer', async () => {
    const app = await createAccountApp();

    const res = await request(app)
      .put('/api/account')
      .send({
        name: '更新薬局',
        version: -1,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('バージョン情報が不正です');
  });

  it('should return 400 when version is a string', async () => {
    const app = await createAccountApp();

    const res = await request(app)
      .put('/api/account')
      .send({
        name: '更新薬局',
        version: 'abc',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('バージョン情報が不正です');
  });

  it('should increment version on successful update', async () => {
    const app = await createAccountApp();
    const updatedData = {
      id: 1,
      email: 'test@example.com',
      isAdmin: false,
      isActive: true,
      version: 6,
      passwordHash: 'hashed',
    };

    const updateChain = createUpdateChain([updatedData]);
    mocks.db.update.mockReturnValue(updateChain);
    mocks.db.select.mockReturnValue(createSelectChain([{
      id: 1,
      email: 'test@example.com',
      name: '旧薬局名',
      postalCode: '1000001',
      address: '千代田区1-1',
      phone: '03-1234-5678',
      fax: '03-1234-5679',
      licenseNumber: 'ABC123',
      prefecture: '東京都',
      isTestAccount: false,
      testAccountPassword: null,
    }]));

    // Mock for re-verification trigger
    const insertReturningMock = vi.fn().mockResolvedValue([{ id: 99 }]);
    const insertValuesMock = vi.fn(() => ({ returning: insertReturningMock }));
    mocks.db.insert.mockReturnValue({ values: insertValuesMock });

    const res = await request(app)
      .put('/api/account')
      .send({
        name: '更新薬局',
        version: 5,
      });

    expect(res.status).toBe(200);
    expect(res.body.version).toBe(6);
    // set の最初の呼び出しが version インクリメントを含むことを確認
    expect(updateChain.set).toHaveBeenCalled();
    const setCalls = updateChain.set.mock.calls as unknown[][];
    const setArg = setCalls[0]?.[0];
    expect(setArg).toHaveProperty('version');
    expect(setArg).toHaveProperty('updatedAt');
  });

  it('should not trigger re-verification when target field value is unchanged', async () => {
    const app = await createAccountApp();
    const updateChain = createUpdateChain([{
      id: 1,
      email: 'test@example.com',
      isAdmin: false,
      isActive: true,
      version: 4,
      passwordHash: 'hashed',
    }]);
    mocks.db.update.mockReturnValue(updateChain);
    mocks.db.select.mockReturnValue(createSelectChain([{
      id: 1,
      email: 'test@example.com',
      name: '同じ薬局名',
      postalCode: '1000001',
      address: '千代田区1-1',
      phone: '03-1234-5678',
      fax: '03-1234-5679',
      licenseNumber: 'ABC123',
      prefecture: '東京都',
      isTestAccount: false,
      testAccountPassword: null,
    }]));

    const res = await request(app)
      .put('/api/account')
      .send({
        name: '同じ薬局名',
        version: 3,
      });

    expect(res.status).toBe(200);
    expect(res.body.verificationStatus).toBeUndefined();
    expect(mocks.db.insert).not.toHaveBeenCalled();
  });

  it('should return 503 when re-verification enqueue fails after account update', async () => {
    const app = await createAccountApp();
    const updateChain = createUpdateChain([{
      id: 1,
      email: 'test@example.com',
      isAdmin: false,
      isActive: true,
      version: 3,
      passwordHash: 'hashed',
    }]);
    mocks.db.update.mockReturnValue(updateChain);
    mocks.db.select.mockReturnValue(createSelectChain([{
      id: 1,
      email: 'test@example.com',
      name: '旧薬局名',
      postalCode: '1000001',
      address: '千代田区1-1',
      phone: '03-1234-5678',
      fax: '03-1234-5679',
      licenseNumber: 'ABC123',
      prefecture: '東京都',
      isTestAccount: false,
      testAccountPassword: null,
    }]));
    const insertReturningMock = vi.fn().mockRejectedValue(new Error('insert failed'));
    const insertValuesMock = vi.fn(() => ({ returning: insertReturningMock }));
    mocks.db.insert.mockReturnValue({ values: insertValuesMock });

    const res = await request(app)
      .put('/api/account')
      .send({
        name: '更新薬局',
        version: 2,
      });

    expect(res.status).toBe(503);
    expect(res.body.partialSuccess).toBe(true);
    expect(res.body.version).toBe(3);
    expect(res.body.verificationStatus).toBe('pending_verification');
  });
});

describe('Optimistic Locking - Business Hours Update', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validHours = Array.from({ length: 7 }, (_, i) => ({
    dayOfWeek: i,
    openTime: i === 0 ? null : '09:00',
    closeTime: i === 0 ? null : '18:00',
    isClosed: i === 0,
    is24Hours: false,
  }));

  it('should return version in GET /business-hours/settings response', async () => {
    const app = await createBusinessHoursApp();

    let callIndex = 0;
    mocks.db.select.mockImplementation(() => {
      callIndex++;
      // 1回目: 通常の営業時間
      if (callIndex === 1) {
        return createSelectChain(validHours);
      }
      // 2回目: 特例営業時間
      if (callIndex === 2) {
        return createSelectChain([]);
      }
      // 3回目: pharmacies.version
      return createSelectChain([{ version: 7 }]);
    });

    const res = await request(app).get('/api/business-hours/settings');

    expect(res.status).toBe(200);
    expect(res.body.version).toBe(7);
    expect(Array.isArray(res.body.hours)).toBe(true);
    expect(Array.isArray(res.body.specialHours)).toBe(true);
  });

  it('should return 400 when version is missing in PUT', async () => {
    const app = await createBusinessHoursApp();

    const res = await request(app)
      .put('/api/business-hours')
      .send({ hours: validHours });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('バージョン情報が不正です');
  });

  it('should update successfully when version matches', async () => {
    const app = await createBusinessHoursApp();

    mocks.db.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const txUpdateChain = {
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([{ version: 4 }]),
          })),
        })),
      };
      const txDeleteChain = {
        where: vi.fn().mockResolvedValue(undefined),
      };
      const txInsertChain = {
        values: vi.fn().mockResolvedValue(undefined),
      };

      const tx = {
        update: vi.fn(() => txUpdateChain),
        delete: vi.fn(() => txDeleteChain),
        insert: vi.fn(() => txInsertChain),
      };

      return fn(tx);
    });

    const res = await request(app)
      .put('/api/business-hours')
      .send({
        hours: validHours,
        version: 3,
      });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('営業時間を更新しました');
    expect(res.body.version).toBe(4);
  });

  it('should return 409 Conflict when version does not match in PUT', async () => {
    const app = await createBusinessHoursApp();

    // トランザクション内で version チェック失敗（0行返却）
    mocks.db.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const txUpdateChain = {
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([]), // 0行 = 競合
          })),
        })),
      };

      const tx = {
        update: vi.fn(() => txUpdateChain),
        delete: vi.fn(),
        insert: vi.fn(),
      };

      return fn(tx);
    });

    // 409 返却時の最新データ取得用
    let selectCallIndex = 0;
    mocks.db.select.mockImplementation(() => {
      selectCallIndex++;
      if (selectCallIndex === 1) {
        // 最新の通常営業時間
        return createSelectChain(validHours);
      }
      if (selectCallIndex === 2) {
        // 最新の特例営業時間
        return createSelectChain([]);
      }
      // 最新のpharmacy version
      return createSelectChain([{ version: 10 }]);
    });

    const res = await request(app)
      .put('/api/business-hours')
      .send({
        hours: validHours,
        version: 2,
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('他のデバイスまたはタブで更新されています');
    expect(res.body.latestData).toBeDefined();
    expect(res.body.latestData.version).toBe(10);
    expect(Array.isArray(res.body.latestData.hours)).toBe(true);
  });

  it('should handle concurrent update scenario (A succeeds, B gets 409)', async () => {
    const app = await createBusinessHoursApp();
    let transactionCallCount = 0;

    mocks.db.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      transactionCallCount++;

      if (transactionCallCount === 1) {
        // 更新A: 成功
        const txUpdateChain = {
          set: vi.fn(() => ({
            where: vi.fn(() => ({
              returning: vi.fn().mockResolvedValue([{ version: 4 }]),
            })),
          })),
        };
        const txDeleteChain = { where: vi.fn().mockResolvedValue(undefined) };
        const txInsertChain = { values: vi.fn().mockResolvedValue(undefined) };
        const tx = {
          update: vi.fn(() => txUpdateChain),
          delete: vi.fn(() => txDeleteChain),
          insert: vi.fn(() => txInsertChain),
        };
        return fn(tx);
      }

      // 更新B: 競合
      const txUpdateChain = {
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn().mockResolvedValue([]),
          })),
        })),
      };
      const tx = {
        update: vi.fn(() => txUpdateChain),
        delete: vi.fn(),
        insert: vi.fn(),
      };
      return fn(tx);
    });

    // 409 時の最新データ取得
    mocks.db.select.mockImplementation(() => {
      return createSelectChain([{ version: 4 }]);
    });

    // 更新A: 成功（version=3 を送信）
    const resA = await request(app)
      .put('/api/business-hours')
      .send({ hours: validHours, version: 3 });

    expect(resA.status).toBe(200);
    expect(resA.body.version).toBe(4);

    // 更新B: 古い version=3 を送信 → 競合
    const resB = await request(app)
      .put('/api/business-hours')
      .send({ hours: validHours, version: 3 });

    expect(resB.status).toBe(409);
    expect(resB.body.latestData).toBeDefined();
  });
});
