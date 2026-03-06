import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { getTestDb, resetTestDb, closeTestDb, type TestDb } from './helpers/test-db';
import { makePharmacy, resetFactorySeq } from './helpers/factories';
import * as schema from '../../db/schema';
import type { MatchCandidate, MatchItem } from '../../types';

// Mock the db module to use our test db
let testDb: TestDb;
let saveMatchSnapshotAndNotifyOnChange: (typeof import('../../services/matching-snapshot-service'))['saveMatchSnapshotAndNotifyOnChange'];
let saveMatchSnapshotsBatch: (typeof import('../../services/matching-snapshot-service'))['saveMatchSnapshotsBatch'];
let createSnapshotPayload: (typeof import('../../services/matching-snapshot-service'))['createSnapshotPayload'];
let calculateSnapshotDiff: (typeof import('../../services/matching-snapshot-service'))['calculateSnapshotDiff'];
let buildTopCandidateDigest: (typeof import('../../services/matching-snapshot-service'))['buildTopCandidateDigest'];
let createCandidateHash: (typeof import('../../services/matching-snapshot-service'))['createCandidateHash'];
let buildSnapshotHashInput: (typeof import('../../services/matching-snapshot-service'))['buildSnapshotHashInput'];
vi.mock('../../config/database', () => ({
  get db() { return testDb; },
}));

// Mock logger
vi.mock('../../services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

beforeAll(async () => {
  testDb = await getTestDb();
  ({
    saveMatchSnapshotAndNotifyOnChange,
    saveMatchSnapshotsBatch,
    createSnapshotPayload,
    calculateSnapshotDiff,
    buildTopCandidateDigest,
    createCandidateHash,
    buildSnapshotHashInput,
  } = await import('../../services/matching-snapshot-service'));
}, 30_000);

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  resetFactorySeq();
});

// ── ヘルパー ──────────────────────────────────────────

function makeMatchItem(overrides: Partial<MatchItem> = {}): MatchItem {
  return {
    deadStockItemId: 1,
    drugName: 'テスト薬品',
    quantity: 10,
    unit: '錠',
    yakkaUnitPrice: 100,
    yakkaValue: 1000,
    ...overrides,
  };
}

function makeMatchCandidate(pharmacyId: number, overrides: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    pharmacyId,
    pharmacyName: `テスト薬局${pharmacyId}`,
    distance: 5.0,
    itemsFromA: [makeMatchItem({ deadStockItemId: 1 })],
    itemsFromB: [makeMatchItem({ deadStockItemId: 2 })],
    totalValueA: 10000,
    totalValueB: 10000,
    valueDifference: 0,
    score: 80,
    matchRate: 0.5,
    ...overrides,
  };
}

// ── saveMatchSnapshotAndNotifyOnChange ────────────────

describe('saveMatchSnapshotAndNotifyOnChange', () => {
  it('初回保存: スナップショットが新規作成される', async () => {
    const pharmacy = await makePharmacy(testDb);
    const triggerPharmacy = await makePharmacy(testDb);
    const candidates = [makeMatchCandidate(triggerPharmacy.id)];

    const result = await saveMatchSnapshotAndNotifyOnChange({
      pharmacyId: pharmacy.id,
      triggerPharmacyId: triggerPharmacy.id,
      triggerUploadType: 'dead_stock',
      candidates,
      notifyEnabled: true,
    });

    expect(result.changed).toBe(true);
    expect(result.beforeCount).toBe(0);
    expect(result.afterCount).toBe(1);

    // DBにスナップショットが保存されている
    const snapshots = await testDb.select().from(schema.matchCandidateSnapshots)
      .where(eq(schema.matchCandidateSnapshots.pharmacyId, pharmacy.id));
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].candidateCount).toBe(1);
  });

  it('同じ候補で再保存すると変更なし判定になる', async () => {
    const pharmacy = await makePharmacy(testDb);
    const triggerPharmacy = await makePharmacy(testDb);
    const candidates = [makeMatchCandidate(triggerPharmacy.id)];

    // 1回目の保存
    await saveMatchSnapshotAndNotifyOnChange({
      pharmacyId: pharmacy.id,
      triggerPharmacyId: triggerPharmacy.id,
      triggerUploadType: 'dead_stock',
      candidates,
      notifyEnabled: true,
    });

    // 2回目の保存（同じ候補）
    const result2 = await saveMatchSnapshotAndNotifyOnChange({
      pharmacyId: pharmacy.id,
      triggerPharmacyId: triggerPharmacy.id,
      triggerUploadType: 'dead_stock',
      candidates,
      notifyEnabled: true,
    });

    expect(result2.changed).toBe(false);
    expect(result2.beforeCount).toBe(1);
    expect(result2.afterCount).toBe(1);
  });

  it('候補が変更された場合は変更あり判定になる', async () => {
    const pharmacy = await makePharmacy(testDb);
    const triggerPharmacy = await makePharmacy(testDb);
    const triggerPharmacy2 = await makePharmacy(testDb);

    // 1回目: 1候補
    await saveMatchSnapshotAndNotifyOnChange({
      pharmacyId: pharmacy.id,
      triggerPharmacyId: triggerPharmacy.id,
      triggerUploadType: 'dead_stock',
      candidates: [makeMatchCandidate(triggerPharmacy.id)],
      notifyEnabled: true,
    });

    // 2回目: 2候補
    const result2 = await saveMatchSnapshotAndNotifyOnChange({
      pharmacyId: pharmacy.id,
      triggerPharmacyId: triggerPharmacy.id,
      triggerUploadType: 'dead_stock',
      candidates: [
        makeMatchCandidate(triggerPharmacy.id),
        makeMatchCandidate(triggerPharmacy2.id, {
          itemsFromA: [makeMatchItem({ deadStockItemId: 3 })],
          itemsFromB: [makeMatchItem({ deadStockItemId: 4 })],
        }),
      ],
      notifyEnabled: true,
    });

    expect(result2.changed).toBe(true);
    expect(result2.beforeCount).toBe(1);
    expect(result2.afterCount).toBe(2);
  });

  it('変更があり通知有効の場合にmatch_notificationsが作成される', async () => {
    const pharmacy = await makePharmacy(testDb);
    const triggerPharmacy = await makePharmacy(testDb);

    await saveMatchSnapshotAndNotifyOnChange({
      pharmacyId: pharmacy.id,
      triggerPharmacyId: triggerPharmacy.id,
      triggerUploadType: 'dead_stock',
      candidates: [makeMatchCandidate(triggerPharmacy.id)],
      notifyEnabled: true,
    });

    const notifications = await testDb.select().from(schema.matchNotifications)
      .where(eq(schema.matchNotifications.pharmacyId, pharmacy.id));
    expect(notifications).toHaveLength(1);
    expect(notifications[0].triggerPharmacyId).toBe(triggerPharmacy.id);
    expect(notifications[0].isRead).toBe(false);
  });

  it('通知無効の場合はmatch_notificationsが作成されない', async () => {
    const pharmacy = await makePharmacy(testDb);
    const triggerPharmacy = await makePharmacy(testDb);

    await saveMatchSnapshotAndNotifyOnChange({
      pharmacyId: pharmacy.id,
      triggerPharmacyId: triggerPharmacy.id,
      triggerUploadType: 'dead_stock',
      candidates: [makeMatchCandidate(triggerPharmacy.id)],
      notifyEnabled: false,
    });

    const notifications = await testDb.select().from(schema.matchNotifications)
      .where(eq(schema.matchNotifications.pharmacyId, pharmacy.id));
    expect(notifications).toHaveLength(0);
  });

  it('notifyEnabled未指定の場合はpharmacy設定を参照する', async () => {
    const pharmacy = await makePharmacy(testDb, { matchingAutoNotifyEnabled: false });
    const triggerPharmacy = await makePharmacy(testDb);

    await saveMatchSnapshotAndNotifyOnChange({
      pharmacyId: pharmacy.id,
      triggerPharmacyId: triggerPharmacy.id,
      triggerUploadType: 'dead_stock',
      candidates: [makeMatchCandidate(triggerPharmacy.id)],
      // notifyEnabled未指定
    });

    const notifications = await testDb.select().from(schema.matchNotifications)
      .where(eq(schema.matchNotifications.pharmacyId, pharmacy.id));
    expect(notifications).toHaveLength(0);
  });

  it('同一dedupeKeyの通知は重複しない', async () => {
    const pharmacy = await makePharmacy(testDb);
    const triggerPharmacy = await makePharmacy(testDb);
    const candidates = [makeMatchCandidate(triggerPharmacy.id)];

    // 初回保存（通知作成）
    await saveMatchSnapshotAndNotifyOnChange({
      pharmacyId: pharmacy.id,
      triggerPharmacyId: triggerPharmacy.id,
      triggerUploadType: 'dead_stock',
      candidates,
      notifyEnabled: true,
    });

    // スナップショットを一旦削除して再作成をトリガーさせる
    await testDb.delete(schema.matchCandidateSnapshots)
      .where(eq(schema.matchCandidateSnapshots.pharmacyId, pharmacy.id));

    // 同じ条件で再保存
    await saveMatchSnapshotAndNotifyOnChange({
      pharmacyId: pharmacy.id,
      triggerPharmacyId: triggerPharmacy.id,
      triggerUploadType: 'dead_stock',
      candidates,
      notifyEnabled: true,
    });

    const notifications = await testDb.select().from(schema.matchNotifications)
      .where(eq(schema.matchNotifications.pharmacyId, pharmacy.id));
    // dedupeキーが同一なので重複しない
    expect(notifications).toHaveLength(1);
  });
});

// ── saveMatchSnapshotsBatch ──────────────────────────

describe('saveMatchSnapshotsBatch', () => {
  it('複数薬局のスナップショットを一括保存する', async () => {
    const pharmacy1 = await makePharmacy(testDb);
    const pharmacy2 = await makePharmacy(testDb);
    const triggerPharmacy = await makePharmacy(testDb);

    const result = await saveMatchSnapshotsBatch([
      {
        pharmacyId: pharmacy1.id,
        triggerPharmacyId: triggerPharmacy.id,
        triggerUploadType: 'dead_stock',
        candidates: [makeMatchCandidate(triggerPharmacy.id)],
        notifyEnabled: true,
      },
      {
        pharmacyId: pharmacy2.id,
        triggerPharmacyId: triggerPharmacy.id,
        triggerUploadType: 'dead_stock',
        candidates: [makeMatchCandidate(triggerPharmacy.id)],
        notifyEnabled: true,
      },
    ]);

    expect(result.changedCount).toBe(2);

    const snapshots = await testDb.select().from(schema.matchCandidateSnapshots);
    expect(snapshots).toHaveLength(2);

    const notifications = await testDb.select().from(schema.matchNotifications);
    expect(notifications).toHaveLength(2);
  });

  it('空のエントリではchangedCount=0を返す', async () => {
    const result = await saveMatchSnapshotsBatch([]);
    expect(result.changedCount).toBe(0);
  });

  it('変更がないエントリはスキップされる', async () => {
    const pharmacy = await makePharmacy(testDb);
    const triggerPharmacy = await makePharmacy(testDb);
    const candidates = [makeMatchCandidate(triggerPharmacy.id)];

    // 初回バッチ保存
    await saveMatchSnapshotsBatch([{
      pharmacyId: pharmacy.id,
      triggerPharmacyId: triggerPharmacy.id,
      triggerUploadType: 'dead_stock',
      candidates,
      notifyEnabled: true,
    }]);

    // 同じ候補で再バッチ保存
    const result2 = await saveMatchSnapshotsBatch([{
      pharmacyId: pharmacy.id,
      triggerPharmacyId: triggerPharmacy.id,
      triggerUploadType: 'dead_stock',
      candidates,
      notifyEnabled: true,
    }]);

    expect(result2.changedCount).toBe(0);
  });
});

// ── Pure functions ───────────────────────────────────

describe('createSnapshotPayload', () => {
  it('候補リストからハッシュ・件数・ダイジェストを算出する', () => {
    const candidates = [
      makeMatchCandidate(10),
      makeMatchCandidate(20, { score: 90, matchRate: 0.8 }),
    ];

    const payload = createSnapshotPayload(candidates);

    expect(payload.candidateCount).toBe(2);
    expect(payload.hash).toBeTruthy();
    expect(payload.topCandidates).toHaveLength(2);
    expect(payload.topCandidates[0].pharmacyId).toBe(10);
  });
});

describe('calculateSnapshotDiff', () => {
  it('追加・削除された薬局を正しく検出する', () => {
    const before = [
      { pharmacyId: 1, score: 80, matchRate: 0.5, valueDifference: 0, totalValueA: 10000, totalValueB: 10000, itemCountA: 1, itemCountB: 1, mutualStagnantItems: 0, mutualNearExpiryItems: 0, estimatedWasteAvoidanceYen: 0, estimatedWorkingCapitalReleaseYen: 0 },
      { pharmacyId: 2, score: 70, matchRate: 0.4, valueDifference: 0, totalValueA: 10000, totalValueB: 10000, itemCountA: 1, itemCountB: 1, mutualStagnantItems: 0, mutualNearExpiryItems: 0, estimatedWasteAvoidanceYen: 0, estimatedWorkingCapitalReleaseYen: 0 },
    ];
    const after = [
      { pharmacyId: 2, score: 75, matchRate: 0.4, valueDifference: 0, totalValueA: 10000, totalValueB: 10000, itemCountA: 1, itemCountB: 1, mutualStagnantItems: 0, mutualNearExpiryItems: 0, estimatedWasteAvoidanceYen: 0, estimatedWorkingCapitalReleaseYen: 0 },
      { pharmacyId: 3, score: 60, matchRate: 0.3, valueDifference: 0, totalValueA: 10000, totalValueB: 10000, itemCountA: 1, itemCountB: 1, mutualStagnantItems: 0, mutualNearExpiryItems: 0, estimatedWasteAvoidanceYen: 0, estimatedWorkingCapitalReleaseYen: 0 },
    ];

    const diff = calculateSnapshotDiff(before, after, 2, 2);

    expect(diff.addedPharmacyIds).toEqual([3]);
    expect(diff.removedPharmacyIds).toEqual([1]);
    expect(diff.beforeCount).toBe(2);
    expect(diff.afterCount).toBe(2);
  });
});
