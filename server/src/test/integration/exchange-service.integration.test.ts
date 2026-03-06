import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { getTestDb, resetTestDb, closeTestDb, type TestDb } from './helpers/test-db';
import { makePharmacy, makeUpload, makeDeadStockItem, resetFactorySeq } from './helpers/factories';
import * as schema from '../../db/schema';

// Mock the db module to use our test db
let testDb: TestDb;
let createProposal: (typeof import('../../services/exchange-service'))['createProposal'];
let acceptProposal: (typeof import('../../services/exchange-service'))['acceptProposal'];
let rejectProposal: (typeof import('../../services/exchange-service'))['rejectProposal'];
let completeProposal: (typeof import('../../services/exchange-service'))['completeProposal'];
vi.mock('../../config/database', () => ({
  get db() { return testDb; },
}));

// Mock notification-service to avoid side effects
vi.mock('../../services/notification-service', () => ({
  createNotification: vi.fn().mockResolvedValue({ id: 1 }),
}));

// Mock logger
vi.mock('../../services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

beforeAll(async () => {
  testDb = await getTestDb();
  ({ createProposal, acceptProposal, rejectProposal, completeProposal } =
    await import('../../services/exchange-service'));
}, 30_000);

afterAll(async () => {
  await closeTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  resetFactorySeq();
});

// ── ヘルパー ──────────────────────────────────────────

/** 薬局A, B を作成し、それぞれにデッドストックを投入する */
async function setupTwoPharmaciesWithStock(opts?: {
  priceA?: string;
  priceB?: string;
  quantityA?: number;
  quantityB?: number;
}) {
  const pharmacyA = await makePharmacy(testDb, { name: '薬局A' });
  const pharmacyB = await makePharmacy(testDb, { name: '薬局B' });
  const uploadA = await makeUpload(testDb, pharmacyA.id);
  const uploadB = await makeUpload(testDb, pharmacyB.id);

  const itemA = await makeDeadStockItem(testDb, pharmacyA.id, uploadA.id, {
    drugName: 'テスト薬品A',
    quantity: opts?.quantityA ?? 100,
    yakkaUnitPrice: opts?.priceA ?? '200.00',
    isAvailable: true,
  });
  const itemB = await makeDeadStockItem(testDb, pharmacyB.id, uploadB.id, {
    drugName: 'テスト薬品B',
    quantity: opts?.quantityB ?? 100,
    yakkaUnitPrice: opts?.priceB ?? '200.00',
    isAvailable: true,
  });

  return { pharmacyA, pharmacyB, uploadA, uploadB, itemA, itemB };
}

function buildCandidate(pharmacyBId: number, itemsFromA: Array<{ deadStockItemId: number; quantity: number }>, itemsFromB: Array<{ deadStockItemId: number; quantity: number }>) {
  return {
    pharmacyId: pharmacyBId,
    itemsFromA,
    itemsFromB,
  };
}

// ── createProposal ─────────────────────────────────

describe('createProposal', () => {
  it('正常ケース: 提案を作成し、アイテムと予約を登録する', async () => {
    const { pharmacyA, pharmacyB, itemA, itemB } = await setupTwoPharmaciesWithStock({
      priceA: '200.00',
      priceB: '200.00',
      quantityA: 100,
      quantityB: 100,
    });

    const candidate = buildCandidate(pharmacyB.id, [{ deadStockItemId: itemA.id, quantity: 50 }], [{ deadStockItemId: itemB.id, quantity: 50 }]);
    const proposalId = await createProposal(pharmacyA.id, candidate);

    expect(proposalId).toBeGreaterThan(0);

    // 提案レコードの確認
    const [proposal] = await testDb.select().from(schema.exchangeProposals).where(eq(schema.exchangeProposals.id, proposalId));
    expect(proposal.status).toBe('proposed');
    expect(proposal.pharmacyAId).toBe(pharmacyA.id);
    expect(proposal.pharmacyBId).toBe(pharmacyB.id);

    // 提案アイテムの確認
    const items = await testDb.select().from(schema.exchangeProposalItems).where(eq(schema.exchangeProposalItems.proposalId, proposalId));
    expect(items).toHaveLength(2);

    // 予約レコードの確認
    const reservations = await testDb.select().from(schema.deadStockReservations).where(eq(schema.deadStockReservations.proposalId, proposalId));
    expect(reservations).toHaveLength(2);
  });

  it('交換先薬局が無効な場合はエラーになる', async () => {
    const { pharmacyA, pharmacyB, itemA, itemB } = await setupTwoPharmaciesWithStock();

    // 薬局Bを無効化
    await testDb.update(schema.pharmacies).set({ isActive: false }).where(eq(schema.pharmacies.id, pharmacyB.id));

    const candidate = buildCandidate(pharmacyB.id, [{ deadStockItemId: itemA.id, quantity: 50 }], [{ deadStockItemId: itemB.id, quantity: 50 }]);
    await expect(createProposal(pharmacyA.id, candidate)).rejects.toThrow('交換先薬局が見つからないか、無効です');
  });

  it('存在しない薬局IDの場合はエラーになる', async () => {
    const { pharmacyA, itemA } = await setupTwoPharmaciesWithStock();

    const candidate = buildCandidate(99999, [{ deadStockItemId: itemA.id, quantity: 50 }], [{ deadStockItemId: itemA.id, quantity: 50 }]);
    await expect(createProposal(pharmacyA.id, candidate)).rejects.toThrow();
  });

  it('数量が0以下の場合はエラーになる', async () => {
    const { pharmacyA, pharmacyB, itemA, itemB } = await setupTwoPharmaciesWithStock();

    const candidate = buildCandidate(pharmacyB.id, [{ deadStockItemId: itemA.id, quantity: 0 }], [{ deadStockItemId: itemB.id, quantity: 50 }]);
    await expect(createProposal(pharmacyA.id, candidate)).rejects.toThrow('不正な数量');
  });

  it('自薬局でない在庫をitemsFromAに指定するとエラーになる', async () => {
    const { pharmacyA, pharmacyB, itemB } = await setupTwoPharmaciesWithStock();

    // itemBは薬局Bの在庫なのに itemsFromA に指定
    const candidate = buildCandidate(pharmacyB.id, [{ deadStockItemId: itemB.id, quantity: 50 }], [{ deadStockItemId: itemB.id, quantity: 50 }]);
    await expect(createProposal(pharmacyA.id, candidate)).rejects.toThrow();
  });

  it('利用不可在庫を提案するとエラーになる', async () => {
    const { pharmacyA, pharmacyB, itemA, itemB } = await setupTwoPharmaciesWithStock();

    // itemAを利用不可にする
    await testDb.update(schema.deadStockItems).set({ isAvailable: false }).where(eq(schema.deadStockItems.id, itemA.id));

    const candidate = buildCandidate(pharmacyB.id, [{ deadStockItemId: itemA.id, quantity: 50 }], [{ deadStockItemId: itemB.id, quantity: 50 }]);
    await expect(createProposal(pharmacyA.id, candidate)).rejects.toThrow('利用不可');
  });

  it('在庫数量を超える数量を提案するとエラーになる', async () => {
    const { pharmacyA, pharmacyB, itemA, itemB } = await setupTwoPharmaciesWithStock({
      quantityA: 10,
      quantityB: 100,
      priceA: '200.00',
      priceB: '200.00',
    });

    const candidate = buildCandidate(pharmacyB.id, [{ deadStockItemId: itemA.id, quantity: 50 }], [{ deadStockItemId: itemB.id, quantity: 50 }]);
    await expect(createProposal(pharmacyA.id, candidate)).rejects.toThrow('利用可能在庫数を超えています');
  });

  it('交換金額が最低金額に達しない場合はエラーになる', async () => {
    const { pharmacyA, pharmacyB, itemA, itemB } = await setupTwoPharmaciesWithStock({
      priceA: '1.00',
      priceB: '1.00',
      quantityA: 100,
      quantityB: 100,
    });

    const candidate = buildCandidate(pharmacyB.id, [{ deadStockItemId: itemA.id, quantity: 5 }], [{ deadStockItemId: itemB.id, quantity: 5 }]);
    await expect(createProposal(pharmacyA.id, candidate)).rejects.toThrow('最低金額');
  });

  it('交換金額差が許容範囲を超える場合はエラーになる', async () => {
    const { pharmacyA, pharmacyB, itemA, itemB } = await setupTwoPharmaciesWithStock({
      priceA: '200.00',
      priceB: '250.00',
      quantityA: 100,
      quantityB: 100,
    });

    // A: 200 * 60 = 12000, B: 250 * 60 = 15000, diff = 3000 > 10
    const candidate = buildCandidate(pharmacyB.id, [{ deadStockItemId: itemA.id, quantity: 60 }], [{ deadStockItemId: itemB.id, quantity: 60 }]);
    await expect(createProposal(pharmacyA.id, candidate)).rejects.toThrow('許容範囲を超えています');
  });

  it('ブロック中の薬局に提案するとエラーになる', async () => {
    const { pharmacyA, pharmacyB, itemA, itemB } = await setupTwoPharmaciesWithStock();

    // A→Bのブロック関係を作成
    await testDb.insert(schema.pharmacyRelationships).values({
      pharmacyId: pharmacyA.id,
      targetPharmacyId: pharmacyB.id,
      relationshipType: 'blocked',
    });

    const candidate = buildCandidate(pharmacyB.id, [{ deadStockItemId: itemA.id, quantity: 50 }], [{ deadStockItemId: itemB.id, quantity: 50 }]);
    await expect(createProposal(pharmacyA.id, candidate)).rejects.toThrow('ブロック中');
  });

  it('薬価が未設定の在庫を提案するとエラーになる', async () => {
    const pharmacyA = await makePharmacy(testDb, { name: '薬局A' });
    const pharmacyB = await makePharmacy(testDb, { name: '薬局B' });
    const uploadA = await makeUpload(testDb, pharmacyA.id);
    const uploadB = await makeUpload(testDb, pharmacyB.id);

    const itemA = await makeDeadStockItem(testDb, pharmacyA.id, uploadA.id, {
      drugName: 'テスト薬品A',
      quantity: 100,
      yakkaUnitPrice: null,
      isAvailable: true,
    });
    const itemB = await makeDeadStockItem(testDb, pharmacyB.id, uploadB.id, {
      drugName: 'テスト薬品B',
      quantity: 100,
      yakkaUnitPrice: '200.00',
      isAvailable: true,
    });

    const candidate = buildCandidate(pharmacyB.id, [{ deadStockItemId: itemA.id, quantity: 50 }], [{ deadStockItemId: itemB.id, quantity: 50 }]);
    await expect(createProposal(pharmacyA.id, candidate)).rejects.toThrow('薬価が設定されていない');
  });
});

// ── acceptProposal ─────────────────────────────────

describe('acceptProposal', () => {
  it('pharmacyBが承認するとaccepted_bになる', async () => {
    const { pharmacyA, pharmacyB, itemA, itemB } = await setupTwoPharmaciesWithStock();

    const candidate = buildCandidate(pharmacyB.id, [{ deadStockItemId: itemA.id, quantity: 50 }], [{ deadStockItemId: itemB.id, quantity: 50 }]);
    const proposalId = await createProposal(pharmacyA.id, candidate);

    const newStatus = await acceptProposal(proposalId, pharmacyB.id);
    expect(newStatus).toBe('accepted_b');
  });

  it('双方承認でconfirmedになる', async () => {
    const { pharmacyA, pharmacyB, itemA, itemB } = await setupTwoPharmaciesWithStock();

    const candidate = buildCandidate(pharmacyB.id, [{ deadStockItemId: itemA.id, quantity: 50 }], [{ deadStockItemId: itemB.id, quantity: 50 }]);
    const proposalId = await createProposal(pharmacyA.id, candidate);

    // B が先に承認
    await acceptProposal(proposalId, pharmacyB.id);
    // A が承認 → confirmed
    const newStatus = await acceptProposal(proposalId, pharmacyA.id);
    expect(newStatus).toBe('confirmed');
  });

  it('権限のない薬局が承認しようとするとエラーになる', async () => {
    const { pharmacyA, pharmacyB, itemA, itemB } = await setupTwoPharmaciesWithStock();
    const pharmacyC = await makePharmacy(testDb, { name: '薬局C' });

    const candidate = buildCandidate(pharmacyB.id, [{ deadStockItemId: itemA.id, quantity: 50 }], [{ deadStockItemId: itemB.id, quantity: 50 }]);
    const proposalId = await createProposal(pharmacyA.id, candidate);

    await expect(acceptProposal(proposalId, pharmacyC.id)).rejects.toThrow('権限がありません');
  });
});

// ── rejectProposal ─────────────────────────────────

describe('rejectProposal', () => {
  it('提案を却下すると予約が削除される', async () => {
    const { pharmacyA, pharmacyB, itemA, itemB } = await setupTwoPharmaciesWithStock();

    const candidate = buildCandidate(pharmacyB.id, [{ deadStockItemId: itemA.id, quantity: 50 }], [{ deadStockItemId: itemB.id, quantity: 50 }]);
    const proposalId = await createProposal(pharmacyA.id, candidate);

    await rejectProposal(proposalId, pharmacyB.id);

    const [proposal] = await testDb.select().from(schema.exchangeProposals).where(eq(schema.exchangeProposals.id, proposalId));
    expect(proposal.status).toBe('rejected');

    const reservations = await testDb.select().from(schema.deadStockReservations).where(eq(schema.deadStockReservations.proposalId, proposalId));
    expect(reservations).toHaveLength(0);
  });
});

// ── completeProposal ───────────────────────────────

describe('completeProposal', () => {
  it('confirmed状態の提案を完了すると在庫が減少し履歴が作成される', async () => {
    const { pharmacyA, pharmacyB, itemA, itemB } = await setupTwoPharmaciesWithStock({
      priceA: '200.00',
      priceB: '200.00',
      quantityA: 100,
      quantityB: 100,
    });

    const candidate = buildCandidate(pharmacyB.id, [{ deadStockItemId: itemA.id, quantity: 50 }], [{ deadStockItemId: itemB.id, quantity: 50 }]);
    const proposalId = await createProposal(pharmacyA.id, candidate);

    // 双方承認 → confirmed
    await acceptProposal(proposalId, pharmacyB.id);
    await acceptProposal(proposalId, pharmacyA.id);

    await completeProposal(proposalId, pharmacyA.id);

    // ステータス確認
    const [proposal] = await testDb.select().from(schema.exchangeProposals).where(eq(schema.exchangeProposals.id, proposalId));
    expect(proposal.status).toBe('completed');

    // 在庫減少の確認
    const [updatedItemA] = await testDb.select().from(schema.deadStockItems).where(eq(schema.deadStockItems.id, itemA.id));
    expect(updatedItemA.quantity).toBe(50);

    const [updatedItemB] = await testDb.select().from(schema.deadStockItems).where(eq(schema.deadStockItems.id, itemB.id));
    expect(updatedItemB.quantity).toBe(50);

    // 履歴の確認
    const history = await testDb.select().from(schema.exchangeHistory).where(eq(schema.exchangeHistory.proposalId, proposalId));
    expect(history).toHaveLength(1);
    expect(history[0].pharmacyAId).toBe(pharmacyA.id);
    expect(history[0].pharmacyBId).toBe(pharmacyB.id);

    // 予約が削除されていること
    const reservations = await testDb.select().from(schema.deadStockReservations).where(eq(schema.deadStockReservations.proposalId, proposalId));
    expect(reservations).toHaveLength(0);
  });

  it('confirmed以外のステータスで完了しようとするとエラーになる', async () => {
    const { pharmacyA, pharmacyB, itemA, itemB } = await setupTwoPharmaciesWithStock();

    const candidate = buildCandidate(pharmacyB.id, [{ deadStockItemId: itemA.id, quantity: 50 }], [{ deadStockItemId: itemB.id, quantity: 50 }]);
    const proposalId = await createProposal(pharmacyA.id, candidate);

    // proposedのまま完了しようとする
    await expect(completeProposal(proposalId, pharmacyA.id)).rejects.toThrow('まだ確定されていません');
  });

  it('在庫全量交換はDB制約(quantity>0)によりエラーになる', async () => {
    // dead_stock_items テーブルには chk_dead_stock_quantity (quantity > 0) 制約がある。
    // 全量交換で quantity=0 にしようとすると制約違反でロールバックする。
    const { pharmacyA, pharmacyB, itemA, itemB } = await setupTwoPharmaciesWithStock({
      priceA: '200.00',
      priceB: '200.00',
      quantityA: 50,
      quantityB: 50,
    });

    const candidate = buildCandidate(pharmacyB.id, [{ deadStockItemId: itemA.id, quantity: 50 }], [{ deadStockItemId: itemB.id, quantity: 50 }]);
    const proposalId = await createProposal(pharmacyA.id, candidate);

    await acceptProposal(proposalId, pharmacyB.id);
    await acceptProposal(proposalId, pharmacyA.id);

    // 全量交換は CHECK 制約違反になる
    await expect(completeProposal(proposalId, pharmacyA.id)).rejects.toThrow();

    // トランザクションがロールバックされ、ステータスはconfirmedのまま
    const [proposal] = await testDb.select().from(schema.exchangeProposals).where(eq(schema.exchangeProposals.id, proposalId));
    expect(proposal.status).toBe('confirmed');
  });
});
