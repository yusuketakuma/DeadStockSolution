import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../config/database';
import { exchangeProposals, exchangeProposalItems, exchangeHistory, deadStockItems, pharmacies } from '../db/schema';

const MIN_EXCHANGE_VALUE = 10000;
const VALUE_TOLERANCE = 10;

interface ProposalItemInput {
  deadStockItemId: number;
  quantity: number;
}

interface ValidatedProposalItem extends ProposalItemInput {
  fromPharmacyId: number;
  toPharmacyId: number;
  yakkaValue: number;
}

interface ParsedCandidate {
  pharmacyBId: number;
  itemsFromA: ProposalItemInput[];
  itemsFromB: ProposalItemInput[];
}

function roundTo2(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseProposalItems(items: unknown, fieldName: string): ProposalItemInput[] {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(`${fieldName} が不正です`);
  }

  const normalized = items.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`${fieldName} に不正な要素が含まれています`);
    }

    const id = Number((item as Record<string, unknown>).deadStockItemId);
    const quantityRaw = Number((item as Record<string, unknown>).quantity);
    const quantity = Math.round(quantityRaw * 1000) / 1000;

    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(`${fieldName} に不正な在庫IDが含まれています`);
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`${fieldName} に不正な数量が含まれています`);
    }

    return { deadStockItemId: id, quantity };
  });

  const idSet = new Set<number>();
  for (const item of normalized) {
    if (idSet.has(item.deadStockItemId)) {
      throw new Error(`${fieldName} に重複した在庫IDが含まれています`);
    }
    idSet.add(item.deadStockItemId);
  }

  return normalized;
}

function parseCandidate(pharmacyAId: number, rawCandidate: unknown): ParsedCandidate {
  if (!rawCandidate || typeof rawCandidate !== 'object') {
    throw new Error('候補データが不正です');
  }

  const candidate = rawCandidate as Record<string, unknown>;
  const pharmacyBId = Number(candidate.pharmacyId);

  if (!Number.isInteger(pharmacyBId) || pharmacyBId <= 0 || pharmacyBId === pharmacyAId) {
    throw new Error('交換先薬局IDが不正です');
  }

  return {
    pharmacyBId,
    itemsFromA: parseProposalItems(candidate.itemsFromA, 'itemsFromA'),
    itemsFromB: parseProposalItems(candidate.itemsFromB, 'itemsFromB'),
  };
}

export async function createProposal(
  pharmacyAId: number,
  rawCandidate: unknown
): Promise<number> {
  const candidate = parseCandidate(pharmacyAId, rawCandidate);

  const [pharmacyB] = await db.select({ id: pharmacies.id, isActive: pharmacies.isActive })
    .from(pharmacies)
    .where(eq(pharmacies.id, candidate.pharmacyBId))
    .limit(1);

  if (!pharmacyB || !pharmacyB.isActive) {
    throw new Error('交換先薬局が見つからないか、無効です');
  }

  const allIds = [...candidate.itemsFromA, ...candidate.itemsFromB].map((item) => item.deadStockItemId);
  const stockRows = await db.select({
    id: deadStockItems.id,
    pharmacyId: deadStockItems.pharmacyId,
    quantity: deadStockItems.quantity,
    yakkaUnitPrice: deadStockItems.yakkaUnitPrice,
    isAvailable: deadStockItems.isAvailable,
  })
    .from(deadStockItems)
    .where(inArray(deadStockItems.id, allIds));

  const stockMap = new Map<number, (typeof stockRows)[number]>();
  for (const row of stockRows) {
    stockMap.set(row.id, row);
  }

  const validatedA: ValidatedProposalItem[] = candidate.itemsFromA.map((item) => {
    const stock = stockMap.get(item.deadStockItemId);
    if (!stock) throw new Error('提案対象の在庫が見つかりません');
    if (stock.pharmacyId !== pharmacyAId) throw new Error('自薬局の在庫のみ提案できます');
    if (!stock.isAvailable) throw new Error('提案対象の在庫が既に利用不可です');
    if (item.quantity > stock.quantity) throw new Error('提案数量が在庫数を超えています');
    if (!stock.yakkaUnitPrice || stock.yakkaUnitPrice <= 0) throw new Error('薬価が設定されていない在庫は提案できません');

    return {
      deadStockItemId: item.deadStockItemId,
      fromPharmacyId: pharmacyAId,
      toPharmacyId: candidate.pharmacyBId,
      quantity: item.quantity,
      yakkaValue: roundTo2(stock.yakkaUnitPrice * item.quantity),
    };
  });

  const validatedB: ValidatedProposalItem[] = candidate.itemsFromB.map((item) => {
    const stock = stockMap.get(item.deadStockItemId);
    if (!stock) throw new Error('提案対象の在庫が見つかりません');
    if (stock.pharmacyId !== candidate.pharmacyBId) throw new Error('交換先薬局の在庫のみ指定できます');
    if (!stock.isAvailable) throw new Error('提案対象の在庫が既に利用不可です');
    if (item.quantity > stock.quantity) throw new Error('提案数量が在庫数を超えています');
    if (!stock.yakkaUnitPrice || stock.yakkaUnitPrice <= 0) throw new Error('薬価が設定されていない在庫は提案できません');

    return {
      deadStockItemId: item.deadStockItemId,
      fromPharmacyId: candidate.pharmacyBId,
      toPharmacyId: pharmacyAId,
      quantity: item.quantity,
      yakkaValue: roundTo2(stock.yakkaUnitPrice * item.quantity),
    };
  });

  const totalValueA = roundTo2(validatedA.reduce((sum, item) => sum + item.yakkaValue, 0));
  const totalValueB = roundTo2(validatedB.reduce((sum, item) => sum + item.yakkaValue, 0));
  const valueDifference = roundTo2(Math.abs(totalValueA - totalValueB));

  if (Math.min(totalValueA, totalValueB) < MIN_EXCHANGE_VALUE) {
    throw new Error('交換金額が最低金額に達していません');
  }
  if (valueDifference > VALUE_TOLERANCE) {
    throw new Error('交換金額差が許容範囲を超えています');
  }

  return db.transaction(async (tx) => {
    const [proposal] = await tx.insert(exchangeProposals).values({
      pharmacyAId,
      pharmacyBId: candidate.pharmacyBId,
      status: 'proposed',
      totalValueA,
      totalValueB,
      valueDifference,
    }).returning({ id: exchangeProposals.id });

    await tx.insert(exchangeProposalItems).values(
      [...validatedA, ...validatedB].map((item) => ({
        proposalId: proposal.id,
        deadStockItemId: item.deadStockItemId,
        fromPharmacyId: item.fromPharmacyId,
        toPharmacyId: item.toPharmacyId,
        quantity: item.quantity,
        yakkaValue: item.yakkaValue,
      }))
    );

    return proposal.id;
  });
}

export async function acceptProposal(proposalId: number, pharmacyId: number): Promise<string> {
  const [proposal] = await db.select()
    .from(exchangeProposals)
    .where(eq(exchangeProposals.id, proposalId))
    .limit(1);

  if (!proposal) throw new Error('マッチングが見つかりません');

  const isA = proposal.pharmacyAId === pharmacyId;
  const isB = proposal.pharmacyBId === pharmacyId;
  if (!isA && !isB) throw new Error('このマッチングにアクセスする権限がありません');

  let newStatus: string;

  if (proposal.status === 'proposed') {
    newStatus = isA ? 'accepted_a' : 'accepted_b';
  } else if (proposal.status === 'accepted_a' && isB) {
    newStatus = 'confirmed';
  } else if (proposal.status === 'accepted_b' && isA) {
    newStatus = 'confirmed';
  } else {
    throw new Error('この仮マッチングは現在承認できる状態ではありません');
  }

  await db.update(exchangeProposals)
    .set({ status: newStatus as typeof proposal.status })
    .where(eq(exchangeProposals.id, proposalId));

  return newStatus;
}

export async function rejectProposal(proposalId: number, pharmacyId: number): Promise<void> {
  const [proposal] = await db.select()
    .from(exchangeProposals)
    .where(eq(exchangeProposals.id, proposalId))
    .limit(1);

  if (!proposal) throw new Error('マッチングが見つかりません');

  const isParty = proposal.pharmacyAId === pharmacyId || proposal.pharmacyBId === pharmacyId;
  if (!isParty) throw new Error('このマッチングにアクセスする権限がありません');

  await db.update(exchangeProposals)
    .set({ status: 'rejected' })
    .where(eq(exchangeProposals.id, proposalId));
}

export async function completeProposal(proposalId: number, pharmacyId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [proposal] = await tx.select()
      .from(exchangeProposals)
      .where(eq(exchangeProposals.id, proposalId))
      .limit(1);

    if (!proposal) throw new Error('マッチングが見つかりません');
    if (proposal.status !== 'confirmed') throw new Error('このマッチングはまだ確定されていません');

    const isParty = proposal.pharmacyAId === pharmacyId || proposal.pharmacyBId === pharmacyId;
    if (!isParty) throw new Error('このマッチングにアクセスする権限がありません');

    const items = await tx.select({
      deadStockItemId: exchangeProposalItems.deadStockItemId,
      fromPharmacyId: exchangeProposalItems.fromPharmacyId,
    })
      .from(exchangeProposalItems)
      .where(eq(exchangeProposalItems.proposalId, proposalId));

    if (items.length === 0) {
      throw new Error('提案アイテムが存在しません');
    }

    for (const item of items) {
      const updated = await tx.update(deadStockItems)
        .set({ isAvailable: false })
        .where(and(
          eq(deadStockItems.id, item.deadStockItemId),
          eq(deadStockItems.pharmacyId, item.fromPharmacyId),
          eq(deadStockItems.isAvailable, true),
        ))
        .returning({ id: deadStockItems.id });

      if (updated.length === 0) {
        throw new Error('在庫状態が変更されているため、交換を完了できません');
      }
    }

    const completedAt = new Date().toISOString();
    await tx.update(exchangeProposals)
      .set({ status: 'completed', completedAt })
      .where(eq(exchangeProposals.id, proposalId));

    const totalValue = (proposal.totalValueA ?? 0) + (proposal.totalValueB ?? 0);
    await tx.insert(exchangeHistory).values({
      proposalId,
      pharmacyAId: proposal.pharmacyAId,
      pharmacyBId: proposal.pharmacyBId,
      totalValue,
      completedAt,
    });
  });
}
