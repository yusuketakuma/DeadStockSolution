import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
  deadStockItems,
  deadStockReservations,
  exchangeProposalItems,
  exchangeProposals,
  pharmacies,
} from '../db/schema';
import { createNotification } from './notification-service';
import { logger } from './logger';
import { writeLog } from './log-service';
import { invalidateStatisticsSummaryCacheForPharmacies } from './statistics-cache-service';
import { triggerMatchingRefreshOnUpload } from './matching-refresh-service';
import { sleep } from '../utils/http-utils';
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
const PROPOSAL_EXPIRY_PENDING_STATUSES: ProposalStatus[] = ['proposed', 'accepted_a', 'accepted_b'];

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
  previousStatus: ProposalStatus;
}

interface RejectProposalTxResult extends ProposalPartiesResult {
  previousStatus: ProposalStatus;
}

async function createNotificationSafely(input: NotificationInput): Promise<void> {
  const MAX_RETRIES = 3;
  const RETRY_DELAYS_MS = [100, 300, 600];

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const created = await createNotification(input);
    if (created) return;

    if (attempt < MAX_RETRIES - 1) {
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }

  logger.error('Proposal notification failed after all retries', {
    pharmacyId: input.pharmacyId,
    type: input.type,
    referenceType: input.referenceType ?? null,
    referenceId: input.referenceId ?? null,
    maxRetries: MAX_RETRIES,
  });
}

async function notifyProposalEvent(
  pharmacyId: number,
  type: NotificationInput['type'],
  proposalId: number,
  title: string,
  message: string,
): Promise<void> {
  await createNotificationSafely({
    pharmacyId,
    type,
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
  const nextValues: {
    status: ProposalStatus;
    expiresAt?: null;
    expiryReminderSentAt?: null;
  } = { status: newStatus };
  if (newStatus === 'confirmed') {
    nextValues.expiresAt = null;
    nextValues.expiryReminderSentAt = null;
  }

  const updated = await tx.update(exchangeProposals)
    .set(nextValues)
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

function isLockNotAvailableError(err: unknown): boolean {
  if (err && typeof err === 'object' && 'code' in err) {
    return (err as { code: string }).code === '55P03';
  }
  return false;
}

export async function createProposal(
  pharmacyAId: number,
  rawCandidate: unknown,
): Promise<number> {
  const candidate = parseCandidate(pharmacyAId, rawCandidate);
  let result: CreateProposalTxResult;
  try {
    result = await db.transaction(async (tx): Promise<CreateProposalTxResult> => {
      await tx.execute(sql`SET LOCAL statement_timeout = '10s'`);

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
        FOR UPDATE NOWAIT
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

      const PROPOSAL_EXPIRY_HOURS = Number(process.env.PROPOSAL_EXPIRY_HOURS) || 72;
      const expiresAt = new Date(Date.now() + PROPOSAL_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();

      const [proposal] = await tx.insert(exchangeProposals).values({
        pharmacyAId,
        pharmacyBId: candidate.pharmacyBId,
        status: 'proposed',
        totalValueA: String(values.totalValueA),
        totalValueB: String(values.totalValueB),
        valueDifference: String(values.valueDifference),
        expiresAt,
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
  } catch (err) {
    if (isLockNotAvailableError(err)) {
      throw new Error('他のユーザーが同じ在庫を処理中です。しばらく後に再試行してください');
    }
    throw err;
  }

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

    await updateProposalStatusWithOptimisticLock(
      tx,
      proposalId,
      proposal.status,
      newStatus,
    );

    return {
      newStatus,
      previousStatus: proposal.status,
      pharmacyAId: proposal.pharmacyAId,
      pharmacyBId: proposal.pharmacyBId,
    };
  });
  invalidateStatisticsSummaryCacheForPharmacies([result.pharmacyAId, result.pharmacyBId]);
  const otherPartyId = getOtherPartyId(result.pharmacyAId, result.pharmacyBId, pharmacyId);
  await notifyProposalEvent(otherPartyId, 'proposal_status_changed', proposalId, '交換提案のステータスが更新されました', `提案が${result.newStatus === 'confirmed' ? '確定' : '承認'}されました`);
  void writeLog('proposal_accept', {
    pharmacyId,
    detail: `proposalId=${proposalId}|status=${result.newStatus}`,
    resourceType: 'proposal',
    resourceId: proposalId,
    metadataJson: {
      proposalId,
      previousStatus: result.previousStatus,
      newStatus: result.newStatus,
    },
  });
  return result.newStatus;
}

export async function rejectProposal(proposalId: number, pharmacyId: number): Promise<void> {
  const result: RejectProposalTxResult = await db.transaction(async (tx): Promise<RejectProposalTxResult> => {
    const proposal = await findActionProposal(tx, proposalId);
    assertActionPermission(proposal, pharmacyId);

    if (!canTransition(proposal.status, 'rejected')) {
      throw new Error('このマッチングは拒否できる状態ではありません');
    }

    await updateProposalStatusWithOptimisticLock(tx, proposalId, proposal.status, 'rejected');

    await deleteProposalReservations(tx, proposalId);

    return {
      pharmacyAId: proposal.pharmacyAId,
      pharmacyBId: proposal.pharmacyBId,
      previousStatus: proposal.status,
    };
  });
  invalidateStatisticsSummaryCacheForPharmacies([result.pharmacyAId, result.pharmacyBId]);
  const rejectOtherPartyId = getOtherPartyId(result.pharmacyAId, result.pharmacyBId, pharmacyId);
  await notifyProposalEvent(rejectOtherPartyId, 'proposal_status_changed', proposalId, '交換提案が却下されました', '相手薬局が提案を却下しました');
  void writeLog('proposal_reject', {
    pharmacyId,
    detail: `proposalId=${proposalId}|status=rejected`,
    resourceType: 'proposal',
    resourceId: proposalId,
    metadataJson: {
      proposalId,
      previousStatus: result.previousStatus,
      newStatus: 'rejected',
    },
  });
}

export async function expireStaleProposals(): Promise<{ expiredCount: number }> {
  const now = new Date().toISOString();

  const staleProposals = await db.select({
    id: exchangeProposals.id,
    pharmacyAId: exchangeProposals.pharmacyAId,
    pharmacyBId: exchangeProposals.pharmacyBId,
    status: exchangeProposals.status,
  })
    .from(exchangeProposals)
    .where(and(
      inArray(exchangeProposals.status, PROPOSAL_EXPIRY_PENDING_STATUSES),
      sql`${exchangeProposals.expiresAt} IS NOT NULL`,
      sql`${exchangeProposals.expiresAt} < ${now}`,
    ));

  if (staleProposals.length === 0) return { expiredCount: 0 };

  // 個別トランザクションで各提案を期限切れ処理（PG aborted state回避）
  let expiredCount = 0;
  for (const proposal of staleProposals) {
    try {
      await db.transaction(async (tx) => {
        await updateProposalStatusWithOptimisticLock(tx, proposal.id, proposal.status as ProposalStatus, 'rejected');
        await deleteProposalReservations(tx, proposal.id);
      });
      await notifyProposalEvent(proposal.pharmacyAId, 'proposal_status_changed', proposal.id, '交換提案が期限切れになりました', '提案の有効期限が過ぎたため、自動的に却下されました');
      await notifyProposalEvent(proposal.pharmacyBId, 'proposal_status_changed', proposal.id, '交換提案が期限切れになりました', '提案の有効期限が過ぎたため、自動的に却下されました');
      void writeLog('proposal_expired', {
        pharmacyId: null,
        detail: `proposalId=${proposal.id}|status=rejected`,
        resourceType: 'proposal',
        resourceId: proposal.id,
        metadataJson: {
          proposalId: proposal.id,
          previousStatus: proposal.status,
          newStatus: 'rejected',
          expiredBy: 'system',
          pharmacyAId: proposal.pharmacyAId,
          pharmacyBId: proposal.pharmacyBId,
        },
      });
      expiredCount++;
    } catch (err) {
      logger.warn('Failed to expire stale proposal', {
        proposalId: proposal.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (expiredCount > 0) {
    const pharmacyIds = [...new Set(staleProposals.flatMap((p) => [p.pharmacyAId, p.pharmacyBId]))];
    invalidateStatisticsSummaryCacheForPharmacies(pharmacyIds);
  }

  return { expiredCount };
}

function resolvePendingParty(proposal: { status: string; pharmacyAId: number; pharmacyBId: number }): number | null {
  switch (proposal.status) {
    case 'proposed': return proposal.pharmacyBId;
    case 'accepted_a': return proposal.pharmacyBId;
    case 'accepted_b': return proposal.pharmacyAId;
    case 'confirmed': return null; // 両者承認済みのためリマインダー不要
    default: return null;
  }
}

export async function sendExpiryReminders(): Promise<{ reminderCount: number }> {
  const now = new Date();
  const reminderThreshold = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  const soonExpiring = await db.select({
    id: exchangeProposals.id,
    pharmacyAId: exchangeProposals.pharmacyAId,
    pharmacyBId: exchangeProposals.pharmacyBId,
    status: exchangeProposals.status,
  })
    .from(exchangeProposals)
    .where(and(
      inArray(exchangeProposals.status, PROPOSAL_EXPIRY_PENDING_STATUSES),
      sql`${exchangeProposals.expiresAt} IS NOT NULL`,
      sql`${exchangeProposals.expiresAt} > ${now.toISOString()}`,
      sql`${exchangeProposals.expiresAt} <= ${reminderThreshold}`,
      sql`${exchangeProposals.expiryReminderSentAt} IS NULL`,
    ));

  let reminderCount = 0;
  for (const proposal of soonExpiring) {
    const pendingPharmacyId = resolvePendingParty(proposal);
    if (pendingPharmacyId) {
      await createNotificationSafely({
        pharmacyId: pendingPharmacyId,
        type: 'proposal_status_changed' as NotificationInput['type'],
        title: '交換提案の期限が近づいています',
        message: `提案の有効期限が24時間以内です。ご確認ください。`,
        referenceType: 'proposal',
        referenceId: proposal.id,
      });
      await db.update(exchangeProposals)
        .set({ expiryReminderSentAt: now.toISOString() })
        .where(eq(exchangeProposals.id, proposal.id));
      void writeLog('proposal_expiry_reminder', {
        pharmacyId: null,
        detail: `proposalId=${proposal.id}|status=${proposal.status}|reminder=24h`,
        resourceType: 'proposal',
        resourceId: proposal.id,
        metadataJson: {
          proposalId: proposal.id,
          status: proposal.status,
          pendingPharmacyId,
          reminderWindowHours: 24,
        },
      });
      reminderCount++;
    }
  }

  return { reminderCount };
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
    await tx.update(exchangeProposals)
      .set({ completedTotalValue: String(totalValue) })
      .where(eq(exchangeProposals.id, proposalId));

    await deleteProposalReservations(tx, proposalId);
    return {
      pharmacyAId: claimedProposal.pharmacyAId,
      pharmacyBId: claimedProposal.pharmacyBId,
    };
  });
  invalidateStatisticsSummaryCacheForPharmacies([result.pharmacyAId, result.pharmacyBId]);
  void writeLog('proposal_complete', {
    pharmacyId,
    detail: `proposalId=${proposalId}|status=completed`,
    resourceType: 'proposal',
    resourceId: proposalId,
    metadataJson: {
      proposalId,
      previousStatus: 'confirmed',
      newStatus: 'completed',
    },
  });
  void triggerMatchingRefreshOnUpload({ triggerPharmacyId: result.pharmacyAId, uploadType: 'dead_stock' });
  void triggerMatchingRefreshOnUpload({ triggerPharmacyId: result.pharmacyBId, uploadType: 'dead_stock' });
}
