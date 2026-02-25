import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
  exchangeProposals,
  exchangeProposalItems,
  exchangeHistory,
  deadStockItems,
  pharmacies,
  deadStockReservations,
} from '../db/schema';

const MIN_EXCHANGE_VALUE = 10000;
const VALUE_TOLERANCE = 10;
const RESERVATION_ACTIVE_STATUSES = ['proposed', 'accepted_a', 'accepted_b', 'confirmed'] as const;

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

// Valid state transitions for exchange proposals
const VALID_TRANSITIONS: Record<string, string[]> = {
  proposed: ['accepted_a', 'accepted_b', 'rejected'],
  accepted_a: ['confirmed', 'rejected'],
  accepted_b: ['confirmed', 'rejected'],
  confirmed: ['completed'],
};

export async function createProposal(
  pharmacyAId: number,
  rawCandidate: unknown
): Promise<number> {
  const candidate = parseCandidate(pharmacyAId, rawCandidate);

  return db.transaction(async (tx) => {
    const [pharmacyB] = await tx.select({ id: pharmacies.id, isActive: pharmacies.isActive })
      .from(pharmacies)
      .where(eq(pharmacies.id, candidate.pharmacyBId))
      .limit(1);

    if (!pharmacyB || !pharmacyB.isActive) {
      throw new Error('交換先薬局が見つからないか、無効です');
    }

    const allIds = [...candidate.itemsFromA, ...candidate.itemsFromB].map((item) => item.deadStockItemId);
    const sortedUniqueIds = [...new Set(allIds)].sort((a, b) => a - b);

    if (sortedUniqueIds.length === 0) {
      throw new Error('提案対象の在庫がありません');
    }

    await tx.execute(sql`
      SELECT ${deadStockItems.id}
      FROM ${deadStockItems}
      WHERE ${inArray(deadStockItems.id, sortedUniqueIds)}
      FOR UPDATE
    `);

    const stockRows = await tx.select({
      id: deadStockItems.id,
      pharmacyId: deadStockItems.pharmacyId,
      quantity: deadStockItems.quantity,
      yakkaUnitPrice: deadStockItems.yakkaUnitPrice,
      isAvailable: deadStockItems.isAvailable,
    })
      .from(deadStockItems)
      .where(inArray(deadStockItems.id, sortedUniqueIds));

    const stockMap = new Map<number, (typeof stockRows)[number]>();
    for (const row of stockRows) {
      stockMap.set(row.id, row);
    }

    const reservationRows = sortedUniqueIds.length > 0
      ? await tx.select({
        deadStockItemId: deadStockReservations.deadStockItemId,
        reservedQty: sql<number>`coalesce(sum(${deadStockReservations.reservedQuantity}), 0)`,
      })
        .from(deadStockReservations)
        .innerJoin(exchangeProposals, eq(deadStockReservations.proposalId, exchangeProposals.id))
        .where(and(
          inArray(deadStockReservations.deadStockItemId, sortedUniqueIds),
          inArray(exchangeProposals.status, RESERVATION_ACTIVE_STATUSES),
        ))
        .groupBy(deadStockReservations.deadStockItemId)
      : [];
    const reservedByStockId = new Map<number, number>();
    for (const row of reservationRows) {
      reservedByStockId.set(row.deadStockItemId, Number(row.reservedQty ?? 0));
    }

    const validatedA: ValidatedProposalItem[] = candidate.itemsFromA.map((item) => {
      const stock = stockMap.get(item.deadStockItemId);
      if (!stock) throw new Error('提案対象の在庫が見つかりません');
      if (stock.pharmacyId !== pharmacyAId) throw new Error('自薬局の在庫のみ提案できます');
      if (!stock.isAvailable) throw new Error('提案対象の在庫が既に利用不可です');
      const availableQty = Number(stock.quantity) - (reservedByStockId.get(item.deadStockItemId) ?? 0);
      if (item.quantity > availableQty) throw new Error('提案数量が利用可能在庫数を超えています');
      const unitPrice = Number(stock.yakkaUnitPrice);
      if (!unitPrice || unitPrice <= 0) throw new Error('薬価が設定されていない在庫は提案できません');

      return {
        deadStockItemId: item.deadStockItemId,
        fromPharmacyId: pharmacyAId,
        toPharmacyId: candidate.pharmacyBId,
        quantity: item.quantity,
        yakkaValue: roundTo2(unitPrice * item.quantity),
      };
    });

    const validatedB: ValidatedProposalItem[] = candidate.itemsFromB.map((item) => {
      const stock = stockMap.get(item.deadStockItemId);
      if (!stock) throw new Error('提案対象の在庫が見つかりません');
      if (stock.pharmacyId !== candidate.pharmacyBId) throw new Error('交換先薬局の在庫のみ指定できます');
      if (!stock.isAvailable) throw new Error('提案対象の在庫が既に利用不可です');
      const availableQty = Number(stock.quantity) - (reservedByStockId.get(item.deadStockItemId) ?? 0);
      if (item.quantity > availableQty) throw new Error('提案数量が利用可能在庫数を超えています');
      const unitPrice = Number(stock.yakkaUnitPrice);
      if (!unitPrice || unitPrice <= 0) throw new Error('薬価が設定されていない在庫は提案できません');

      return {
        deadStockItemId: item.deadStockItemId,
        fromPharmacyId: candidate.pharmacyBId,
        toPharmacyId: pharmacyAId,
        quantity: item.quantity,
        yakkaValue: roundTo2(unitPrice * item.quantity),
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

    const [proposal] = await tx.insert(exchangeProposals).values({
      pharmacyAId,
      pharmacyBId: candidate.pharmacyBId,
      status: 'proposed',
      totalValueA: String(totalValueA),
      totalValueB: String(totalValueB),
      valueDifference: String(valueDifference),
    }).returning({ id: exchangeProposals.id });

    await tx.insert(exchangeProposalItems).values(
      [...validatedA, ...validatedB].map((item) => ({
        proposalId: proposal.id,
        deadStockItemId: item.deadStockItemId,
        fromPharmacyId: item.fromPharmacyId,
        toPharmacyId: item.toPharmacyId,
        quantity: item.quantity,
        yakkaValue: String(item.yakkaValue),
      }))
    );

    await tx.insert(deadStockReservations).values(
      [...validatedA, ...validatedB].map((item) => ({
        deadStockItemId: item.deadStockItemId,
        proposalId: proposal.id,
        reservedQuantity: item.quantity,
      })),
    );

    return proposal.id;
  });
}

export async function acceptProposal(proposalId: number, pharmacyId: number): Promise<string> {
  return db.transaction(async (tx) => {
    const [proposal] = await tx.select({
      pharmacyAId: exchangeProposals.pharmacyAId,
      pharmacyBId: exchangeProposals.pharmacyBId,
      status: exchangeProposals.status,
    })
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

    if (!VALID_TRANSITIONS[proposal.status]?.includes(newStatus)) {
      throw new Error('この仮マッチングは現在承認できる状態ではありません');
    }

    // Optimistic lock: only update if status hasn't changed since read
    const updated = await tx.update(exchangeProposals)
      .set({ status: newStatus as typeof proposal.status })
      .where(and(
        eq(exchangeProposals.id, proposalId),
        eq(exchangeProposals.status, proposal.status),
      ))
      .returning({ id: exchangeProposals.id });

    if (updated.length === 0) {
      throw new Error('状態が変更されたため、操作を完了できません。再読み込みしてください');
    }

    return newStatus;
  });
}

export async function rejectProposal(proposalId: number, pharmacyId: number): Promise<void> {
  return db.transaction(async (tx) => {
    const [proposal] = await tx.select({
      pharmacyAId: exchangeProposals.pharmacyAId,
      pharmacyBId: exchangeProposals.pharmacyBId,
      status: exchangeProposals.status,
    })
      .from(exchangeProposals)
      .where(eq(exchangeProposals.id, proposalId))
      .limit(1);

    if (!proposal) throw new Error('マッチングが見つかりません');

    const isParty = proposal.pharmacyAId === pharmacyId || proposal.pharmacyBId === pharmacyId;
    if (!isParty) throw new Error('このマッチングにアクセスする権限がありません');

    if (!VALID_TRANSITIONS[proposal.status]?.includes('rejected')) {
      throw new Error('このマッチングは拒否できる状態ではありません');
    }

    const updated = await tx.update(exchangeProposals)
      .set({ status: 'rejected' })
      .where(and(
        eq(exchangeProposals.id, proposalId),
        eq(exchangeProposals.status, proposal.status),
      ))
      .returning({ id: exchangeProposals.id });

    if (updated.length === 0) {
      throw new Error('状態が変更されたため、操作を完了できません。再読み込みしてください');
    }

    await tx.delete(deadStockReservations)
      .where(eq(deadStockReservations.proposalId, proposalId));
  });
}

export async function completeProposal(proposalId: number, pharmacyId: number): Promise<void> {
  await db.transaction(async (tx) => {
    const [proposal] = await tx.select({
      pharmacyAId: exchangeProposals.pharmacyAId,
      pharmacyBId: exchangeProposals.pharmacyBId,
      status: exchangeProposals.status,
      totalValueA: exchangeProposals.totalValueA,
      totalValueB: exchangeProposals.totalValueB,
    })
      .from(exchangeProposals)
      .where(eq(exchangeProposals.id, proposalId))
      .limit(1);

    if (!proposal) throw new Error('マッチングが見つかりません');
    if (proposal.status !== 'confirmed') throw new Error('このマッチングはまだ確定されていません');

    const isParty = proposal.pharmacyAId === pharmacyId || proposal.pharmacyBId === pharmacyId;
    if (!isParty) throw new Error('このマッチングにアクセスする権限がありません');

    const completedAt = new Date().toISOString();
    const [claimedProposal] = await tx.update(exchangeProposals)
      .set({ status: 'completed', completedAt })
      .where(and(
        eq(exchangeProposals.id, proposalId),
        eq(exchangeProposals.status, 'confirmed'),
      ))
      .returning({
        pharmacyAId: exchangeProposals.pharmacyAId,
        pharmacyBId: exchangeProposals.pharmacyBId,
        totalValueA: exchangeProposals.totalValueA,
        totalValueB: exchangeProposals.totalValueB,
      });

    if (!claimedProposal) {
      throw new Error('状態が変更されたため、操作を完了できません。再読み込みしてください');
    }

    const items = await tx.select({
      deadStockItemId: exchangeProposalItems.deadStockItemId,
      fromPharmacyId: exchangeProposalItems.fromPharmacyId,
      quantity: exchangeProposalItems.quantity,
    })
      .from(exchangeProposalItems)
      .where(eq(exchangeProposalItems.proposalId, proposalId));

    if (items.length === 0) {
      throw new Error('提案アイテムが存在しません');
    }

    const itemIds = [...new Set(items.map((item) => item.deadStockItemId))];
    const stockRows = await tx.select({
      id: deadStockItems.id,
      pharmacyId: deadStockItems.pharmacyId,
      quantity: deadStockItems.quantity,
      isAvailable: deadStockItems.isAvailable,
    })
      .from(deadStockItems)
      .where(inArray(deadStockItems.id, itemIds));

    const stockMap = new Map(stockRows.map((row) => [row.id, row]));
    for (const item of items) {
      const stock = stockMap.get(item.deadStockItemId);
      if (!stock || stock.pharmacyId !== item.fromPharmacyId || !stock.isAvailable) {
        throw new Error('在庫状態が変更されているため、交換を完了できません');
      }
      if (Number(stock.quantity) < Number(item.quantity)) {
        throw new Error('在庫数量が不足しているため、交換を完了できません');
      }
    }
    for (const item of items) {
      const updated = await tx.update(deadStockItems)
        .set({
          quantity: sql`${deadStockItems.quantity} - ${item.quantity}`,
          isAvailable: sql`CASE WHEN (${deadStockItems.quantity} - ${item.quantity}) <= 0 THEN false ELSE true END`,
        })
        .where(and(
          eq(deadStockItems.id, item.deadStockItemId),
          eq(deadStockItems.isAvailable, true),
          sql`${deadStockItems.quantity} >= ${item.quantity}`,
        ))
        .returning({ id: deadStockItems.id });
      if (updated.length === 0) {
        throw new Error('在庫状態が変更されているため、交換を完了できません');
      }
    }

    const totalValue = Number(claimedProposal.totalValueA ?? 0) + Number(claimedProposal.totalValueB ?? 0);
    await tx.insert(exchangeHistory).values({
      proposalId,
      pharmacyAId: claimedProposal.pharmacyAId,
      pharmacyBId: claimedProposal.pharmacyBId,
      totalValue: String(totalValue),
      completedAt,
    });

    await tx.delete(deadStockReservations)
      .where(eq(deadStockReservations.proposalId, proposalId));
  });
}
