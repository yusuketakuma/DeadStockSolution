import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
  exchangeProposals,
  exchangeProposalItems,
  exchangeHistory,
  deadStockItems,
  pharmacies,
  deadStockReservations,
  pharmacyRelationships,
} from '../db/schema';
import { createNotification } from './notification-service';
import { roundTo2 } from './matching-score-service';
import { logger } from './logger';

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

type ProposalStatus = typeof exchangeProposals.$inferSelect.status;

type NotificationInput = Parameters<typeof createNotification>[0];
type TransactionClient = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface ProposalStockRow {
  id: number;
  pharmacyId: number;
  quantity: number | string | null;
  yakkaUnitPrice: number | string | null;
  isAvailable: boolean | null;
}

interface ActionProposalRow {
  pharmacyAId: number;
  pharmacyBId: number;
  status: ProposalStatus;
}

async function createNotificationSafely(input: NotificationInput): Promise<void> {
  const created = await createNotification(input);
  if (created) return;
  logger.warn('Proposal notification could not be persisted', {
    pharmacyId: input.pharmacyId,
    type: input.type,
    referenceType: input.referenceType ?? null,
    referenceId: input.referenceId ?? null,
  });
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

function validateAndMapProposalItems(params: {
  items: ProposalItemInput[];
  stockMap: Map<number, ProposalStockRow>;
  reservedByStockId: Map<number, number>;
  ownerPharmacyId: number;
  ownerMismatchMessage: string;
  fromPharmacyId: number;
  toPharmacyId: number;
}): ValidatedProposalItem[] {
  const {
    items,
    stockMap,
    reservedByStockId,
    ownerPharmacyId,
    ownerMismatchMessage,
    fromPharmacyId,
    toPharmacyId,
  } = params;

  return items.map((item) => {
    const stock = stockMap.get(item.deadStockItemId);
    if (!stock) throw new Error('提案対象の在庫が見つかりません');
    if (stock.pharmacyId !== ownerPharmacyId) throw new Error(ownerMismatchMessage);
    if (!stock.isAvailable) throw new Error('提案対象の在庫が既に利用不可です');
    const availableQty = Number(stock.quantity) - (reservedByStockId.get(item.deadStockItemId) ?? 0);
    if (item.quantity > availableQty) throw new Error('提案数量が利用可能在庫数を超えています');
    const unitPrice = Number(stock.yakkaUnitPrice);
    if (!unitPrice || unitPrice <= 0) throw new Error('薬価が設定されていない在庫は提案できません');

    return {
      deadStockItemId: item.deadStockItemId,
      fromPharmacyId,
      toPharmacyId,
      quantity: item.quantity,
      yakkaValue: roundTo2(unitPrice * item.quantity),
    };
  });
}

function getOtherPartyId(pharmacyAId: number, pharmacyBId: number, pharmacyId: number): number {
  return pharmacyAId === pharmacyId ? pharmacyBId : pharmacyAId;
}

async function notifyProposalEvent(
  pharmacyId: number,
  type: string,
  proposalId: number,
  title: string,
  message: string
): Promise<void> {
  await createNotificationSafely({
    pharmacyId,
    type: type as NotificationInput['type'],
    title,
    message,
    referenceType: 'proposal',
    referenceId: proposalId,
  });
}

async function assertNotBlocked(
  tx: TransactionClient,
  pharmacyAId: number,
  pharmacyBId: number
): Promise<void> {
  const [blockedRelationship] = await tx.select({ id: pharmacyRelationships.id })
    .from(pharmacyRelationships)
    .where(and(
      eq(pharmacyRelationships.relationshipType, 'blocked'),
      or(
        and(
          eq(pharmacyRelationships.pharmacyId, pharmacyAId),
          eq(pharmacyRelationships.targetPharmacyId, pharmacyBId),
        ),
        and(
          eq(pharmacyRelationships.pharmacyId, pharmacyBId),
          eq(pharmacyRelationships.targetPharmacyId, pharmacyAId),
        ),
      ),
    ))
    .limit(1);

  if (blockedRelationship) {
    throw new Error('ブロック中の薬局には提案できません');
  }
}

async function validateAndUpdateStock(
  tx: TransactionClient,
  items: Array<{ deadStockItemId: number; fromPharmacyId: number; quantity: number }>
): Promise<void> {
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
  // N回の逐次UPDATEをPromise.allで並列化しDBラウンドトリップを削減
  const updateResults = await Promise.all(
    items.map((item) =>
      tx.update(deadStockItems)
        .set({
          quantity: sql`${deadStockItems.quantity} - ${item.quantity}`,
          isAvailable: sql`CASE WHEN (${deadStockItems.quantity} - ${item.quantity}) <= 0 THEN false ELSE true END`,
        })
        .where(and(
          eq(deadStockItems.id, item.deadStockItemId),
          eq(deadStockItems.isAvailable, true),
          sql`${deadStockItems.quantity} >= ${item.quantity}`,
        ))
        .returning({ id: deadStockItems.id }),
    ),
  );
  if (updateResults.some((result) => result.length === 0)) {
    throw new Error('在庫状態が変更されているため、交換を完了できません');
  }
}

async function updateProposalStatusWithOptimisticLock(
  tx: TransactionClient,
  proposalId: number,
  currentStatus: ProposalStatus,
  newStatus: ProposalStatus
): Promise<void> {
  const updated = await tx.update(exchangeProposals)
    .set({ status: newStatus })
    .where(and(
      eq(exchangeProposals.id, proposalId),
      eq(exchangeProposals.status, currentStatus),
    ))
    .returning({ id: exchangeProposals.id });

  if (updated.length === 0) {
    throw new Error('状態が変更されたため、操作を完了できません。再読み込みしてください');
  }
}

async function findActionProposal(tx: TransactionClient, proposalId: number): Promise<ActionProposalRow> {
  const [proposal] = await tx.select({
    pharmacyAId: exchangeProposals.pharmacyAId,
    pharmacyBId: exchangeProposals.pharmacyBId,
    status: exchangeProposals.status,
  })
    .from(exchangeProposals)
    .where(eq(exchangeProposals.id, proposalId))
    .limit(1);

  if (!proposal) {
    throw new Error('マッチングが見つかりません');
  }

  return proposal;
}

function assertActionPermission(proposal: Pick<ActionProposalRow, 'pharmacyAId' | 'pharmacyBId'>, pharmacyId: number): void {
  const isParty = proposal.pharmacyAId === pharmacyId || proposal.pharmacyBId === pharmacyId;
  if (!isParty) {
    throw new Error('このマッチングにアクセスする権限がありません');
  }
}

// Valid state transitions for exchange proposals
const VALID_TRANSITIONS = {
  proposed: ['accepted_a', 'accepted_b', 'rejected'],
  accepted_a: ['confirmed', 'rejected'],
  accepted_b: ['confirmed', 'rejected'],
  confirmed: ['completed'],
  rejected: [],
  completed: [],
  cancelled: [],
} satisfies Partial<Record<ProposalStatus, readonly ProposalStatus[]>>;

function canTransition(from: ProposalStatus, to: ProposalStatus): boolean {
  const candidates = VALID_TRANSITIONS[from];
  return Array.isArray(candidates) && candidates.some((candidate) => candidate === to);
}

export async function createProposal(
  pharmacyAId: number,
  rawCandidate: unknown
): Promise<number> {
  const candidate = parseCandidate(pharmacyAId, rawCandidate);
  const result = await db.transaction(async (tx) => {
    const [pharmacyB] = await tx.select({ id: pharmacies.id, isActive: pharmacies.isActive })
      .from(pharmacies)
      .where(eq(pharmacies.id, candidate.pharmacyBId))
      .limit(1);

    if (!pharmacyB || !pharmacyB.isActive) {
      throw new Error('交換先薬局が見つからないか、無効です');
    }

    await assertNotBlocked(tx, pharmacyAId, candidate.pharmacyBId);

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

    const stockMap = new Map<number, ProposalStockRow>();
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

    const validatedA = validateAndMapProposalItems({
      items: candidate.itemsFromA,
      stockMap,
      reservedByStockId,
      ownerPharmacyId: pharmacyAId,
      ownerMismatchMessage: '自薬局の在庫のみ提案できます',
      fromPharmacyId: pharmacyAId,
      toPharmacyId: candidate.pharmacyBId,
    });

    const validatedB = validateAndMapProposalItems({
      items: candidate.itemsFromB,
      stockMap,
      reservedByStockId,
      ownerPharmacyId: candidate.pharmacyBId,
      ownerMismatchMessage: '交換先薬局の在庫のみ指定できます',
      fromPharmacyId: candidate.pharmacyBId,
      toPharmacyId: pharmacyAId,
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

    return {
      proposalId: proposal.id,
      itemCount: validatedA.length + validatedB.length,
    };
  });

  await notifyProposalEvent(candidate.pharmacyBId, 'proposal_received', result.proposalId, '交換提案が届きました', `新しい交換提案（${result.itemCount}品目）`);

  return result.proposalId;
}

export async function acceptProposal(proposalId: number, pharmacyId: number): Promise<string> {
  return db.transaction(async (tx) => {
    const proposal = await findActionProposal(tx, proposalId);

    const isA = proposal.pharmacyAId === pharmacyId;
    const isB = proposal.pharmacyBId === pharmacyId;
    assertActionPermission(proposal, pharmacyId);

    let newStatus: ProposalStatus;

    if (proposal.status === 'proposed') {
      newStatus = isA ? 'accepted_a' : 'accepted_b';
    } else if (proposal.status === 'accepted_a' && isB) {
      newStatus = 'confirmed';
    } else if (proposal.status === 'accepted_b' && isA) {
      newStatus = 'confirmed';
    } else {
      throw new Error('この仮マッチングは現在承認できる状態ではありません');
    }

    if (!canTransition(proposal.status, newStatus)) {
      throw new Error('この仮マッチングは現在承認できる状態ではありません');
    }

    // Optimistic lock: only update if status hasn't changed since read
    await updateProposalStatusWithOptimisticLock(
      tx,
      proposalId,
      proposal.status,
      newStatus,
    );

    const otherPartyId = getOtherPartyId(proposal.pharmacyAId, proposal.pharmacyBId, pharmacyId);

    await notifyProposalEvent(otherPartyId, 'proposal_status_changed', proposalId, '交換提案のステータスが更新されました', `提案が${newStatus === 'confirmed' ? '確定' : '承認'}されました`);

    return newStatus;
  });
}

export async function rejectProposal(proposalId: number, pharmacyId: number): Promise<void> {
  return db.transaction(async (tx) => {
    const proposal = await findActionProposal(tx, proposalId);
    assertActionPermission(proposal, pharmacyId);

    if (!canTransition(proposal.status, 'rejected')) {
      throw new Error('このマッチングは拒否できる状態ではありません');
    }

    await updateProposalStatusWithOptimisticLock(tx, proposalId, proposal.status, 'rejected');

    await tx.delete(deadStockReservations)
      .where(eq(deadStockReservations.proposalId, proposalId));

    const rejectOtherPartyId = getOtherPartyId(proposal.pharmacyAId, proposal.pharmacyBId, pharmacyId);

    await notifyProposalEvent(rejectOtherPartyId, 'proposal_status_changed', proposalId, '交換提案が却下されました', '相手薬局が提案を却下しました');
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
    assertActionPermission(proposal, pharmacyId);

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

    await validateAndUpdateStock(tx, items);

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
