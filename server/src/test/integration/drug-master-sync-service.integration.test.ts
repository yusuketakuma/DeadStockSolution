import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getTestDb, resetTestDb, closeTestDb, type TestDb } from './helpers/test-db';
import { resetFactorySeq } from './helpers/factories';
import * as schema from '../../db/schema';
import type { ParsedDrugRow } from '../../services/drug-master-parser-service';

// Mock the db module to use our test db
let testDb: TestDb;
let syncDrugMaster: (typeof import('../../services/drug-master-sync-service'))['syncDrugMaster'];
let createSyncLog: (typeof import('../../services/drug-master-sync-service'))['createSyncLog'];
let completeSyncLog: (typeof import('../../services/drug-master-sync-service'))['completeSyncLog'];
vi.mock('../../config/database', () => ({
  get db() { return testDb; },
}));

// Mock logger
vi.mock('../../services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

beforeAll(async () => {
  testDb = await getTestDb();
  ({ syncDrugMaster, createSyncLog, completeSyncLog } =
    await import('../../services/drug-master-sync-service'));
}, 30_000);

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  resetFactorySeq();
});

// ── ヘルパー ──────────────────────────────────────────

function makeParsedDrugRow(overrides: Partial<ParsedDrugRow> = {}): ParsedDrugRow {
  return {
    yjCode: '1234567890',
    drugName: 'テスト医薬品',
    genericName: 'テスト一般名',
    specification: '10mg',
    unit: '錠',
    yakkaPrice: 100.5,
    manufacturer: 'テストメーカー',
    category: '内用薬',
    therapeuticCategory: '1141',
    listedDate: '2024-01-01',
    transitionDeadline: null,
    ...overrides,
  };
}

async function createSyncLogForTest(): Promise<number> {
  const log = await createSyncLog('manual', 'テスト同期', null);
  return log.id;
}

// ── syncDrugMaster: 新規INSERT ──────────────────────

describe('syncDrugMaster - 新規INSERT', () => {
  it('新しいYJコードの薬品が正しくINSERTされる', async () => {
    const syncLogId = await createSyncLogForTest();
    const rows = [makeParsedDrugRow({ yjCode: '0001000000', drugName: '新薬品A', yakkaPrice: 250.0 })];

    const result = await syncDrugMaster(rows, syncLogId, '2024-04-01');

    expect(result.itemsProcessed).toBe(1);
    expect(result.itemsAdded).toBe(1);
    expect(result.itemsUpdated).toBe(0);
    expect(result.itemsDeleted).toBe(0);

    // DBに正しく保存されている
    const [item] = await testDb.select().from(schema.drugMaster)
      .where(eq(schema.drugMaster.yjCode, '0001000000'));
    expect(item).toBeDefined();
    expect(item.drugName).toBe('新薬品A');
    expect(Number(item.yakkaPrice)).toBeCloseTo(250.0);
    expect(item.isListed).toBe(true);
  });

  it('新規INSERTで薬価履歴がnew_listingとして記録される', async () => {
    const syncLogId = await createSyncLogForTest();
    const rows = [makeParsedDrugRow({ yjCode: '0002000000', yakkaPrice: 300.0 })];

    await syncDrugMaster(rows, syncLogId, '2024-04-01');

    const history = await testDb.select().from(schema.drugMasterPriceHistory)
      .where(eq(schema.drugMasterPriceHistory.yjCode, '0002000000'));
    expect(history).toHaveLength(1);
    expect(history[0].revisionType).toBe('new_listing');
    expect(history[0].previousPrice).toBeNull();
    expect(Number(history[0].newPrice)).toBeCloseTo(300.0);
    expect(history[0].revisionDate).toBe('2024-04-01');
  });

  it('複数のレコードを一括INSERTできる', async () => {
    const syncLogId = await createSyncLogForTest();
    const rows = [
      makeParsedDrugRow({ yjCode: '0010000000', drugName: '薬品1' }),
      makeParsedDrugRow({ yjCode: '0020000000', drugName: '薬品2' }),
      makeParsedDrugRow({ yjCode: '0030000000', drugName: '薬品3' }),
    ];

    const result = await syncDrugMaster(rows, syncLogId, '2024-04-01');

    expect(result.itemsProcessed).toBe(3);
    expect(result.itemsAdded).toBe(3);

    const allItems = await testDb.select().from(schema.drugMaster);
    expect(allItems).toHaveLength(3);
  });
});

// ── syncDrugMaster: 既存UPDATEと変更検知 ─────────────

describe('syncDrugMaster - 既存UPDATE', () => {
  it('薬価変更を検出してUPDATEし、薬価履歴を記録する', async () => {
    // 事前にレコードを作成
    const syncLogId1 = await createSyncLogForTest();
    await syncDrugMaster(
      [makeParsedDrugRow({ yjCode: '1000000000', drugName: '薬品X', yakkaPrice: 100.0 })],
      syncLogId1,
      '2024-01-01',
    );

    // 薬価を変更して再同期
    const syncLogId2 = await createSyncLogForTest();
    const result = await syncDrugMaster(
      [makeParsedDrugRow({ yjCode: '1000000000', drugName: '薬品X', yakkaPrice: 150.0 })],
      syncLogId2,
      '2024-04-01',
    );

    expect(result.itemsUpdated).toBe(1);

    // 薬価が更新されている
    const [item] = await testDb.select().from(schema.drugMaster)
      .where(eq(schema.drugMaster.yjCode, '1000000000'));
    expect(Number(item.yakkaPrice)).toBeCloseTo(150.0);

    // 薬価履歴に price_revision が記録されている
    const history = await testDb.select().from(schema.drugMasterPriceHistory)
      .where(eq(schema.drugMasterPriceHistory.yjCode, '1000000000'));
    const priceRevision = history.find((h) => h.revisionType === 'price_revision');
    expect(priceRevision).toBeDefined();
    expect(Number(priceRevision!.previousPrice)).toBeCloseTo(100.0);
    expect(Number(priceRevision!.newPrice)).toBeCloseTo(150.0);
  });

  it('メタデータ変更（品名等）を検出してUPDATEする', async () => {
    const syncLogId1 = await createSyncLogForTest();
    await syncDrugMaster(
      [makeParsedDrugRow({ yjCode: '2000000000', drugName: '旧名称', manufacturer: '旧メーカー' })],
      syncLogId1,
      '2024-01-01',
    );

    // 品名とメーカーを変更
    const syncLogId2 = await createSyncLogForTest();
    const result = await syncDrugMaster(
      [makeParsedDrugRow({ yjCode: '2000000000', drugName: '新名称', manufacturer: '新メーカー' })],
      syncLogId2,
      '2024-04-01',
    );

    expect(result.itemsUpdated).toBe(1);

    const [item] = await testDb.select().from(schema.drugMaster)
      .where(eq(schema.drugMaster.yjCode, '2000000000'));
    expect(item.drugName).toBe('新名称');
    expect(item.manufacturer).toBe('新メーカー');
  });

  it('変更がない場合はUPDATEしない', async () => {
    const syncLogId1 = await createSyncLogForTest();
    const row = makeParsedDrugRow({ yjCode: '3000000000' });
    await syncDrugMaster([row], syncLogId1, '2024-01-01');

    const syncLogId2 = await createSyncLogForTest();
    const result = await syncDrugMaster([row], syncLogId2, '2024-04-01');

    expect(result.itemsUpdated).toBe(0);
    expect(result.itemsProcessed).toBe(1);
  });
});

// ── syncDrugMaster: 経過措置（delisting）────────────

describe('syncDrugMaster - 経過措置マーク', () => {
  it('ファイルに含まれない既存品目はisListed=falseとなる', async () => {
    // 既存レコードを作成
    const syncLogId1 = await createSyncLogForTest();
    await syncDrugMaster(
      [
        makeParsedDrugRow({ yjCode: '4000000000', drugName: '存続薬品' }),
        makeParsedDrugRow({ yjCode: '4100000000', drugName: '削除予定薬品' }),
      ],
      syncLogId1,
      '2024-01-01',
    );

    // 2回目の同期では1つだけ含まれる
    const syncLogId2 = await createSyncLogForTest();
    const result = await syncDrugMaster(
      [makeParsedDrugRow({ yjCode: '4000000000', drugName: '存続薬品' })],
      syncLogId2,
      '2024-04-01',
    );

    expect(result.itemsDeleted).toBe(1);

    // 削除予定薬品のisListedがfalseになっている
    const [delisted] = await testDb.select().from(schema.drugMaster)
      .where(eq(schema.drugMaster.yjCode, '4100000000'));
    expect(delisted.isListed).toBe(false);
    expect(delisted.deletedDate).toBe('2024-04-01');

    // 存続薬品はそのまま
    const [survived] = await testDb.select().from(schema.drugMaster)
      .where(eq(schema.drugMaster.yjCode, '4000000000'));
    expect(survived.isListed).toBe(true);
  });

  it('delistingの薬価履歴が記録される', async () => {
    const syncLogId1 = await createSyncLogForTest();
    await syncDrugMaster(
      [makeParsedDrugRow({ yjCode: '5000000000', yakkaPrice: 500.0 })],
      syncLogId1,
      '2024-01-01',
    );

    // 空の同期で delisting
    const syncLogId2 = await createSyncLogForTest();
    await syncDrugMaster([], syncLogId2, '2024-04-01');

    const history = await testDb.select().from(schema.drugMasterPriceHistory)
      .where(eq(schema.drugMasterPriceHistory.yjCode, '5000000000'));
    const delisting = history.find((h) => h.revisionType === 'delisting');
    expect(delisting).toBeDefined();
    expect(Number(delisting!.previousPrice)).toBeCloseTo(500.0);
    expect(delisting!.newPrice).toBeNull();
  });

  it('delistedされた品目が再収載された場合はisListed=trueに戻る', async () => {
    // 作成
    const syncLogId1 = await createSyncLogForTest();
    await syncDrugMaster(
      [makeParsedDrugRow({ yjCode: '6000000000', drugName: '再収載薬品', yakkaPrice: 200.0 })],
      syncLogId1,
      '2024-01-01',
    );

    // delisting
    const syncLogId2 = await createSyncLogForTest();
    await syncDrugMaster([], syncLogId2, '2024-04-01');

    const [delistedItem] = await testDb.select().from(schema.drugMaster)
      .where(eq(schema.drugMaster.yjCode, '6000000000'));
    expect(delistedItem.isListed).toBe(false);

    // 再収載
    const syncLogId3 = await createSyncLogForTest();
    const result = await syncDrugMaster(
      [makeParsedDrugRow({ yjCode: '6000000000', drugName: '再収載薬品', yakkaPrice: 220.0 })],
      syncLogId3,
      '2024-07-01',
    );

    expect(result.itemsUpdated).toBe(1);

    const [relistItem] = await testDb.select().from(schema.drugMaster)
      .where(eq(schema.drugMaster.yjCode, '6000000000'));
    expect(relistItem.isListed).toBe(true);
    expect(relistItem.deletedDate).toBeNull();
    expect(Number(relistItem.yakkaPrice)).toBeCloseTo(220.0);
  });
});

// ── syncDrugMaster: 大量データ処理 ──────────────────

describe('syncDrugMaster - 大量バッチ処理', () => {
  it('500件超のレコードを正しく処理する', async () => {
    const syncLogId = await createSyncLogForTest();
    const rows: ParsedDrugRow[] = [];
    for (let i = 0; i < 600; i++) {
      rows.push(makeParsedDrugRow({
        yjCode: String(i).padStart(10, '0'),
        drugName: `バッチ薬品${i}`,
        yakkaPrice: 100 + i,
      }));
    }

    const result = await syncDrugMaster(rows, syncLogId, '2024-04-01');

    expect(result.itemsProcessed).toBe(600);
    expect(result.itemsAdded).toBe(600);

    const allItems = await testDb.select().from(schema.drugMaster);
    expect(allItems).toHaveLength(600);
  }, 60_000);
});

// ── syncDrugMaster: SyncLog更新 ─────────────────────

describe('syncDrugMaster - SyncLog更新', () => {
  it('同期完了後にsyncLogが更新される', async () => {
    const syncLogId = await createSyncLogForTest();
    const rows = [
      makeParsedDrugRow({ yjCode: '7000000000', drugName: '薬品1' }),
      makeParsedDrugRow({ yjCode: '7100000000', drugName: '薬品2' }),
    ];

    await syncDrugMaster(rows, syncLogId, '2024-04-01');

    // syncLog が更新されている
    const [log] = await testDb.select().from(schema.drugMasterSyncLogs)
      .where(eq(schema.drugMasterSyncLogs.id, syncLogId));
    expect(log.itemsProcessed).toBe(2);
    expect(log.itemsAdded).toBe(2);
  });
});

// ── syncDrugMaster: 重複YJコード ────────────────────

describe('syncDrugMaster - バリデーション', () => {
  it('重複YJコードがある場合はエラーになる', async () => {
    const syncLogId = await createSyncLogForTest();
    const rows = [
      makeParsedDrugRow({ yjCode: '8000000000', drugName: '薬品A' }),
      makeParsedDrugRow({ yjCode: '8000000000', drugName: '薬品B' }),
    ];

    await expect(syncDrugMaster(rows, syncLogId, '2024-04-01'))
      .rejects.toThrow('YJコードが重複');
  });
});

// ── completeSyncLog ─────────────────────────────────

describe('completeSyncLog', () => {
  it('同期ログを完了ステータスに更新する', async () => {
    const log = await createSyncLog('manual', 'テスト', null);

    await completeSyncLog(log.id, 'success', {
      itemsProcessed: 10,
      itemsAdded: 5,
      itemsUpdated: 3,
      itemsDeleted: 2,
    });

    const [updated] = await testDb.select().from(schema.drugMasterSyncLogs)
      .where(eq(schema.drugMasterSyncLogs.id, log.id));
    expect(updated.status).toBe('success');
    expect(updated.itemsProcessed).toBe(10);
    expect(updated.completedAt).toBeTruthy();
  });

  it('エラーメッセージ付きでfailedステータスに更新できる', async () => {
    const log = await createSyncLog('auto', 'テスト自動同期', null);

    await completeSyncLog(log.id, 'failed', {
      itemsProcessed: 0,
      itemsAdded: 0,
      itemsUpdated: 0,
      itemsDeleted: 0,
    }, 'テストエラー');

    const [updated] = await testDb.select().from(schema.drugMasterSyncLogs)
      .where(eq(schema.drugMasterSyncLogs.id, log.id));
    expect(updated.status).toBe('failed');
    expect(updated.errorMessage).toBe('テストエラー');
  });
});
