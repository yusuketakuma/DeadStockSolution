import { and, desc, eq, gte, inArray, isNotNull, lte, ne, or } from 'drizzle-orm';
import {
  notifications as notificationsTable,
  matchNotifications,
  exchangeProposals,
  proposalComments,
  exchangeFeedback,
  uploads,
  adminMessages,
  adminMessageReads,
  exchangeHistory,
  deadStockItems,
} from '../db/schema';
import { type DbClient, type RawTimelineEvent, toTimelineEventType } from '../types/timeline';

// ── マッピング関数（テスト可能な純粋関数として分離） ──────

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

export function mapNotificationToEvent(row: {
  id: number;
  type: string;
  title: string;
  message: string;
  referenceType: string | null;
  referenceId: number | null;
  isRead: boolean;
  createdAt: string | null;
}): RawTimelineEvent {
  let actionPath = '/';
  if (row.referenceType === 'proposal' && row.referenceId) {
    actionPath = `/proposals/${row.referenceId}`;
  } else if (row.referenceType === 'match') {
    actionPath = '/matching';
  }

  return {
    id: `notification_${row.id}`,
    source: 'notification',
    type: toTimelineEventType(row.type),
    title: row.title,
    body: row.message,
    timestamp: resolveEventTimestamp(row.createdAt),
    isRead: row.isRead,
    actionPath,
    metadata: {
      referenceType: row.referenceType,
      referenceId: row.referenceId,
    },
  };
}

export function mapMatchNotificationToEvent(row: {
  id: number;
  candidateCountBefore: number;
  candidateCountAfter: number;
  isRead: boolean;
  createdAt: string | null;
}): RawTimelineEvent {
  const diff = row.candidateCountAfter - row.candidateCountBefore;
  const diffLabel = diff >= 0 ? `+${diff}` : `${diff}`;

  return {
    id: `match_${row.id}`,
    source: 'match',
    type: 'match_update',
    title: 'マッチング候補が更新されました',
    body: `候補数が ${row.candidateCountBefore}件 から ${row.candidateCountAfter}件 に変わりました（${diffLabel}）`,
    timestamp: resolveEventTimestamp(row.createdAt),
    isRead: row.isRead,
    actionPath: '/matching',
    metadata: {
      candidateCountBefore: row.candidateCountBefore,
      candidateCountAfter: row.candidateCountAfter,
    },
  };
}

export function mapProposalToEvent(
  row: {
    id: number;
    pharmacyAId: number;
    pharmacyBId: number;
    status: string;
    proposedAt: string | null;
    completedAt: string | null;
  },
  pharmacyId: number,
): RawTimelineEvent {
  const isInbound = row.pharmacyBId === pharmacyId;
  const isRequester = !isInbound;
  const roleLabel = isInbound ? '受信' : '送信済み';

  return {
    id: `proposal_${row.id}`,
    source: 'proposal',
    type: toTimelineEventType(`proposal_${row.status}`),
    title: `仮マッチング（${roleLabel}）: ${row.status}`,
    body: `マッチング #${row.id} のステータスは「${row.status}」です。`,
    timestamp: resolveEventTimestamp(row.proposedAt),
    isRead: false,
    actionPath: `/proposals/${row.id}`,
    metadata: {
      proposalId: row.id,
      status: row.status,
      isInbound,
      completedAt: row.completedAt,
      // 後方互換: 既存 UI/テスト期待を崩さないため残置
      isRequester,
    },
  };
}

export function mapCommentToEvent(row: {
  id: number;
  proposalId: number;
  body: string;
  readByRecipient: boolean;
  createdAt: string | null;
}): RawTimelineEvent {
  const bodyPreview = row.body.length > 80 ? `${row.body.slice(0, 80)}…` : row.body;

  return {
    id: `comment_${row.id}`,
    source: 'comment',
    type: 'new_comment',
    title: '提案にコメントが届きました',
    body: bodyPreview,
    timestamp: resolveEventTimestamp(row.createdAt),
    isRead: row.readByRecipient,
    actionPath: `/proposals/${row.proposalId}`,
    metadata: {
      proposalId: row.proposalId,
    },
  };
}

export function mapFeedbackToEvent(row: {
  id: number;
  proposalId: number;
  rating: number;
  comment: string | null;
  createdAt: string | null;
}): RawTimelineEvent {
  const ratingLabel = `★${row.rating}`;
  const bodyText = row.comment
    ? `評価: ${ratingLabel} / コメント: ${row.comment}`
    : `評価: ${ratingLabel}`;

  return {
    id: `feedback_${row.id}`,
    source: 'feedback',
    type: 'exchange_feedback',
    title: '取引フィードバックが届きました',
    body: bodyText,
    timestamp: resolveEventTimestamp(row.createdAt),
    isRead: false,
    actionPath: `/proposals/${row.proposalId}`,
    metadata: {
      proposalId: row.proposalId,
      rating: row.rating,
    },
  };
}

export function mapUploadToEvent(row: {
  id: number;
  uploadType: string;
  originalFilename: string;
  createdAt: string | null;
}): RawTimelineEvent {
  const typeLabel = row.uploadType === 'dead_stock' ? 'デッドストック' : '使用量';

  return {
    id: `upload_${row.id}`,
    source: 'upload',
    type: toTimelineEventType(`upload_${row.uploadType}`),
    title: `${typeLabel}データをアップロードしました`,
    body: `ファイル: ${row.originalFilename}`,
    timestamp: resolveEventTimestamp(row.createdAt),
    isRead: true,
    actionPath: '/upload',
    metadata: {
      uploadType: row.uploadType,
      originalFilename: row.originalFilename,
    },
  };
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

/** 期限リスク判定用の日付範囲（今日〜3日後）を返す */
export function getExpiryDateRange(): { todayStr: string; threeDaysLaterStr: string } {
  const today = new Date();
  const threeDaysLater = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000);
  return {
    todayStr: today.toISOString().split('T')[0],
    threeDaysLaterStr: threeDaysLater.toISOString().split('T')[0],
  };
}

// ── fetcher 関数 ────────────────────────────────────────

export async function fetchNotificationEvents(
  db: DbClient,
  pharmacyId: number,
  since?: string,
  limit?: number,
  before?: string,
): Promise<RawTimelineEvent[]> {
  const conditions = [eq(notificationsTable.pharmacyId, pharmacyId)];
  appendDateRangeConditions(
    conditions,
    since,
    before,
    (value) => gte(notificationsTable.createdAt, value),
    (value) => lte(notificationsTable.createdAt, value),
  );

  let query = db
    .select({
      id: notificationsTable.id,
      type: notificationsTable.type,
      title: notificationsTable.title,
      message: notificationsTable.message,
      referenceType: notificationsTable.referenceType,
      referenceId: notificationsTable.referenceId,
      isRead: notificationsTable.isRead,
      createdAt: notificationsTable.createdAt,
    })
    .from(notificationsTable)
    .where(and(...conditions))
    .orderBy(desc(notificationsTable.createdAt));
  if (limit) query = query.limit(limit);

  const rows = await query;
  return rows.map(mapNotificationToEvent);
}

export async function fetchMatchEvents(
  db: DbClient,
  pharmacyId: number,
  since?: string,
  limit?: number,
  before?: string,
): Promise<RawTimelineEvent[]> {
  const conditions = [eq(matchNotifications.pharmacyId, pharmacyId)];
  appendDateRangeConditions(
    conditions,
    since,
    before,
    (value) => gte(matchNotifications.createdAt, value),
    (value) => lte(matchNotifications.createdAt, value),
  );

  let query = db
    .select({
      id: matchNotifications.id,
      candidateCountBefore: matchNotifications.candidateCountBefore,
      candidateCountAfter: matchNotifications.candidateCountAfter,
      isRead: matchNotifications.isRead,
      createdAt: matchNotifications.createdAt,
    })
    .from(matchNotifications)
    .where(and(...conditions))
    .orderBy(desc(matchNotifications.createdAt));
  if (limit) query = query.limit(limit);

  const rows = await query;
  return rows.map(mapMatchNotificationToEvent);
}

export async function fetchProposalEvents(
  db: DbClient,
  pharmacyId: number,
  since?: string,
  limit?: number,
  before?: string,
): Promise<RawTimelineEvent[]> {
  const conditions = [
    eq(exchangeProposals.pharmacyAId, pharmacyId),
    eq(exchangeProposals.pharmacyBId, pharmacyId),
  ];
  const ownershipCondition = or(...conditions);
  const whereConditions = [ownershipCondition];
  appendDateRangeConditions(
    whereConditions,
    since,
    before,
    (value) => gte(exchangeProposals.proposedAt, value),
    (value) => lte(exchangeProposals.proposedAt, value),
  );

  let query = db
    .select({
      id: exchangeProposals.id,
      pharmacyAId: exchangeProposals.pharmacyAId,
      pharmacyBId: exchangeProposals.pharmacyBId,
      status: exchangeProposals.status,
      proposedAt: exchangeProposals.proposedAt,
      completedAt: exchangeProposals.completedAt,
    })
    .from(exchangeProposals)
    .where(and(...whereConditions))
    .orderBy(desc(exchangeProposals.proposedAt));
  if (limit) query = query.limit(limit);

  const rows = await query;
  return rows.map((row: typeof rows[number]) => mapProposalToEvent(row, pharmacyId));
}

export async function fetchCommentEvents(
  db: DbClient,
  pharmacyId: number,
  since?: string,
  limit?: number,
  before?: string,
): Promise<RawTimelineEvent[]> {
  const conditions = [
    eq(proposalComments.isDeleted, false),
    ne(proposalComments.authorPharmacyId, pharmacyId),
    or(
      eq(exchangeProposals.pharmacyAId, pharmacyId),
      eq(exchangeProposals.pharmacyBId, pharmacyId),
    ),
  ];
  appendDateRangeConditions(
    conditions,
    since,
    before,
    (value) => gte(proposalComments.createdAt, value),
    (value) => lte(proposalComments.createdAt, value),
  );

  let query = db
    .select({
      id: proposalComments.id,
      proposalId: proposalComments.proposalId,
      body: proposalComments.body,
      readByRecipient: proposalComments.readByRecipient,
      createdAt: proposalComments.createdAt,
    })
    .from(proposalComments)
    .innerJoin(
      exchangeProposals,
      eq(proposalComments.proposalId, exchangeProposals.id),
    )
    .where(and(...conditions))
    .orderBy(desc(proposalComments.createdAt));
  if (limit) query = query.limit(limit);

  const rows = await query;
  return rows.map(mapCommentToEvent);
}

export async function fetchFeedbackEvents(
  db: DbClient,
  pharmacyId: number,
  since?: string,
  limit?: number,
  before?: string,
): Promise<RawTimelineEvent[]> {
  const conditions = [eq(exchangeFeedback.toPharmacyId, pharmacyId)];
  appendDateRangeConditions(
    conditions,
    since,
    before,
    (value) => gte(exchangeFeedback.createdAt, value),
    (value) => lte(exchangeFeedback.createdAt, value),
  );

  let query = db
    .select({
      id: exchangeFeedback.id,
      proposalId: exchangeFeedback.proposalId,
      rating: exchangeFeedback.rating,
      comment: exchangeFeedback.comment,
      createdAt: exchangeFeedback.createdAt,
    })
    .from(exchangeFeedback)
    .where(and(...conditions))
    .orderBy(desc(exchangeFeedback.createdAt));
  if (limit) query = query.limit(limit);

  const rows = await query;
  return rows.map(mapFeedbackToEvent);
}

export async function fetchUploadEvents(
  db: DbClient,
  pharmacyId: number,
  since?: string,
  limit?: number,
  before?: string,
): Promise<RawTimelineEvent[]> {
  const conditions = [eq(uploads.pharmacyId, pharmacyId)];
  appendDateRangeConditions(
    conditions,
    since,
    before,
    (value) => gte(uploads.createdAt, value),
    (value) => lte(uploads.createdAt, value),
  );

  let query = db
    .select({
      id: uploads.id,
      uploadType: uploads.uploadType,
      originalFilename: uploads.originalFilename,
      createdAt: uploads.createdAt,
    })
    .from(uploads)
    .where(and(...conditions))
    .orderBy(desc(uploads.createdAt));
  if (limit) query = query.limit(limit);

  const rows = await query;
  return rows.map(mapUploadToEvent);
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

  // 全体向け + 自薬局向けを並列取得（limit は各サブクエリで半分ずつ割り当て）
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
    .orderBy(desc(adminMessages.createdAt));
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
    .orderBy(desc(adminMessages.createdAt));
  if (subLimit) pharmacyQuery = pharmacyQuery.limit(subLimit);

  const [allMessages, pharmacyMessages] = await Promise.all([allQuery, pharmacyQuery]);

  // 重複排除してマージ
  const merged = dedupeRowsById<AdminMessageRow>([...allMessages, ...pharmacyMessages]);

  if (merged.length === 0) return [];

  // 既読状態を adminMessageReads から取得
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
  const ownershipCondition = or(
    eq(exchangeHistory.pharmacyAId, pharmacyId),
    eq(exchangeHistory.pharmacyBId, pharmacyId),
  );
  const conditions = [ownershipCondition];
  appendDateRangeConditions(
    conditions,
    since,
    before,
    (value) => gte(exchangeHistory.completedAt, value),
    (value) => lte(exchangeHistory.completedAt, value),
  );

  let query = db
    .select({
      id: exchangeHistory.id,
      proposalId: exchangeHistory.proposalId,
      pharmacyAId: exchangeHistory.pharmacyAId,
      pharmacyBId: exchangeHistory.pharmacyBId,
      totalValue: exchangeHistory.totalValue,
      completedAt: exchangeHistory.completedAt,
    })
    .from(exchangeHistory)
    .where(and(...conditions))
    .orderBy(desc(exchangeHistory.completedAt));
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
  // 今日から3日以内に期限が切れる在庫を取得
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
    .orderBy(desc(deadStockItems.createdAt));
  if (limit) query = query.limit(limit);

  const rows = await query;
  return rows.map(mapExpiryRiskToEvent);
}
