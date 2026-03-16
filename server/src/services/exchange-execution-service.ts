import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
  deadStockItems,
  deadStockReservations,
  exchangeHistory,
  exchangeProposalItems,
  exchangeProposals,
  pharmacies,
} from '../db/schema';
import { createNotification } from './notification-service';
import { logger } from './logger';
import { invalidateStatisticsSummaryCacheForPharmacies } from './statistics-cache-service';
import {
  assertActionPermission,
  assertNotBlocked,
  assertProposalValues,
  buildReservedByStockId,
  buildStockMap,
  calculateProposalValues,
  canTransition,
  parseCandidate,
  RESERVATION_ACTIVE_STATUSES,
  validateAndMapProposalItems,
  validateAndUpdateStock,
  type ProposalStatus,
  type TransactionClient,
} from './exchange-validation-service';

type NotificationInput = Parameters<typeof createNotification>[0];

interface ActionProposalRow {
  pharmacyAId: number;
  pharmacyBId: number;
  status: ProposalStatus;
}

interface ProposalWithTotalsRow extends ActionProposalRow {
  totalValueA: string | null;
  totalValueB: string | null;
}

interface ProposalPartiesResult {
  pharmacyAId: number;
  pharmacyBId: number;
}

interface CreateProposalTxResult {
  proposalId: number;
  itemCount: number;
}

interface AcceptProposalTxResult extends ProposalPartiesResult {
  newStatus: ProposalStatus;
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

async function notifyProposalEvent(
  pharmacyId: number,
  type: string,
  proposalId: number,
  title: string,
  message: string,
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

function getOtherPartyId(pharmacyAId: number, pharmacyBId: number, pharmacyId: number): number {
  return pharmacyAId === pharmacyId ? pharmacyBId : pharmacyAId;
}

async function findActionProposal(tx: TransactionClient, proposalId: number): Promise<ActionProposalRow> {
  const proposal = await findProposalWithTotals(tx, proposalId);

  return {
    pharmacyAId: proposal.pharmacyAId,
    pharmacyBId: proposal.pharmacyBId,
    status: proposal.status,
  };
}

async function findProposalWithTotals(
  tx: TransactionClient,
  proposalId: number,
): Promise<ProposalWithTotalsRow> {
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

  if (!proposal) {
    throw new Error('マッチングが見つかりません');
  }

  return proposal;
}

async function deleteProposalReservations(tx: TransactionClient, proposalId: number): Promise<void> {
  await tx.delete(deadStockReservations)
    .where(eq(deadStockReservations.proposalId, proposalId));
}

function resolveAcceptStatus(proposal: ActionProposalRow, pharmacyId: number): ProposalStatus {
  const isA = proposal.pharmacyAId === pharmacyId;
  const isB = proposal.pharmacyBId === pharmacyId;

  if (proposal.status === 'proposed') {
    return isA ? 'accepted_a' : 'accepted_b';
  }

  if (proposal.status === 'accepted_a' && isB) {
    return 'confirmed';
  }

  if (proposal.status === 'accepted_b' && isA) {
    return 'confirmed';
  }

  throw new Error('この仮マッチングは現在承認できる状態ではありません');
}

async function updateProposalStatusWithOptimisticLock(
  tx: TransactionClient,
  proposalId: number,
  currentStatus: ProposalStatus,
  newStatus: ProposalStatus,
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

async function claimCompletedProposal(
  tx: TransactionClient,
  proposalId: number,
  completedAt: string,
): Promise<{
  pharmacyAId: number;
  pharmacyBId: number;
  totalValueA: string | null;
  totalValueB: string | null;
}> {
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

  return claimedProposal;
}

async function getProposalItemsForCompletion(
  tx: TransactionClient,
  proposalId: number,
): Promise<Array<{ deadStockItemId: number; fromPharmacyId: number; quantity: number }>> {
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

  return items;
}

export async function createProposal(
  pharmacyAId: number,
  rawCandidate: unknown,
): Promise<number> {
  const candidate = parseCandidate(pharmacyAId, rawCandidate);
  const result: CreateProposalTxResult = await db.transaction(async (tx): Promise<CreateProposalTxResult> => {
    const [pharmacyB] = await tx.select({ id: pharmacies.id, isActive: pharmacies.isActive })
      .from(pharmacies)
      .where(eq(pharmacies.id, candidate.pharmacyBId))
      .limit(1);

    if (!pharmacyB || !pharmacyB.isActive) {
      throw new Error('交換先薬局が見つからないか、無効です');
    }

    await assertNotBlocked(tx, pharmacyAId, candidate.pharmacyBId);

    const sortedUniqueIds = [...new Set(
      [...candidate.itemsFromA, ...candidate.itemsFromB].map((item) => item.deadStockItemId),
    )].sort((a, b) => a - b);

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

    const stockMap = buildStockMap(stockRows);

    const reservationRows = await tx.select({
      deadStockItemId: deadStockReservations.deadStockItemId,
      reservedQty: sql<number>`coalesce(sum(${deadStockReservations.reservedQuantity}), 0)`,
    })
      .from(deadStockReservations)
      .innerJoin(exchangeProposals, eq(deadStockReservations.proposalId, exchangeProposals.id))
      .where(and(
        inArray(deadStockReservations.deadStockItemId, sortedUniqueIds),
        inArray(exchangeProposals.status, RESERVATION_ACTIVE_STATUSES),
      ))
      .groupBy(deadStockReservations.deadStockItemId);
    const reservedByStockId = buildReservedByStockId(reservationRows);

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

    const values = calculateProposalValues(validatedA, validatedB);
    assertProposalValues(values);

    const [proposal] = await tx.insert(exchangeProposals).values({
      pharmacyAId,
      pharmacyBId: candidate.pharmacyBId,
      status: 'proposed',
      totalValueA: String(values.totalValueA),
      totalValueB: String(values.totalValueB),
      valueDifference: String(values.valueDifference),
    }).returning({ id: exchangeProposals.id });

    const allValidatedItems = [...validatedA, ...validatedB];

    await tx.insert(exchangeProposalItems).values(
      allValidatedItems.map((item) => ({
        proposalId: proposal.id,
        deadStockItemId: item.deadStockItemId,
        fromPharmacyId: item.fromPharmacyId,
        toPharmacyId: item.toPharmacyId,
        quantity: item.quantity,
        yakkaValue: String(item.yakkaValue),
      })),
    );

    await tx.insert(deadStockReservations).values(
      allValidatedItems.map((item) => ({
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

  invalidateStatisticsSummaryCacheForPharmacies([pharmacyAId, candidate.pharmacyBId]);
  await notifyProposalEvent(candidate.pharmacyBId, 'proposal_received', result.proposalId, '交換提案が届きました', `新しい交換提案（${result.itemCount}品目）`);

  return result.proposalId;
}

export async function acceptProposal(proposalId: number, pharmacyId: number): Promise<string> {
  const result: AcceptProposalTxResult = await db.transaction(async (tx): Promise<AcceptProposalTxResult> => {
    const proposal = await findActionProposal(tx, proposalId);
    assertActionPermission(proposal, pharmacyId);
    const newStatus = resolveAcceptStatus(proposal, pharmacyId);

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

    return {
      newStatus,
      pharmacyAId: proposal.pharmacyAId,
      pharmacyBId: proposal.pharmacyBId,
    };
  });
  invalidateStatisticsSummaryCacheForPharmacies([result.pharmacyAId, result.pharmacyBId]);
  return result.newStatus;
}

export async function rejectProposal(proposalId: number, pharmacyId: number): Promise<void> {
  const result: ProposalPartiesResult = await db.transaction(async (tx): Promise<ProposalPartiesResult> => {
    const proposal = await findActionProposal(tx, proposalId);
    assertActionPermission(proposal, pharmacyId);

    if (!canTransition(proposal.status, 'rejected')) {
      throw new Error('このマッチングは拒否できる状態ではありません');
    }

    await updateProposalStatusWithOptimisticLock(tx, proposalId, proposal.status, 'rejected');

    await deleteProposalReservations(tx, proposalId);

    const rejectOtherPartyId = getOtherPartyId(proposal.pharmacyAId, proposal.pharmacyBId, pharmacyId);

    await notifyProposalEvent(rejectOtherPartyId, 'proposal_status_changed', proposalId, '交換提案が却下されました', '相手薬局が提案を却下しました');
    return {
      pharmacyAId: proposal.pharmacyAId,
      pharmacyBId: proposal.pharmacyBId,
    };
  });
  invalidateStatisticsSummaryCacheForPharmacies([result.pharmacyAId, result.pharmacyBId]);
}

export async function completeProposal(proposalId: number, pharmacyId: number): Promise<void> {
  const result: ProposalPartiesResult = await db.transaction(async (tx): Promise<ProposalPartiesResult> => {
    const proposal = await findProposalWithTotals(tx, proposalId);
    if (proposal.status !== 'confirmed') throw new Error('このマッチングはまだ確定されていません');
    assertActionPermission(proposal, pharmacyId);

    const completedAt = new Date().toISOString();
    const claimedProposal = await claimCompletedProposal(tx, proposalId, completedAt);
    const items = await getProposalItemsForCompletion(tx, proposalId);

    await validateAndUpdateStock(tx, items);

    const totalValue = Number(claimedProposal.totalValueA ?? 0) + Number(claimedProposal.totalValueB ?? 0);
    await tx.insert(exchangeHistory).values({
      proposalId,
      pharmacyAId: claimedProposal.pharmacyAId,
      pharmacyBId: claimedProposal.pharmacyBId,
      totalValue: String(totalValue),
      completedAt,
    });

    await deleteProposalReservations(tx, proposalId);
    return {
      pharmacyAId: claimedProposal.pharmacyAId,
      pharmacyBId: claimedProposal.pharmacyBId,
    };
  });
  invalidateStatisticsSummaryCacheForPharmacies([result.pharmacyAId, result.pharmacyBId]);
}
