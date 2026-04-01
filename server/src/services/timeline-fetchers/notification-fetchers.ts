import { and, desc, eq, gte, lte, ne, notInArray, or } from 'drizzle-orm';
import {
  matchNotifications,
  notifications as notificationsTable,
  exchangeProposals,
  proposalComments,
  exchangeFeedback,
} from '../../db/schema';
import { type DbClient, type RawTimelineEvent } from '../../types/timeline';
import { toTimelineEventType } from '../../utils/timeline-utils';
import {
  TIMELINE_SEPARATE_NOTIFICATION_TYPES,
  filterNotificationRowsForTimeline,
} from '../timeline-notification-rules';

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
  } else if (row.referenceType === 'alert') {
    actionPath = '/alerts';
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

export async function fetchNotificationEvents(
  db: DbClient,
  pharmacyId: number,
  since?: string,
  limit?: number,
  before?: string,
): Promise<RawTimelineEvent[]> {
  const conditions = [
    eq(notificationsTable.pharmacyId, pharmacyId),
    notInArray(notificationsTable.type, TIMELINE_SEPARATE_NOTIFICATION_TYPES),
  ];
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
    .orderBy(desc(notificationsTable.createdAt))
    .$dynamic();
  if (limit) query = query.limit(limit);

  const rows = filterNotificationRowsForTimeline(await query);
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
    .orderBy(desc(matchNotifications.createdAt))
    .$dynamic();
  if (limit) query = query.limit(limit);

  const rows = await query;
  return rows.map((row: typeof rows[number]) => mapMatchNotificationToEvent({
    id: row.id,
    candidateCountBefore: row.candidateCountBefore ?? 0,
    candidateCountAfter: row.candidateCountAfter ?? 0,
    isRead: row.isRead,
    createdAt: row.createdAt,
  }));
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
    .orderBy(desc(exchangeProposals.proposedAt))
    .$dynamic();
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
    .orderBy(desc(proposalComments.createdAt))
    .$dynamic();
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
    .orderBy(desc(exchangeFeedback.createdAt))
    .$dynamic();
  if (limit) query = query.limit(limit);

  const rows = await query;
  return rows.map(mapFeedbackToEvent);
}
