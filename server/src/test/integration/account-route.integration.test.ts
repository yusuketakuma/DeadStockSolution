import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getTestDb, resetTestDb, closeTestDb, type TestDb } from './helpers/test-db';
import { makePharmacy, resetFactorySeq } from './helpers/factories';
import { makeAuthCookie, makeCsrfPair } from './helpers/auth-helper';
import request from 'supertest';
import bcrypt from 'bcryptjs';

// ── モック設定 ──────────────────────────────────────────

let testDb: TestDb;
let app: (typeof import('../../app'))['default'];

vi.mock('../../config/database', () => ({
  get db() { return testDb; },
}));

vi.mock('../../services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../services/observability-service', () => ({
  recordRequestMetric: vi.fn(),
}));

vi.mock('../../services/geocode-service', () => ({
  geocodeAddress: vi.fn().mockResolvedValue({ lat: 35.6762, lng: 139.6503 }),
}));

vi.mock('../../services/log-service', () => ({
  writeLog: vi.fn().mockResolvedValue(undefined),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}));

vi.mock('../../services/pharmacy-verification-service', () => ({
  detectChangedReverificationFields: vi.fn().mockReturnValue([]),
  triggerReverification: vi.fn().mockResolvedValue(undefined),
  ReverificationTriggerError: class extends Error { constructor(msg: string) { super(msg); this.name = 'ReverificationTriggerError'; } },
  sendReverificationTriggerErrorResponse: vi.fn(),
}));

// ── セットアップ ──────────────────────────────────────────

const KNOWN_PASSWORD = 'testpassword123';
let knownPasswordHash: string;

beforeAll(async () => {
  testDb = await getTestDb();
  ({ default: app } = await import('../../app'));
  knownPasswordHash = await bcrypt.hash(KNOWN_PASSWORD, 10);
}, 30_000);

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  resetFactorySeq();
});

// ── テスト: GET /api/account ──────────────────────────────

describe('GET /api/account', () => {
  it('認証なしで 401 を返す', async () => {
    const res = await request(app).get('/api/account');
    expect(res.status).toBe(401);
  });

  it('無効なトークンで 401 を返す', async () => {
    const res = await request(app)
      .get('/api/account')
      .set('Cookie', ['token=invalid-jwt-token']);
    expect(res.status).toBe(401);
  });

  it('認証済みユーザーのアカウント情報を返す', async () => {
    const pharmacy = await makePharmacy(testDb, {
      name: 'テスト取得薬局',
      email: 'get-account@example.com',
      passwordHash: knownPasswordHash,
    });
    const cookie = makeAuthCookie(pharmacy);

    const res = await request(app)
      .get('/api/account')
      .set('Cookie', [cookie]);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(pharmacy.id);
    expect(res.body.email).toBe('get-account@example.com');
    expect(res.body.name).toBe('テスト取得薬局');
    expect(res.body).toHaveProperty('postalCode');
    expect(res.body).toHaveProperty('address');
    expect(res.body).toHaveProperty('phone');
    expect(res.body).toHaveProperty('fax');
    expect(res.body).toHaveProperty('licenseNumber');
    expect(res.body).toHaveProperty('prefecture');
    expect(res.body).toHaveProperty('version');
    expect(res.body).toHaveProperty('createdAt');
  });

  it('レスポンスにパスワードハッシュを含まない', async () => {
    const pharmacy = await makePharmacy(testDb, { passwordHash: knownPasswordHash });
    const cookie = makeAuthCookie(pharmacy);

    const res = await request(app)
      .get('/api/account')
      .set('Cookie', [cookie]);
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('passwordHash');
    expect(res.body).not.toHaveProperty('password_hash');
  });

  it('非アクティブユーザーで 401/403 を返す', async () => {
    const pharmacy = await makePharmacy(testDb, {
      passwordHash: knownPasswordHash,
      isActive: false,
    });
    const cookie = makeAuthCookie(pharmacy);

    const res = await request(app)
      .get('/api/account')
      .set('Cookie', [cookie]);
    // auth middleware が isActive=false を検出して 401 を返す
    expect([401, 403]).toContain(res.status);
  });

  it('存在しないユーザーIDのトークンで 401 を返す', async () => {
    // 存在しない pharmacy ID でトークン生成
    const fakeCookie = makeAuthCookie({
      id: 99999,
      email: 'fake@example.com',
      passwordHash: '$2b$10$dummyhashvalue000000000000000000000000000000',
      isAdmin: false,
    });
    const res = await request(app)
      .get('/api/account')
      .set('Cookie', [fakeCookie]);
    expect(res.status).toBe(401);
  });
});

// ── テスト: PUT /api/account ──────────────────────────────

describe('PUT /api/account', () => {
  it('認証なしで 401 を返す', async () => {
    const res = await request(app).put('/api/account').send({ name: 'テスト' });
    expect(res.status).toBe(401);
  });

  it('version なしで 400 を返す', async () => {
    const pharmacy = await makePharmacy(testDb, { passwordHash: knownPasswordHash });
    const cookie = makeAuthCookie(pharmacy);
    const csrf = makeCsrfPair();

    const res = await request(app)
      .put('/api/account')
      .set('Cookie', [cookie, csrf.cookie])
      .set('x-csrf-token', csrf.header)
      .send({ name: '新しい名前' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('バージョン');
  });

  it('不正な version（文字列）で 400 を返す', async () => {
    const pharmacy = await makePharmacy(testDb, { passwordHash: knownPasswordHash });
    const cookie = makeAuthCookie(pharmacy);
    const csrf = makeCsrfPair();

    const res = await request(app)
      .put('/api/account')
      .set('Cookie', [cookie, csrf.cookie])
      .set('x-csrf-token', csrf.header)
      .send({ name: '新しい名前', version: 'abc' });
    expect(res.status).toBe(400);
  });

  it('薬局名を更新できる', async () => {
    const pharmacy = await makePharmacy(testDb, { passwordHash: knownPasswordHash });
    const cookie = makeAuthCookie(pharmacy);
    const csrf = makeCsrfPair();

    const res = await request(app)
      .put('/api/account')
      .set('Cookie', [cookie, csrf.cookie])
      .set('x-csrf-token', csrf.header)
      .send({ name: '更新後の薬局名', version: 1 });
    expect(res.status).toBe(200);
    expect(res.body.message).toContain('更新');
    expect(res.body.version).toBe(2);
  });

  it('メールアドレスを更新できる', async () => {
    const pharmacy = await makePharmacy(testDb, { passwordHash: knownPasswordHash, email: 'old@example.com' });
    const cookie = makeAuthCookie(pharmacy);
    const csrf = makeCsrfPair();

    const res = await request(app)
      .put('/api/account')
      .set('Cookie', [cookie, csrf.cookie])
      .set('x-csrf-token', csrf.header)
      .send({ email: 'new@example.com', version: 1 });
    expect(res.status).toBe(200);
    expect(res.body.message).toContain('更新');
  });

  it('不正なメールアドレスで 400 を返す', async () => {
    const pharmacy = await makePharmacy(testDb, { passwordHash: knownPasswordHash });
    const cookie = makeAuthCookie(pharmacy);
    const csrf = makeCsrfPair();

    const res = await request(app)
      .put('/api/account')
      .set('Cookie', [cookie, csrf.cookie])
      .set('x-csrf-token', csrf.header)
      .send({ email: 'invalid-email', version: 1 });
    expect(res.status).toBe(400);
  });

  it('重複するメールアドレスで 409 を返す', async () => {
    await makePharmacy(testDb, { email: 'existing@example.com', passwordHash: knownPasswordHash });
    const pharmacy = await makePharmacy(testDb, { passwordHash: knownPasswordHash });
    const cookie = makeAuthCookie(pharmacy);
    const csrf = makeCsrfPair();

    const res = await request(app)
      .put('/api/account')
      .set('Cookie', [cookie, csrf.cookie])
      .set('x-csrf-token', csrf.header)
      .send({ email: 'existing@example.com', version: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('メールアドレス');
  });

  it('空の薬局名で 400 を返す', async () => {
    const pharmacy = await makePharmacy(testDb, { passwordHash: knownPasswordHash });
    const cookie = makeAuthCookie(pharmacy);
    const csrf = makeCsrfPair();

    const res = await request(app)
      .put('/api/account')
      .set('Cookie', [cookie, csrf.cookie])
      .set('x-csrf-token', csrf.header)
      .send({ name: '', version: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('薬局名');
  });

  it('不正な郵便番号で 400 を返す', async () => {
    const pharmacy = await makePharmacy(testDb, { passwordHash: knownPasswordHash });
    const cookie = makeAuthCookie(pharmacy);
    const csrf = makeCsrfPair();

    const res = await request(app)
      .put('/api/account')
      .set('Cookie', [cookie, csrf.cookie])
      .set('x-csrf-token', csrf.header)
      .send({ postalCode: '123', version: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('郵便番号');
  });

  it('楽観的ロック: 古い version で 409 を返す', async () => {
    const pharmacy = await makePharmacy(testDb, { passwordHash: knownPasswordHash });
    const cookie = makeAuthCookie(pharmacy);
    const csrf = makeCsrfPair();

    // 先に version を上げる（version 1 -> 2）
    const first = await request(app)
      .put('/api/account')
      .set('Cookie', [cookie, csrf.cookie])
      .set('x-csrf-token', csrf.header)
      .send({ name: '先行更新', version: 1 });
    expect(first.status).toBe(200);

    // 古い version で更新を試みる
    const second = await request(app)
      .put('/api/account')
      .set('Cookie', [cookie, csrf.cookie])
      .set('x-csrf-token', csrf.header)
      .send({ name: '競合更新', version: 1 });
    expect(second.status).toBe(409);
    expect(second.body).toHaveProperty('latestData');
  });

  it('CSRF トークンなしの PUT で 403 を返す', async () => {
    const pharmacy = await makePharmacy(testDb, { passwordHash: knownPasswordHash });
    const cookie = makeAuthCookie(pharmacy);

    const res = await request(app)
      .put('/api/account')
      .set('Cookie', [cookie])
      .send({ name: '新しい名前', version: 1 });
    expect(res.status).toBe(403);
  });

  it('新しいパスワードを設定できる（現在のパスワード付き）', async () => {
    const pharmacy = await makePharmacy(testDb, { passwordHash: knownPasswordHash });
    const cookie = makeAuthCookie(pharmacy);
    const csrf = makeCsrfPair();

    const res = await request(app)
      .put('/api/account')
      .set('Cookie', [cookie, csrf.cookie])
      .set('x-csrf-token', csrf.header)
      .send({
        currentPassword: KNOWN_PASSWORD,
        newPassword: 'newpassword456',
        version: 1,
      });
    expect(res.status).toBe(200);
    expect(res.body.message).toContain('更新');
  });

  it('現在のパスワードが間違っている場合に 400 を返す', async () => {
    // ダミー薬局を挿入してユニークな ID を取得し、レートリミッター衝突を回避
    await makePharmacy(testDb);
    await makePharmacy(testDb);
    const pharmacy = await makePharmacy(testDb, { passwordHash: knownPasswordHash });
    const cookie = makeAuthCookie(pharmacy);
    const csrf = makeCsrfPair();

    const res = await request(app)
      .put('/api/account')
      .set('Cookie', [cookie, csrf.cookie])
      .set('x-csrf-token', csrf.header)
      .send({
        currentPassword: 'wrongpassword',
        newPassword: 'newpassword456',
        version: 1,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('パスワード');
  });

  it('新しいパスワードが短すぎる場合に 400 を返す', async () => {
    // ダミー薬局を挿入してユニークな ID を取得し、レートリミッター衝突を回避
    await makePharmacy(testDb);
    await makePharmacy(testDb);
    await makePharmacy(testDb);
    const pharmacy = await makePharmacy(testDb, { passwordHash: knownPasswordHash });
    const cookie = makeAuthCookie(pharmacy);
    const csrf = makeCsrfPair();

    const res = await request(app)
      .put('/api/account')
      .set('Cookie', [cookie, csrf.cookie])
      .set('x-csrf-token', csrf.header)
      .send({
        currentPassword: KNOWN_PASSWORD,
        newPassword: 'short',
        version: 1,
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('パスワード');
  });

  it('currentPassword なしで newPassword を送ると 400 を返す', async () => {
    // ダミー薬局を挿入してユニークな ID を取得し、レートリミッター衝突を回避
    await makePharmacy(testDb);
    await makePharmacy(testDb);
    await makePharmacy(testDb);
    await makePharmacy(testDb);
    const pharmacy = await makePharmacy(testDb, { passwordHash: knownPasswordHash });
    const cookie = makeAuthCookie(pharmacy);
    const csrf = makeCsrfPair();

    const res = await request(app)
      .put('/api/account')
      .set('Cookie', [cookie, csrf.cookie])
      .set('x-csrf-token', csrf.header)
      .send({
        newPassword: 'newpassword456',
        version: 1,
      });
    expect(res.status).toBe(400);
  });
});

// ── テスト: DELETE /api/account ──────────────────────────────

describe('DELETE /api/account', () => {
  it('認証なしで 401 を返す', async () => {
    const res = await request(app).delete('/api/account');
    expect(res.status).toBe(401);
  });

  it('パスワードなしで 400 を返す', async () => {
    const pharmacy = await makePharmacy(testDb, { passwordHash: knownPasswordHash });
    const cookie = makeAuthCookie(pharmacy);
    const csrf = makeCsrfPair();

    const res = await request(app)
      .delete('/api/account')
      .set('Cookie', [cookie, csrf.cookie])
      .set('x-csrf-token', csrf.header)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('パスワード');
  });

  it('間違ったパスワードで 400 を返す', async () => {
    const pharmacy = await makePharmacy(testDb, { passwordHash: knownPasswordHash });
    const cookie = makeAuthCookie(pharmacy);
    const csrf = makeCsrfPair();

    const res = await request(app)
      .delete('/api/account')
      .set('Cookie', [cookie, csrf.cookie])
      .set('x-csrf-token', csrf.header)
      .send({ currentPassword: 'wrong-password' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('パスワード');
  });

  it('正しいパスワードでアカウントを無効化できる', async () => {
    const pharmacy = await makePharmacy(testDb, { passwordHash: knownPasswordHash });
    const cookie = makeAuthCookie(pharmacy);
    const csrf = makeCsrfPair();

    const res = await request(app)
      .delete('/api/account')
      .set('Cookie', [cookie, csrf.cookie])
      .set('x-csrf-token', csrf.header)
      .send({ currentPassword: KNOWN_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.message).toContain('無効化');
  });

  it('CSRF トークンなしの DELETE で 403 を返す', async () => {
    const pharmacy = await makePharmacy(testDb, { passwordHash: knownPasswordHash });
    const cookie = makeAuthCookie(pharmacy);

    const res = await request(app)
      .delete('/api/account')
      .set('Cookie', [cookie])
      .send({ currentPassword: KNOWN_PASSWORD });
    expect(res.status).toBe(403);
  });
});
