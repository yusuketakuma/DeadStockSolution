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
    timestamp: row.createdAt ?? new Date().toISOString(),
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
    timestamp: row.createdAt ?? new Date().toISOString(),
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
    timestamp: row.proposedAt ?? new Date().toISOString(),
    isRead: false,
    actionPath: `/proposals/${row.id}`,
    metadata: {
      proposalId: row.id,
      status: row.status,
      isInbound,
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
    timestamp: row.createdAt ?? new Date().toISOString(),
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
    timestamp: row.createdAt ?? new Date().toISOString(),
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
    timestamp: row.createdAt ?? new Date().toISOString(),
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
    timestamp: row.createdAt ?? new Date().toISOString(),
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
    timestamp: row.completedAt ?? new Date().toISOString(),
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
    timestamp: row.createdAt ?? new Date().toISOString(),
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
  if (since) {
    conditions.push(gte(notificationsTable.createdAt, since));
  }
  if (before) {
    conditions.push(lte(notificationsTable.createdAt, before));
  }

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
  if (since) {
    conditions.push(gte(matchNotifications.createdAt, since));
  }
  if (before) {
    conditions.push(lte(matchNotifications.createdAt, before));
  }

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
  if (since) {
    whereConditions.push(gte(exchangeProposals.proposedAt, since));
  }
  if (before) {
    whereConditions.push(lte(exchangeProposals.proposedAt, before));
  }

  let query = db
    .select({
      id: exchangeProposals.id,
      pharmacyAId: exchangeProposals.pharmacyAId,
      pharmacyBId: exchangeProposals.pharmacyBId,
      status: exchangeProposals.status,
      proposedAt: exchangeProposals.proposedAt,
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
  if (since) {
    conditions.push(gte(proposalComments.createdAt, since));
  }
  if (before) {
    conditions.push(lte(proposalComments.createdAt, before));
  }

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
  if (since) {
    conditions.push(gte(exchangeFeedback.createdAt, since));
  }
  if (before) {
    conditions.push(lte(exchangeFeedback.createdAt, before));
  }

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
  if (since) {
    conditions.push(gte(uploads.createdAt, since));
  }
  if (before) {
    conditions.push(lte(uploads.createdAt, before));
  }

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
  const seen = new Set<number>();
  const merged: Array<{ id: number; title: string; body: string; createdAt: string | null }> = [];
  for (const row of [...allMessages, ...pharmacyMessages]) {
    if (!seen.has(row.id)) {
      seen.add(row.id);
      merged.push(row);
    }
  }

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
  if (since) {
    conditions.push(gte(exchangeHistory.completedAt, since));
  }
  if (before) {
    conditions.push(lte(exchangeHistory.completedAt, before));
  }

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
  if (before) {
    conditions.push(lte(deadStockItems.createdAt, before));
  }

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
    .orderBy(deadStockItems.expirationDateIso);
  if (limit) query = query.limit(limit);

  const rows = await query;
  return rows.map(mapExpiryRiskToEvent);
}
