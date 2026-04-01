import { and, desc, eq, gte, inArray, isNotNull, lte, or } from 'drizzle-orm';
import {
  adminMessages,
  adminMessageReads,
  exchangeProposals,
  deadStockItems,
} from '../../db/schema';
import { type DbClient, type RawTimelineEvent } from '../../types/timeline';

type AdminMessageRow = {
  id: number;
  title: string;
  body: string;
  createdAt: string | null;
};

function resolveEventTimestamp(timestamp: string | null): string {
  return timestamp ?? new Date().toISOString();
}

function appendDateRangeConditions<T>(
  conditions: T[],
  since: string | undefined,
  before: string | undefined,
  buildSinceCondition: (value: string) => T,
  buildBeforeCondition: (value: string) => T,
): void {
  if (since) {
    conditions.push(buildSinceCondition(since));
  }
  if (before) {
    conditions.push(buildBeforeCondition(before));
  }
}

function dedupeRowsById<T extends { id: number }>(rows: readonly T[]): T[] {
  const seen = new Set<number>();
  const merged: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  return merged;
}

export function mapAdminMessageToEvent(row: {
  id: number;
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string | null;
}): RawTimelineEvent {
  return {
    id: `admin_message_${row.id}`,
    source: 'admin_message',
    type: 'admin_message',
    title: `管理者からのお知らせ: ${row.title}`,
    body: row.body,
    timestamp: resolveEventTimestamp(row.createdAt),
    isRead: row.isRead,
    actionPath: '/',
    metadata: {
      messageId: row.id,
    },
  };
}

export function mapExchangeHistoryToEvent(
  row: {
    id: number;
    proposalId: number;
    pharmacyAId: number;
    pharmacyBId: number;
    totalValue: string | null;
    completedAt: string | null;
  },
  pharmacyId: number,
): RawTimelineEvent {
  const isA = row.pharmacyAId === pharmacyId;
  const roleLabel = isA ? '提案元' : '受取側';
  const totalLabel = row.totalValue ? `薬価合計: ${row.totalValue}円` : '薬価合計: -';

  return {
    id: `exchange_history_${row.id}`,
    source: 'exchange_history',
    type: 'exchange_completed',
    title: `交換が完了しました（${roleLabel}）`,
    body: `マッチング #${row.proposalId} の交換が完了しました。${totalLabel}`,
    timestamp: resolveEventTimestamp(row.completedAt),
    isRead: true,
    actionPath: `/proposals/${row.proposalId}`,
    metadata: {
      proposalId: row.proposalId,
      totalValue: row.totalValue,
      isRequester: isA,
    },
  };
}

export function mapExpiryRiskToEvent(row: {
  id: number;
  drugName: string;
  expirationDateIso: string | null;
  quantity: number;
  createdAt: string | null;
}): RawTimelineEvent {
  const expiryLabel = row.expirationDateIso ?? '不明';

  return {
    id: `expiry_risk_${row.id}`,
    source: 'expiry_risk',
    type: 'near_expiry',
    title: `期限切れ間近の在庫があります: ${row.drugName}`,
    body: `有効期限: ${expiryLabel} / 数量: ${row.quantity}`,
    timestamp: resolveEventTimestamp(row.createdAt),
    isRead: false,
    actionPath: '/upload',
    metadata: {
      drugName: row.drugName,
      expirationDateIso: row.expirationDateIso,
      quantity: row.quantity,
    },
  };
}

export function getExpiryDateRange(): { todayStr: string; threeDaysLaterStr: string } {
  const today = new Date();
  const threeDaysLater = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000);
  return {
    todayStr: today.toISOString().split('T')[0],
    threeDaysLaterStr: threeDaysLater.toISOString().split('T')[0],
  };
}

export async function fetchAdminMessageEvents(
  db: DbClient,
  pharmacyId: number,
  since?: string,
  limit?: number,
  before?: string,
): Promise<RawTimelineEvent[]> {
  const sinceCondition = since ? gte(adminMessages.createdAt, since) : undefined;
  const beforeCondition = before ? lte(adminMessages.createdAt, before) : undefined;

  const messageSelect = {
    id: adminMessages.id,
    title: adminMessages.title,
    body: adminMessages.body,
    createdAt: adminMessages.createdAt,
  };

  const subLimit = limit ? Math.ceil(limit / 2) : undefined;

  let allQuery = db
    .select(messageSelect)
    .from(adminMessages)
    .where(
      and(
        eq(adminMessages.targetType, 'all'),
        ...(sinceCondition ? [sinceCondition] : []),
        ...(beforeCondition ? [beforeCondition] : []),
      ),
    )
    .orderBy(desc(adminMessages.createdAt))
    .$dynamic();
  if (subLimit) allQuery = allQuery.limit(subLimit);

  let pharmacyQuery = db
    .select(messageSelect)
    .from(adminMessages)
    .where(
      and(
        eq(adminMessages.targetType, 'pharmacy'),
        eq(adminMessages.targetPharmacyId, pharmacyId),
        ...(sinceCondition ? [sinceCondition] : []),
        ...(beforeCondition ? [beforeCondition] : []),
      ),
    )
    .orderBy(desc(adminMessages.createdAt))
    .$dynamic();
  if (subLimit) pharmacyQuery = pharmacyQuery.limit(subLimit);

  const [allMessages, pharmacyMessages] = await Promise.all([allQuery, pharmacyQuery]);
  const merged = dedupeRowsById<AdminMessageRow>([...allMessages, ...pharmacyMessages]);

  if (merged.length === 0) return [];

  const messageIds = merged.map((row) => row.id);
  const readRows = await db
    .select({ messageId: adminMessageReads.messageId })
    .from(adminMessageReads)
    .where(
      and(
        inArray(adminMessageReads.messageId, messageIds),
        eq(adminMessageReads.pharmacyId, pharmacyId),
      ),
    );

  const readMessageIdSet = new Set(readRows.map((row: { messageId: number }) => row.messageId));

  return merged.map((row) =>
    mapAdminMessageToEvent({
      ...row,
      isRead: readMessageIdSet.has(row.id),
    }),
  );
}

export async function fetchExchangeHistoryEvents(
  db: DbClient,
  pharmacyId: number,
  since?: string,
  limit?: number,
  before?: string,
): Promise<RawTimelineEvent[]> {
  const completedFilter = eq(exchangeProposals.status, 'completed');
  const ownershipCondition = or(
    eq(exchangeProposals.pharmacyAId, pharmacyId),
    eq(exchangeProposals.pharmacyBId, pharmacyId),
  );
  const conditions = [completedFilter, ownershipCondition];
  appendDateRangeConditions(
    conditions,
    since,
    before,
    (value) => gte(exchangeProposals.completedAt, value),
    (value) => lte(exchangeProposals.completedAt, value),
  );

  let query = db
    .select({
      id: exchangeProposals.id,
      proposalId: exchangeProposals.id,
      pharmacyAId: exchangeProposals.pharmacyAId,
      pharmacyBId: exchangeProposals.pharmacyBId,
      totalValue: exchangeProposals.completedTotalValue,
      completedAt: exchangeProposals.completedAt,
    })
    .from(exchangeProposals)
    .where(and(...conditions))
    .orderBy(desc(exchangeProposals.completedAt))
    .$dynamic();
  if (limit) query = query.limit(limit);

  const rows = await query;
  return rows.map((row: typeof rows[number]) => mapExchangeHistoryToEvent(row, pharmacyId));
}

export async function fetchExpiryRiskEvents(
  db: DbClient,
  pharmacyId: number,
  limit?: number,
  before?: string,
): Promise<RawTimelineEvent[]> {
  const { todayStr, threeDaysLaterStr } = getExpiryDateRange();

  const conditions = [
    eq(deadStockItems.pharmacyId, pharmacyId),
    eq(deadStockItems.isAvailable, true),
    isNotNull(deadStockItems.expirationDateIso),
    gte(deadStockItems.expirationDateIso, todayStr),
    lte(deadStockItems.expirationDateIso, threeDaysLaterStr),
  ];
  appendDateRangeConditions(
    conditions,
    undefined,
    before,
    (value) => gte(deadStockItems.createdAt, value),
    (value) => lte(deadStockItems.createdAt, value),
  );

  let query = db
    .select({
      id: deadStockItems.id,
      drugName: deadStockItems.drugName,
      expirationDateIso: deadStockItems.expirationDateIso,
      quantity: deadStockItems.quantity,
      createdAt: deadStockItems.createdAt,
    })
    .from(deadStockItems)
    .where(and(...conditions))
    .orderBy(desc(deadStockItems.createdAt))
    .$dynamic();
  if (limit) query = query.limit(limit);

  const rows = await query;
  return rows.map(mapExpiryRiskToEvent);
}
