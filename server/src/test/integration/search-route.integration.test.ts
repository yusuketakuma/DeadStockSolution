import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { getTestDb, resetTestDb, closeTestDb, type TestDb } from './helpers/test-db';
import { makePharmacy, makeUpload, makeDeadStockItem, makeDrugMaster, resetFactorySeq } from './helpers/factories';
import { makeAuthCookie } from './helpers/auth-helper';
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

// ── テスト ──────────────────────────────────────────────

describe('GET /api/search/drugs', () => {
  it('認証なしで 401 を返す', async () => {
    const res = await request(app).get('/api/search/drugs');
    expect(res.status).toBe(401);
  });

  it('クエリなしで空配列を返す', async () => {
    const pharmacy = await makePharmacy(testDb);
    const cookie = makeAuthCookie(pharmacy);

    const res = await request(app)
      .get('/api/search/drugs')
      .set('Cookie', [cookie]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('空文字クエリで空配列を返す', async () => {
    const pharmacy = await makePharmacy(testDb);
    const cookie = makeAuthCookie(pharmacy);

    const res = await request(app)
      .get('/api/search/drugs?q=')
      .set('Cookie', [cookie]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('空白のみのクエリで空配列を返す', async () => {
    const pharmacy = await makePharmacy(testDb);
    const cookie = makeAuthCookie(pharmacy);

    const res = await request(app)
      .get('/api/search/drugs?q=%20%20')
      .set('Cookie', [cookie]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('一致するデッドストックがない場合に空配列を返す', async () => {
    const pharmacy = await makePharmacy(testDb);
    const cookie = makeAuthCookie(pharmacy);

    const res = await request(app)
      .get('/api/search/drugs?q=存在しない薬')
      .set('Cookie', [cookie]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('一致するデッドストック薬品名を返す', async () => {
    const pharmacy = await makePharmacy(testDb);
    const upload = await makeUpload(testDb, pharmacy.id);
    await makeDeadStockItem(testDb, pharmacy.id, upload.id, {
      drugName: 'アムロジピン錠5mg',
      isAvailable: true,
    });
    const cookie = makeAuthCookie(pharmacy);

    const res = await request(app)
      .get('/api/search/drugs?q=アムロジピン')
      .set('Cookie', [cookie]);
    expect(res.status).toBe(200);
    expect(res.body).toContain('アムロジピン錠5mg');
  });

  it('isAvailable=false のアイテムは検索結果に含まない', async () => {
    const pharmacy = await makePharmacy(testDb);
    const upload = await makeUpload(testDb, pharmacy.id);
    await makeDeadStockItem(testDb, pharmacy.id, upload.id, {
      drugName: '非公開薬品A',
      isAvailable: false,
    });
    const cookie = makeAuthCookie(pharmacy);

    const res = await request(app)
      .get('/api/search/drugs?q=非公開薬品')
      .set('Cookie', [cookie]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('最大10件まで返す', async () => {
    const pharmacy = await makePharmacy(testDb);
    const upload = await makeUpload(testDb, pharmacy.id);
    for (let i = 0; i < 15; i++) {
      await makeDeadStockItem(testDb, pharmacy.id, upload.id, {
        drugName: `テスト共通薬${i}`,
        isAvailable: true,
      });
    }
    const cookie = makeAuthCookie(pharmacy);

    const res = await request(app)
      .get('/api/search/drugs?q=テスト共通薬')
      .set('Cookie', [cookie]);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeLessThanOrEqual(10);
  });

  it('重複する薬品名はユニークに返す', async () => {
    const pharmacyA = await makePharmacy(testDb);
    const pharmacyB = await makePharmacy(testDb);
    const uploadA = await makeUpload(testDb, pharmacyA.id);
    const uploadB = await makeUpload(testDb, pharmacyB.id);
    await makeDeadStockItem(testDb, pharmacyA.id, uploadA.id, {
      drugName: '共通薬品名テスト',
      isAvailable: true,
    });
    await makeDeadStockItem(testDb, pharmacyB.id, uploadB.id, {
      drugName: '共通薬品名テスト',
      isAvailable: true,
    });
    const cookie = makeAuthCookie(pharmacyA);

    const res = await request(app)
      .get('/api/search/drugs?q=共通薬品名テスト')
      .set('Cookie', [cookie]);
    expect(res.status).toBe(200);
    // selectDistinct なので重複排除されるはず
    const matchingEntries = res.body.filter((name: string) => name === '共通薬品名テスト');
    expect(matchingEntries.length).toBe(1);
  });
});

describe('GET /api/search/drug-master', () => {
  it('認証なしで 401 を返す', async () => {
    const res = await request(app).get('/api/search/drug-master');
    expect(res.status).toBe(401);
  });

  it('クエリなしで空配列を返す', async () => {
    const pharmacy = await makePharmacy(testDb);
    const cookie = makeAuthCookie(pharmacy);

    const res = await request(app)
      .get('/api/search/drug-master')
      .set('Cookie', [cookie]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('一致する医薬品マスターデータを返す', async () => {
    const pharmacy = await makePharmacy(testDb);
    await makeDrugMaster(testDb, {
      drugName: 'ロキソプロフェン錠60mg',
      yjCode: '1149019F1ZZZ',
      yakkaPrice: '10.10',
      isListed: true,
    });
    const cookie = makeAuthCookie(pharmacy);

    const res = await request(app)
      .get('/api/search/drug-master?q=ロキソプロフェン')
      .set('Cookie', [cookie]);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0]).toHaveProperty('yjCode');
    expect(res.body[0]).toHaveProperty('drugName');
    expect(res.body[0]).toHaveProperty('yakkaPrice');
  });

  it('isListed=false のマスターは検索結果に含まない', async () => {
    const pharmacy = await makePharmacy(testDb);
    await makeDrugMaster(testDb, {
      drugName: '非収載薬品テスト',
      isListed: false,
    });
    const cookie = makeAuthCookie(pharmacy);

    const res = await request(app)
      .get('/api/search/drug-master?q=非収載薬品テスト')
      .set('Cookie', [cookie]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('YJコードで検索できる', async () => {
    const pharmacy = await makePharmacy(testDb);
    await makeDrugMaster(testDb, {
      drugName: 'テスト薬YJコード検索',
      yjCode: '2345678F1ZZZ',
      isListed: true,
    });
    const cookie = makeAuthCookie(pharmacy);

    const res = await request(app)
      .get('/api/search/drug-master?q=2345678F1')
      .set('Cookie', [cookie]);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].yjCode).toBe('2345678F1ZZZ');
  });
});

describe('GET /api/search/pharmacies', () => {
  it('認証なしで 401 を返す', async () => {
    const res = await request(app).get('/api/search/pharmacies');
    expect(res.status).toBe(401);
  });

  it('クエリなしで空配列を返す', async () => {
    const pharmacy = await makePharmacy(testDb);
    const cookie = makeAuthCookie(pharmacy);

    const res = await request(app)
      .get('/api/search/pharmacies')
      .set('Cookie', [cookie]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('一致する薬局名を返す', async () => {
    const pharmacy = await makePharmacy(testDb, { name: 'さくら調剤薬局' });
    const cookie = makeAuthCookie(pharmacy);

    const res = await request(app)
      .get('/api/search/pharmacies?q=さくら')
      .set('Cookie', [cookie]);
    expect(res.status).toBe(200);
    expect(res.body).toContain('さくら調剤薬局');
  });

  it('isActive=false の薬局は検索結果に含まない', async () => {
    const activePharmacy = await makePharmacy(testDb, { name: '検索テスト薬局活動中' });
    await makePharmacy(testDb, { name: '検索テスト薬局無効', isActive: false });
    const cookie = makeAuthCookie(activePharmacy);

    const res = await request(app)
      .get('/api/search/pharmacies?q=検索テスト薬局')
      .set('Cookie', [cookie]);
    expect(res.status).toBe(200);
    expect(res.body).toContain('検索テスト薬局活動中');
    expect(res.body).not.toContain('検索テスト薬局無効');
  });

  it('一致する薬局がない場合に空配列を返す', async () => {
    const pharmacy = await makePharmacy(testDb);
    const cookie = makeAuthCookie(pharmacy);

    const res = await request(app)
      .get('/api/search/pharmacies?q=存在しない薬局名XYZ')
      .set('Cookie', [cookie]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
