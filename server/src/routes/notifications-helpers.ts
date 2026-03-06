import { decodeCursor, encodeCursor } from '../utils/cursor-pagination';
import { sanitizeInternalPath } from '../utils/path-utils';
import { logger } from '../services/logger';
import { isPositiveSafeInteger } from '../utils/request-utils';

// ============================================================================
// Types
// ============================================================================

export type NoticeType = 'inbound_request' | 'outbound_request' | 'status_update' | 'admin_message' | 'match_update' | 'new_comment';

export interface NoticeItem {
  id: string;
  type: NoticeType;
  title: string;
  body: string;
  actionPath: string;
  actionLabel: string;
  createdAt: string | null;
  deadlineAt: string | null;
  unread: boolean;
  priority: number;
}

export interface NoticeCursor {
  id: string;
  priority: number;
  createdAt: string | null;
}

export interface MatchDiffJson {
  addedPharmacyIds?: unknown;
  removedPharmacyIds?: unknown;
  beforeCount?: unknown;
  afterCount?: unknown;
}

export interface PostgresErrorLike {
  code?: string;
}

export interface ProposalNotificationLink {
  id: number;
  isRead: boolean;
  createdAt: string | null;
}

export interface AdminMessageRow {
  id: number;
  title: string;
  body: string;
  actionPath: string | null;
  createdAt: string | null;
}

export interface ProposalRow {
  id: number;
  pharmacyAId: number;
  pharmacyBId: number;
  status: string;
  proposedAt: string | null;
}

export interface NotificationRowForProposalLink {
  id: number;
  type: string;
  referenceType: string | null;
  referenceId: number | null;
  isRead: boolean;
  createdAt: string | null;
}

export interface NotificationNoticeRow extends NotificationRowForProposalLink {
  title: string;
  message: string;
}

// ============================================================================
// Constants
// ============================================================================

export const PROPOSAL_RESPONSE_DEADLINE_HOURS = 72;
export const NOTICE_RESULT_LIMIT = 20;
export const SOURCE_NOTICE_FETCH_LIMIT = 30;
export const PROPOSAL_NOTICE_LIMIT = SOURCE_NOTICE_FETCH_LIMIT;
export const PROPOSAL_NOTICE_STATUSES = ['proposed', 'accepted_a', 'accepted_b', 'confirmed'] as const;
export const PROPOSAL_EVENT_NOTIFICATION_TYPES = new Set(['proposal_received', 'proposal_status_changed']);
export const MATCH_NOTICE_LIMIT = SOURCE_NOTICE_FETCH_LIMIT;
export const MAX_NOTICE_PAGE_LIMIT = 50;

// ============================================================================
// Type Guards & Validators
// ============================================================================

export function isUndefinedTableError(err: unknown): err is PostgresErrorLike {
  return typeof err === 'object' && err !== null && (err as PostgresErrorLike).code === '42P01';
}

export function parseNumericList(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((value) => Number(value))
    .filter(isPositiveSafeInteger);
}

export function parseNoticeCursor(raw: unknown): NoticeCursor | null {
  const cursor = decodeCursor<NoticeCursor>(raw);
  if (!cursor) return null;
  if (typeof cursor.id !== 'string' || cursor.id.length === 0) return null;
  if (!Number.isInteger(cursor.priority) || cursor.priority < 0) return null;
  if (cursor.createdAt !== null && typeof cursor.createdAt !== 'string') return null;
  return cursor;
}

export function resolveNotificationType(type: string): NoticeType | null {
  if (type === 'new_comment') return 'new_comment';
  if (type === 'proposal_received' || type === 'proposal_status_changed' || type === 'request_update') return 'status_update';
  return null;
}

// ============================================================================
// Formatters & Builders
// ============================================================================

export function parseMatchDiff(raw: string): { addedCount: number; removedCount: number } {
  try {
    const parsed = JSON.parse(raw) as MatchDiffJson;
    const addedCount = parseNumericList(parsed.addedPharmacyIds).length;
    const removedCount = parseNumericList(parsed.removedPharmacyIds).length;
    return { addedCount, removedCount };
  } catch {
    return { addedCount: 0, removedCount: 0 };
  }
}

export function buildProposalDeadlineAt(proposedAt: string | null): string | null {
  if (!proposedAt) return null;
  const proposedAtMs = new Date(proposedAt).getTime();
  if (!Number.isFinite(proposedAtMs)) return null;
  const deadlineMs = proposedAtMs + (PROPOSAL_RESPONSE_DEADLINE_HOURS * 60 * 60 * 1000);
  return new Date(deadlineMs).toISOString();
}

export function timestampSortValue(timestamp: string | null): number {
  if (timestamp === null) return Number.NEGATIVE_INFINITY;
  const value = Date.parse(timestamp);
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

export function buildLatestProposalNotificationMap(
  notificationRows: NotificationRowForProposalLink[],
): Map<number, ProposalNotificationLink> {
  const latestById = new Map<number, ProposalNotificationLink>();
  for (const row of notificationRows) {
    if (row.referenceType !== 'proposal') continue;
    if (!PROPOSAL_EVENT_NOTIFICATION_TYPES.has(row.type)) continue;
    if (!row.referenceId || row.referenceId <= 0) continue;
    if (latestById.has(row.referenceId)) continue;
    latestById.set(row.referenceId, {
      id: row.id,
      isRead: row.isRead,
      createdAt: row.createdAt,
    });
  }
  return latestById;
}

export function toAdminMessageNotice(message: AdminMessageRow, unread: boolean): NoticeItem {
  const actionPath = sanitizeInternalPath(message.actionPath) ?? '/';
  return {
    id: `message-${message.id}`,
    type: 'admin_message',
    title: `管理者: ${message.title}`,
    body: message.body,
    actionPath,
    actionLabel: actionPath === '/' ? 'ダッシュボードへ' : '内容を確認',
    createdAt: message.createdAt,
    deadlineAt: null,
    unread,
    priority: unread ? 1 : 4,
  };
}

export function resolveNotificationActionPath(referenceType: string | null, referenceId: number | null): string {
  if (referenceType === 'match') return '/matching';
  if ((referenceType === 'proposal' || referenceType === 'comment') && referenceId) {
    return `/proposals/${referenceId}`;
  }
  if (referenceType === 'request') return '/';
  return '/';
}

export function notificationToNotice(n: NotificationNoticeRow): NoticeItem | null {
  const noticeType = resolveNotificationType(n.type);
  if (!noticeType) {
    logger.warn('Unsupported notification type skipped', { type: n.type, id: n.id });
    return null;
  }

  return {
    id: `notification-${n.id}`,
    type: noticeType,
    title: n.title,
    body: n.message,
    actionPath: resolveNotificationActionPath(n.referenceType, n.referenceId),
    actionLabel: '確認する',
    createdAt: n.createdAt,
    deadlineAt: null,
    unread: !n.isRead,
    priority: n.isRead ? 5 : 3,
  };
}

export function matchUpdateNotice(row: {
  id: number;
  triggerPharmacyId: number;
  triggerUploadType: 'dead_stock' | 'used_medication';
  candidateCountBefore: number;
  candidateCountAfter: number;
  diffJson: string;
  createdAt: string | null;
  isRead: boolean;
}, currentPharmacyId: number, triggerPharmacyName: string | null): NoticeItem {
  const uploadTypeLabel = row.triggerUploadType === 'dead_stock' ? 'デッドストック' : '使用量';
  const triggerLabel = row.triggerPharmacyId === currentPharmacyId
    ? '自薬局'
    : (triggerPharmacyName ?? `薬局 #${row.triggerPharmacyId}`);
  const { addedCount, removedCount } = parseMatchDiff(row.diffJson);

  return {
    id: `match-${row.id}`,
    type: 'match_update',
    title: `${triggerLabel}の${uploadTypeLabel}更新で候補が更新されました`,
    body: `候補数 ${row.candidateCountBefore}件 → ${row.candidateCountAfter}件（追加 ${addedCount} / 除外 ${removedCount}）`,
    actionPath: '/matching',
    actionLabel: '候補を確認',
    createdAt: row.createdAt,
    deadlineAt: null,
    unread: !row.isRead,
    priority: row.isRead ? 4 : 2,
  };
}

export function proposalActionNotice(proposal: {
  id: number;
  pharmacyAId: number;
  pharmacyBId: number;
  status: string;
  proposedAt: string | null;
}, currentPharmacyId: number, linkedNotification?: {
  id: number;
  isRead: boolean;
  createdAt: string | null;
}): NoticeItem | null {
  const isA = proposal.pharmacyAId === currentPharmacyId;
  const actionPath = `/proposals/${proposal.id}`;
  const deadlineAt = buildProposalDeadlineAt(proposal.proposedAt);
  const linkedId = linkedNotification ? `notification-${linkedNotification.id}` : null;
  const linkedCreatedAt = linkedNotification?.createdAt ?? proposal.proposedAt;
  const linkedUnread = linkedNotification ? !linkedNotification.isRead : true;

  if (proposal.status === 'proposed') {
    if (isA) {
      return {
        id: linkedId ?? `proposal-${proposal.id}-outbound`,
        type: 'outbound_request',
        title: '仮マッチングを送信済みです',
        body: `マッチング #${proposal.id} の相手薬局承認待ちです。`,
        actionPath,
        actionLabel: '詳細へ',
        createdAt: linkedCreatedAt,
        deadlineAt,
        unread: linkedNotification ? linkedUnread : false,
        priority: 3,
      };
    }
    return {
      id: linkedId ?? `proposal-${proposal.id}-inbound`,
      type: 'inbound_request',
      title: '仮マッチングが届いています',
      body: `マッチング #${proposal.id} を確認し、承認または拒否してください。`,
      actionPath,
      actionLabel: '承認/拒否を行う',
      createdAt: linkedCreatedAt,
      deadlineAt,
      unread: linkedUnread,
      priority: 1,
    };
  }

  if ((proposal.status === 'accepted_a' && !isA) || (proposal.status === 'accepted_b' && isA)) {
    return {
      id: linkedId ?? `proposal-${proposal.id}-pending-my-approval`,
      type: 'inbound_request',
      title: '相手承認済みの仮マッチングがあります',
      body: `マッチング #${proposal.id} はあなたの承認待ちです。`,
      actionPath,
      actionLabel: '承認する',
      createdAt: linkedCreatedAt,
      deadlineAt,
      unread: linkedUnread,
      priority: 1,
    };
  }

  if (proposal.status === 'confirmed') {
    return {
      id: linkedId ?? `proposal-${proposal.id}-confirmed`,
      type: 'status_update',
      title: 'マッチングが確定しました',
      body: `マッチング #${proposal.id} の受け渡し後、交換完了を実行してください。`,
      actionPath,
      actionLabel: '交換完了へ進む',
      createdAt: linkedCreatedAt,
      deadlineAt: null,
      unread: linkedUnread,
      priority: 2,
    };
  }

  return null;
}

// ============================================================================
// Sorting & Pagination
// ============================================================================

export function compareNoticeOrder(a: NoticeItem, b: NoticeItem): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  const aTime = timestampSortValue(a.createdAt);
  const bTime = timestampSortValue(b.createdAt);
  if (aTime !== bTime) return bTime - aTime;
  return a.id.localeCompare(b.id);
}

export function resolveNoticeStartIndex(notices: NoticeItem[], cursor: NoticeCursor | null): number {
  if (!cursor) return 0;
  const exactIndex = notices.findIndex((notice) => notice.id === cursor.id);
  if (exactIndex >= 0) return exactIndex + 1;

  const cursorTime = timestampSortValue(cursor.createdAt);
  const fallback = notices.findIndex((notice) => {
    if (notice.priority > cursor.priority) return true;
    if (notice.priority < cursor.priority) return false;

    const noticeTime = timestampSortValue(notice.createdAt);
    if (noticeTime < cursorTime) return true;
    if (noticeTime > cursorTime) return false;
    return notice.id.localeCompare(cursor.id) > 0;
  });
  return fallback >= 0 ? fallback : notices.length;
}

export function buildNoticeSummary(notices: NoticeItem[]): { unreadMessages: number; actionableRequests: number } {
  let unreadMessages = 0;
  let actionableRequests = 0;
  for (const item of notices) {
    if (item.type === 'admin_message' && item.unread) {
      unreadMessages += 1;
    }
    if (item.unread && (item.type === 'inbound_request' || item.type === 'status_update' || item.type === 'match_update')) {
      actionableRequests += 1;
    }
  }
  return { unreadMessages, actionableRequests };
}

export function mergeDedupSortByTimestamp<T extends { id: number }>(
  branchA: T[],
  branchB: T[],
  getTimestamp: (row: T) => string | null,
  limit?: number,
): T[] {
  const merged: T[] = [];
  const seen = new Set<number>();
  let indexA = 0;
  let indexB = 0;

  const shouldPreferA = (left: T | undefined, right: T | undefined): boolean => {
    if (left && !right) return true;
    if (!left) return false;
    if (!right) return true;
    const leftSort = timestampSortValue(getTimestamp(left));
    const rightSort = timestampSortValue(getTimestamp(right));
    if (leftSort !== rightSort) return leftSort > rightSort;
    return left.id > right.id;
  };

  while (indexA < branchA.length || indexB < branchB.length) {
    const rowA = branchA[indexA];
    const rowB = branchB[indexB];
    const useA = shouldPreferA(rowA, rowB);
    const picked = useA ? rowA : rowB;

    if (useA) {
      indexA += 1;
    } else {
      indexB += 1;
    }

    if (!picked || seen.has(picked.id)) continue;
    seen.add(picked.id);
    merged.push(picked);
    if (limit && merged.length >= limit) break;
  }

  return merged;
}

// ============================================================================
// Cursor Encoding
// ============================================================================

export function encodeNoticeCursor(cursor: NoticeCursor): string {
  return encodeCursor<NoticeCursor>(cursor);
}
