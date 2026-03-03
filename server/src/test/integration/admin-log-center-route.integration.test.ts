import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getTestDb, resetTestDb, closeTestDb, type TestDb } from './helpers/test-db';
import { makePharmacy, makeActivityLog, resetFactorySeq } from './helpers/factories';
import { makeAuthCookie } from './helpers/auth-helper';
import * as schema from '../../db/schema';
import request from 'supertest';

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

// ── セットアップ ──────────────────────────────────────────

beforeAll(async () => {
  testDb = await getTestDb();
  ({ default: app } = await import('../../app'));
}, 30_000);

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  resetFactorySeq();
});

// ── ヘルパー: テストデータ作成 ──────────────────────────────

async function makeSystemEvent(
  overrides: Partial<typeof schema.systemEvents.$inferInsert> = {},
): Promise<typeof schema.systemEvents.$inferSelect> {
  const defaults: typeof schema.systemEvents.$inferInsert = {
    source: 'runtime_error',
    level: 'error',
    eventType: 'test_event',
    message: 'テストイベントメッセージ',
    ...overrides,
  };
  const [row] = await testDb.insert(schema.systemEvents).values(defaults).returning();
  return row;
}

async function makeSyncLog(
  overrides: Partial<typeof schema.drugMasterSyncLogs.$inferInsert> = {},
): Promise<typeof schema.drugMasterSyncLogs.$inferSelect> {
  const defaults: typeof schema.drugMasterSyncLogs.$inferInsert = {
    syncType: 'manual',
    sourceDescription: 'テスト同期',
    status: 'success',
    ...overrides,
  };
  const [row] = await testDb.insert(schema.drugMasterSyncLogs).values(defaults).returning();
  return row;
}

// ── テスト ──────────────────────────────────────────────

describe('GET /api/admin/log-center', () => {
  it('認証なしで 401 を返す', async () => {
    const res = await request(app).get('/api/admin/log-center');
    expect(res.status).toBe(401);
  });

  it('非管理者ユーザーで 403 を返す', async () => {
    const pharmacy = await makePharmacy(testDb, { isAdmin: false });
    const cookie = makeAuthCookie(pharmacy);

    const res = await request(app)
      .get('/api/admin/log-center')
      .set('Cookie', [cookie]);
    expect(res.status).toBe(403);
  });

  it('管理者ユーザーでログ一覧を取得できる', async () => {
    const admin = await makePharmacy(testDb, { isAdmin: true });
    await makeActivityLog(testDb, { action: 'login', detail: 'テストログイン' });
    const cookie = makeAuthCookie(admin);

    const res = await request(app)
      .get('/api/admin/log-center')
      .set('Cookie', [cookie]);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('pagination');
    expect(res.body.pagination).toHaveProperty('page');
    expect(res.body.pagination).toHaveProperty('limit');
    expect(res.body.pagination).toHaveProperty('total');
    expect(res.body.pagination).toHaveProperty('totalPages');
  });

  it('ログがない場合に空のデータを返す', async () => {
    const admin = await makePharmacy(testDb, { isAdmin: true });
    const cookie = makeAuthCookie(admin);

    const res = await request(app)
      .get('/api/admin/log-center')
      .set('Cookie', [cookie]);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
  });

  it('activity_logs ソースでフィルタリングできる', async () => {
    const admin = await makePharmacy(testDb, { isAdmin: true });
    await makeActivityLog(testDb, { action: 'upload', detail: 'ファイルアップロード' });
    await makeSystemEvent({ message: 'システムエラー' });
    const cookie = makeAuthCookie(admin);

    const res = await request(app)
      .get('/api/admin/log-center?source=activity_logs')
      .set('Cookie', [cookie]);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    for (const entry of res.body.data) {
      expect(entry.source).toBe('activity_logs');
    }
  });

  it('system_events ソースでフィルタリングできる', async () => {
    const admin = await makePharmacy(testDb, { isAdmin: true });
    await makeActivityLog(testDb, { action: 'login', detail: 'テスト' });
    await makeSystemEvent({ message: 'テストシステムイベント' });
    const cookie = makeAuthCookie(admin);

    const res = await request(app)
      .get('/api/admin/log-center?source=system_events')
      .set('Cookie', [cookie]);
    expect(res.status).toBe(200);
    for (const entry of res.body.data) {
      expect(entry.source).toBe('system_events');
    }
  });

  it('複数ソースをカンマ区切りでフィルタリングできる', async () => {
    const admin = await makePharmacy(testDb, { isAdmin: true });
    await makeActivityLog(testDb, { action: 'test', detail: 'テスト' });
    await makeSystemEvent({ message: 'テスト' });
    await makeSyncLog({ sourceDescription: 'テスト同期' });
    const cookie = makeAuthCookie(admin);

    const res = await request(app)
      .get('/api/admin/log-center?source=activity_logs,system_events')
      .set('Cookie', [cookie]);
    expect(res.status).toBe(200);
    for (const entry of res.body.data) {
      expect(['activity_logs', 'system_events']).toContain(entry.source);
    }
  });

  it('不正なソース名は無視される', async () => {
    const admin = await makePharmacy(testDb, { isAdmin: true });
    await makeActivityLog(testDb, { action: 'test', detail: 'テスト' });
    const cookie = makeAuthCookie(admin);

    // 不正なソース名のみの場合、フィルタなし（全ソース）として扱われる
    const res = await request(app)
      .get('/api/admin/log-center?source=invalid_source')
      .set('Cookie', [cookie]);
    expect(res.status).toBe(200);
  });

  it('不正な level パラメータで 400 を返す', async () => {
    const admin = await makePharmacy(testDb, { isAdmin: true });
    await makeActivityLog(testDb, { action: 'test', detail: 'テスト' });
    const cookie = makeAuthCookie(admin);

    const res = await request(app)
      .get('/api/admin/log-center?level=invalid_level')
      .set('Cookie', [cookie]);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('level');
  });

  it('from パラメータで日時フィルタリングできる', async () => {
    const admin = await makePharmacy(testDb, { isAdmin: true });
    await makeActivityLog(testDb, { action: 'old_event', detail: '古いイベント' });
    const cookie = makeAuthCookie(admin);

    const futureDate = new Date(Date.now() + 86400000).toISOString();
    const res = await request(app)
      .get(`/api/admin/log-center?from=${encodeURIComponent(futureDate)}`)
      .set('Cookie', [cookie]);
    expect(res.status).toBe(200);
    // 未来の日時をfromに指定しているのでデータは0件のはず
    expect(res.body.data).toEqual([]);
  });

  it('不正な from パラメータで 400 を返す', async () => {
    const admin = await makePharmacy(testDb, { isAdmin: true });
    const cookie = makeAuthCookie(admin);

    const res = await request(app)
      .get('/api/admin/log-center?from=invalid-date')
      .set('Cookie', [cookie]);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('from');
  });

  it('不正な to パラメータで 400 を返す', async () => {
    const admin = await makePharmacy(testDb, { isAdmin: true });
    const cookie = makeAuthCookie(admin);

    const res = await request(app)
      .get('/api/admin/log-center?to=not-a-date')
      .set('Cookie', [cookie]);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('to');
  });

  it('from が to より後の場合に 400 を返す', async () => {
    const admin = await makePharmacy(testDb, { isAdmin: true });
    const cookie = makeAuthCookie(admin);

    const res = await request(app)
      .get('/api/admin/log-center?from=2026-03-10T00:00:00Z&to=2026-03-01T00:00:00Z')
      .set('Cookie', [cookie]);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('from');
  });

  it('期間が90日を超える場合に 400 を返す', async () => {
    const admin = await makePharmacy(testDb, { isAdmin: true });
    const cookie = makeAuthCookie(admin);

    const res = await request(app)
      .get('/api/admin/log-center?from=2025-01-01T00:00:00Z&to=2025-12-31T00:00:00Z')
      .set('Cookie', [cookie]);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('90日');
  });

  it('ページネーションが機能する', async () => {
    const admin = await makePharmacy(testDb, { isAdmin: true });
    for (let i = 0; i < 5; i++) {
      await makeActivityLog(testDb, { action: `page_test_${i}`, detail: `テスト${i}` });
    }
    const cookie = makeAuthCookie(admin);

    const res = await request(app)
      .get('/api/admin/log-center?page=1&limit=2')
      .set('Cookie', [cookie]);
    expect(res.status).toBe(200);
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.limit).toBe(2);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
  });

  it('2ページ目を取得できる', async () => {
    const admin = await makePharmacy(testDb, { isAdmin: true });
    for (let i = 0; i < 5; i++) {
      await makeActivityLog(testDb, { action: `page2_test_${i}`, detail: `テスト${i}` });
    }
    const cookie = makeAuthCookie(admin);

    const page1 = await request(app)
      .get('/api/admin/log-center?page=1&limit=2')
      .set('Cookie', [cookie]);
    const page2 = await request(app)
      .get('/api/admin/log-center?page=2&limit=2')
      .set('Cookie', [cookie]);

    expect(page1.status).toBe(200);
    expect(page2.status).toBe(200);
    // ページ間でデータが重複しないことを確認
    const page1Ids = page1.body.data.map((e: { id: number }) => e.id);
    const page2Ids = page2.body.data.map((e: { id: number }) => e.id);
    const overlap = page1Ids.filter((id: number) => page2Ids.includes(id));
    expect(overlap.length).toBe(0);
  });

  it('同一タイムスタンプの複数ソースでもページ間重複が発生しない', async () => {
    const admin = await makePharmacy(testDb, { isAdmin: true });
    const fixedTs = '2026-04-01T00:00:00.000Z';

    for (let i = 0; i < 30; i++) {
      await makeActivityLog(testDb, {
        action: `mixed_activity_${i}`,
        detail: `activity ${i}`,
        createdAt: fixedTs,
      });
    }
    for (let i = 0; i < 30; i++) {
      await makeSystemEvent({
        level: 'warning',
        message: `system ${i}`,
        occurredAt: fixedTs,
      });
    }

    const cookie = makeAuthCookie(admin);
    const page1 = await request(app)
      .get('/api/admin/log-center?source=activity_logs,system_events&page=1&limit=30')
      .set('Cookie', [cookie]);
    const page2 = await request(app)
      .get('/api/admin/log-center?source=activity_logs,system_events&page=2&limit=30')
      .set('Cookie', [cookie]);

    expect(page1.status).toBe(200);
    expect(page2.status).toBe(200);
    expect(page1.body.pagination.total).toBe(60);
    expect(page2.body.pagination.total).toBe(60);
    expect(page1.body.data).toHaveLength(30);
    expect(page2.body.data).toHaveLength(30);

    const page1Keys = new Set(
      page1.body.data.map((entry: { source: string; id: number }) => `${entry.source}:${entry.id}`),
    );
    const page2Keys = new Set(
      page2.body.data.map((entry: { source: string; id: number }) => `${entry.source}:${entry.id}`),
    );
    const overlap = [...page1Keys].filter((key) => page2Keys.has(key));
    expect(overlap).toHaveLength(0);
  });

  it('pharmacyId でフィルタリングできる', async () => {
    const admin = await makePharmacy(testDb, { isAdmin: true });
    const targetPharmacy = await makePharmacy(testDb, { name: 'ターゲット薬局' });
    await makeActivityLog(testDb, {
      action: 'upload',
      detail: 'ターゲットのアクション',
      pharmacyId: targetPharmacy.id,
    });
    await makeActivityLog(testDb, {
      action: 'upload',
      detail: '他のアクション',
      pharmacyId: admin.id,
    });
    const cookie = makeAuthCookie(admin);

    const res = await request(app)
      .get(`/api/admin/log-center?pharmacyId=${targetPharmacy.id}`)
      .set('Cookie', [cookie]);
    expect(res.status).toBe(200);
    for (const entry of res.body.data) {
      expect(entry.pharmacyId).toBe(targetPharmacy.id);
    }
  });

  it('activity_logs が偏在する深いページでも件数不足にならない', async () => {
    const admin = await makePharmacy(testDb, { isAdmin: true });
    for (let i = 0; i < 120; i++) {
      await makeActivityLog(testDb, {
        action: `deep_page_${i}`,
        detail: `深いページ検証 ${i}`,
      });
    }
    const cookie = makeAuthCookie(admin);

    const res = await request(app)
      .get('/api/admin/log-center?source=activity_logs&page=3&limit=50')
      .set('Cookie', [cookie]);

    expect(res.status).toBe(200);
    expect(res.body.pagination.page).toBe(3);
    expect(res.body.pagination.limit).toBe(50);
    expect(res.body.pagination.total).toBe(120);
    expect(res.body.data).toHaveLength(20);
    for (const entry of res.body.data) {
      expect(entry.source).toBe('activity_logs');
    }
  });
});

describe('GET /api/admin/log-center/summary', () => {
  it('認証なしで 401 を返す', async () => {
    const res = await request(app).get('/api/admin/log-center/summary');
    expect(res.status).toBe(401);
  });

  it('非管理者ユーザーで 403 を返す', async () => {
    const pharmacy = await makePharmacy(testDb, { isAdmin: false });
    const cookie = makeAuthCookie(pharmacy);

    const res = await request(app)
      .get('/api/admin/log-center/summary')
      .set('Cookie', [cookie]);
    expect(res.status).toBe(403);
  });

  it('管理者ユーザーでサマリーを取得できる', async () => {
    const admin = await makePharmacy(testDb, { isAdmin: true });
    await makeActivityLog(testDb, { action: 'test', detail: 'テスト' });
    await makeSystemEvent({ level: 'error', message: 'エラーイベント' });
    await makeSystemEvent({ level: 'warning', message: '警告イベント' });
    const cookie = makeAuthCookie(admin);

    const res = await request(app)
      .get('/api/admin/log-center/summary')
      .set('Cookie', [cookie]);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('errors');
    expect(res.body).toHaveProperty('warnings');
    expect(res.body).toHaveProperty('today');
    expect(res.body).toHaveProperty('bySeverity');
    expect(res.body).toHaveProperty('bySource');
    expect(res.body.total).toBeGreaterThanOrEqual(3);
    expect(res.body.errors).toBeGreaterThanOrEqual(1);
    expect(res.body.warnings).toBeGreaterThanOrEqual(1);
  });

  it('ログがない場合にゼロのサマリーを返す', async () => {
    const admin = await makePharmacy(testDb, { isAdmin: true });
    const cookie = makeAuthCookie(admin);

    const res = await request(app)
      .get('/api/admin/log-center/summary')
      .set('Cookie', [cookie]);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.errors).toBe(0);
    expect(res.body.warnings).toBe(0);
  });
});
