import { Router, Response } from 'express';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../config/database';
import { requireLogin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { adminMessages, adminMessageReads, exchangeProposals, matchNotifications, notificationGroupStates, pharmacies, notifications as notificationsTable } from '../db/schema';
import { parsePositiveInt } from '../utils/request-utils';
import { sanitizeInternalPath } from '../utils/path-utils';
import { logger } from '../services/logger';
import { decodeCursor, encodeCursor } from '../utils/cursor-pagination';
import {
  getDashboardUnreadCount,
  invalidateDashboardUnreadCache,
  markAsRead,
  markAllDashboardAsRead,
} from '../services/notification-service';
import { isUnreadByLastViewedAt } from '../services/notification-helper-service';
import { publishTimelineRefresh } from '../services/realtime-service';

type NoticeType = 'inbound_request' | 'outbound_request' | 'status_update' | 'admin_message' | 'match_update' | 'new_comment' | 'alert';

interface NoticeItem {
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

const PROPOSAL_RESPONSE_DEADLINE_HOURS = 72;
const NOTICE_RESULT_LIMIT = 20;
const SOURCE_NOTICE_FETCH_LIMIT = 30;
const PROPOSAL_NOTICE_LIMIT = SOURCE_NOTICE_FETCH_LIMIT;
const PROPOSAL_NOTICE_STATUSES = ['proposed', 'accepted_a', 'accepted_b', 'confirmed'] as const;
const PROPOSAL_EVENT_NOTIFICATION_TYPES = new Set(['proposal_received', 'proposal_status_changed']);
const MATCH_NOTICE_LIMIT = SOURCE_NOTICE_FETCH_LIMIT;
const MAX_NOTICE_PAGE_LIMIT = 50;

interface NoticeCursor {
  id: string;
  priority: number;
  createdAt: string | null;
}

interface MatchDiffJson {
  addedPharmacyIds?: unknown;
  removedPharmacyIds?: unknown;
  beforeCount?: unknown;
  afterCount?: unknown;
}

interface PostgresErrorLike {
  code?: string;
}

function isUndefinedTableError(err: unknown): err is PostgresErrorLike {
  return typeof err === 'object' && err !== null && (err as PostgresErrorLike).code === '42P01';
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function parseNumericList(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function parseMatchDiff(raw: string): { addedCount: number; removedCount: number } {
  try {
    const parsed = JSON.parse(raw) as MatchDiffJson;
    const addedCount = parseNumericList(parsed.addedPharmacyIds).length;
    const removedCount = parseNumericList(parsed.removedPharmacyIds).length;
    return { addedCount, removedCount };
  } catch {
    return { addedCount: 0, removedCount: 0 };
  }
}

function matchUpdateNotice(row: {
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

function buildProposalDeadlineAt(proposedAt: string | null): string | null {
  if (!proposedAt) return null;
  const proposedAtMs = new Date(proposedAt).getTime();
  if (!Number.isFinite(proposedAtMs)) return null;
  const deadlineMs = proposedAtMs + (PROPOSAL_RESPONSE_DEADLINE_HOURS * 60 * 60 * 1000);
  return new Date(deadlineMs).toISOString();
}

function proposalActionNotice(proposal: {
  id: number;
  pharmacyAId: number;
  pharmacyBId: number;
  status: string;
  proposedAt: string | null;
}, currentPharmacyId: number, linkedNotification?: {
  id: number;
  isRead: boolean;
  createdAt: string | null;
}, lastTimelineViewedAt?: string | null): NoticeItem | null {
  const isA = proposal.pharmacyAId === currentPharmacyId;
  const actionPath = `/proposals/${proposal.id}`;
  const deadlineAt = buildProposalDeadlineAt(proposal.proposedAt);
  const linkedId = linkedNotification ? `notification-${linkedNotification.id}` : null;
  const linkedCreatedAt = linkedNotification?.createdAt ?? proposal.proposedAt;
  const linkedUnread = linkedNotification
    ? !linkedNotification.isRead
    : isUnreadByLastViewedAt(proposal.proposedAt, lastTimelineViewedAt);

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

function timestampSortValue(timestamp: string | null): number {
  if (timestamp === null) return Number.NEGATIVE_INFINITY;
  const value = Date.parse(timestamp);
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

function compareNoticeOrder(a: NoticeItem, b: NoticeItem): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  const aTime = timestampSortValue(a.createdAt);
  const bTime = timestampSortValue(b.createdAt);
  if (aTime !== bTime) return bTime - aTime;
  return a.id.localeCompare(b.id);
}

function applyGroupStateToNotice(
  notice: NoticeItem,
  groupState: { snoozedUntil: string | null; lastReadAt: string | null } | undefined,
): NoticeItem | null {
  if (!groupState) return notice;
  if (groupState.snoozedUntil && Date.parse(groupState.snoozedUntil) > Date.now()) {
    return null;
  }
  if (groupState.lastReadAt && notice.createdAt && Date.parse(notice.createdAt) <= Date.parse(groupState.lastReadAt)) {
    return { ...notice, unread: false };
  }
  return notice;
}

function buildGroupedCases(notices: NoticeItem[]): Array<{
  actionPath: string;
  latest: NoticeItem;
  count: number;
  unreadCount: number;
  types: string[];
}> {
  const groups = new Map<string, NoticeItem[]>();
  for (const notice of notices) {
    const key = notice.actionPath;
    const current = groups.get(key) ?? [];
    current.push(notice);
    groups.set(key, current);
  }

  return [...groups.entries()]
    .map(([actionPath, rows]) => {
      const sorted = [...rows].sort(compareNoticeOrder);
      const latest = sorted[0];
      return {
        actionPath,
        latest,
        count: rows.length,
        unreadCount: rows.filter((row) => row.unread).length,
        types: [...new Set(rows.map((row) => row.type))],
      };
    })
    .sort((left, right) => right.count - left.count || compareNoticeOrder(left.latest, right.latest))
    .slice(0, 10);
}

function parseNoticeCursor(raw: unknown): NoticeCursor | null {
  const cursor = decodeCursor<NoticeCursor>(raw);
  if (!cursor) return null;
  if (typeof cursor.id !== 'string' || cursor.id.length === 0) return null;
  if (!Number.isInteger(cursor.priority) || cursor.priority < 0) return null;
  if (cursor.createdAt !== null && typeof cursor.createdAt !== 'string') return null;
  return cursor;
}

function mergeDedupSortByTimestamp<T extends { id: number }>(
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

function resolveNotificationType(type: string): NoticeType | null {
  if (type === 'new_comment') return 'new_comment';
  if (type === 'alert_near_expiry' || type === 'alert_excess_stock' || type === 'alert_resolved') return 'alert';
  if (type === 'matching_refresh_complete') return 'match_update';
  if (type === 'group_invitation' || type === 'group_join' || type === 'group_leave') return 'status_update';
  if (type === 'proposal_received' || type === 'proposal_status_changed' || type === 'request_update') return 'status_update';
  return null;
}

function resolveNotificationActionLabel(noticeType: NoticeType, notificationType?: string | null): string {
  if (noticeType === 'alert') return 'アラートを確認';
  if (noticeType === 'match_update') return '候補を見る';
  if (notificationType === 'group_invitation') {
    return '招待を確認';
  }
  if (notificationType === 'group_join' || notificationType === 'group_leave') {
    return 'グループを見る';
  }
  if (notificationType === 'request_update') return '要望を見る';
  return '確認する';
}

function isAlertNotificationType(type: string | null | undefined): boolean {
  return type === 'alert_near_expiry' || type === 'alert_excess_stock' || type === 'alert_resolved';
}

function resolveNotificationActionPath(
  referenceType: string | null,
  referenceId: number | null,
  notificationType?: string | null,
): string {
  if (isAlertNotificationType(notificationType)) return '/alerts';
  if (notificationType === 'matching_refresh_complete') return '/matching';
  if (notificationType === 'group_invitation') {
    return '/groups?tab=public';
  }
  if (notificationType === 'group_join' || notificationType === 'group_leave') {
    return '/groups';
  }
  if (referenceType === 'alert') return '/alerts';
  if (referenceType === 'match') return '/matching';
  if ((referenceType === 'proposal' || referenceType === 'comment') && referenceId) {
    return `/proposals/${referenceId}`;
  }
  if (referenceType === 'request') {
    return referenceId ? `/requests?requestId=${referenceId}` : '/requests';
  }
  return '/';
}

function notificationToNotice(n: typeof notificationsTable.$inferSelect): NoticeItem | null {
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
    actionPath: resolveNotificationActionPath(n.referenceType, n.referenceId, n.type),
    actionLabel: resolveNotificationActionLabel(noticeType, n.type),
    createdAt: n.createdAt,
    deadlineAt: null,
    unread: !n.isRead,
    priority: noticeType === 'alert'
      ? (n.isRead ? 4 : 2)
      : (n.isRead ? 5 : 3),
  };
}

const router = Router();
router.use(requireLogin);

async function listNotificationGroupStates(pharmacyId: number) {
  try {
    const rows = await db.select({
      actionPath: notificationGroupStates.actionPath,
      snoozedUntil: notificationGroupStates.snoozedUntil,
      lastReadAt: notificationGroupStates.lastReadAt,
    })
      .from(notificationGroupStates)
      .where(eq(notificationGroupStates.pharmacyId, pharmacyId));
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    logger.warn('notification_group_states query failed; continuing without group state', {
      pharmacyId,
      error: getErrorMessage(err),
    });
    return [] as Array<{
      actionPath: string;
      snoozedUntil: string | null;
      lastReadAt: string | null;
    }>;
  }
}

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const pharmacyId = req.user!.id;
    const limit = Math.min(parsePositiveInt(req.query.limit) ?? NOTICE_RESULT_LIMIT, MAX_NOTICE_PAGE_LIMIT);
    const cursor = parseNoticeCursor(req.query.cursor);

    const proposalSelect = {
      id: exchangeProposals.id,
      pharmacyAId: exchangeProposals.pharmacyAId,
      pharmacyBId: exchangeProposals.pharmacyBId,
      status: exchangeProposals.status,
      proposedAt: exchangeProposals.proposedAt,
    };
    const messageSelect = {
      id: adminMessages.id,
      title: adminMessages.title,
      body: adminMessages.body,
      actionPath: adminMessages.actionPath,
      createdAt: adminMessages.createdAt,
    };

    // 全6クエリを完全並列実行（直列→並列で約50%高速化）
    const [proposalsA, proposalsB, messagesAll, messagesPharmacy, matchRows, notificationRows, groupStateRows] = await Promise.all([
      db.select(proposalSelect)
        .from(exchangeProposals)
        .where(and(
          eq(exchangeProposals.pharmacyAId, pharmacyId),
          inArray(exchangeProposals.status, PROPOSAL_NOTICE_STATUSES),
        ))
        .orderBy(desc(exchangeProposals.proposedAt), desc(exchangeProposals.id))
        .limit(PROPOSAL_NOTICE_LIMIT),
      db.select(proposalSelect)
        .from(exchangeProposals)
        .where(and(
          eq(exchangeProposals.pharmacyBId, pharmacyId),
          inArray(exchangeProposals.status, PROPOSAL_NOTICE_STATUSES),
        ))
        .orderBy(desc(exchangeProposals.proposedAt), desc(exchangeProposals.id))
        .limit(PROPOSAL_NOTICE_LIMIT),
      db.select(messageSelect)
        .from(adminMessages)
        .where(eq(adminMessages.targetType, 'all'))
        .orderBy(desc(adminMessages.createdAt), desc(adminMessages.id))
        .limit(SOURCE_NOTICE_FETCH_LIMIT),
      db.select(messageSelect)
        .from(adminMessages)
        .where(and(
          eq(adminMessages.targetType, 'pharmacy'),
          eq(adminMessages.targetPharmacyId, pharmacyId),
        ))
        .orderBy(desc(adminMessages.createdAt), desc(adminMessages.id))
        .limit(SOURCE_NOTICE_FETCH_LIMIT),
      (async () => {
        try {
          return await db.select({
            id: matchNotifications.id,
            triggerPharmacyId: matchNotifications.triggerPharmacyId,
            triggerUploadType: matchNotifications.triggerUploadType,
            candidateCountBefore: matchNotifications.candidateCountBefore,
            candidateCountAfter: matchNotifications.candidateCountAfter,
            diffJson: matchNotifications.diffJson,
            isRead: matchNotifications.isRead,
            createdAt: matchNotifications.createdAt,
          })
            .from(matchNotifications)
            .where(eq(matchNotifications.pharmacyId, pharmacyId))
            .orderBy(desc(matchNotifications.createdAt), desc(matchNotifications.id))
            .limit(MATCH_NOTICE_LIMIT);
        } catch (err) {
          if (!isUndefinedTableError(err)) {
            throw err;
          }
          logger.warn('match_notifications query failed (table may not exist)', {
            error: err instanceof Error ? err.message : String(err),
          });
          return [];
        }
      })(),
      db.select()
        .from(notificationsTable)
        .where(eq(notificationsTable.pharmacyId, pharmacyId))
        .orderBy(desc(notificationsTable.createdAt), desc(notificationsTable.id))
        .limit(SOURCE_NOTICE_FETCH_LIMIT),
      listNotificationGroupStates(pharmacyId),
    ]);
    const groupStateByActionPath = new Map(groupStateRows.map((row) => [row.actionPath, row]));

    const proposalRows = mergeDedupSortByTimestamp(
      proposalsA,
      proposalsB,
      (row) => row.proposedAt,
      PROPOSAL_NOTICE_LIMIT,
    );
    const messageRows = mergeDedupSortByTimestamp(
      messagesAll,
      messagesPharmacy,
      (row) => row.createdAt,
      SOURCE_NOTICE_FETCH_LIMIT,
    );

    const latestProposalNotificationById = new Map<number, {
      id: number;
      isRead: boolean;
      createdAt: string | null;
    }>();
    for (const row of notificationRows) {
      if (row.referenceType !== 'proposal') continue;
      if (!PROPOSAL_EVENT_NOTIFICATION_TYPES.has(row.type)) continue;
      if (!row.referenceId || row.referenceId <= 0) continue;
      if (latestProposalNotificationById.has(row.referenceId)) continue;
      latestProposalNotificationById.set(row.referenceId, {
        id: row.id,
        isRead: row.isRead,
        createdAt: row.createdAt,
      });
    }

    const needsProposalViewedAt = proposalRows.some((proposal) => {
      if (latestProposalNotificationById.has(proposal.id)) return false;
      const isSender = proposal.pharmacyAId === pharmacyId;
      return !(proposal.status === 'proposed' && isSender);
    });

    // messageReads と triggerPharmacy names を並列取得
    const messageIds = messageRows.map((message) => message.id);
    const triggerPharmacyIds = [...new Set(matchRows.map((row) => row.triggerPharmacyId).filter((id): id is number => id != null))];

    const [messageReadRows, triggerPharmacyRows, pharmacyRows] = await Promise.all([
      messageIds.length > 0
        ? db.select({ messageId: adminMessageReads.messageId })
          .from(adminMessageReads)
          .where(and(
            inArray(adminMessageReads.messageId, messageIds),
            eq(adminMessageReads.pharmacyId, pharmacyId),
          ))
        : Promise.resolve([]),
      triggerPharmacyIds.length > 0
        ? db.select({ id: pharmacies.id, name: pharmacies.name })
          .from(pharmacies)
          .where(inArray(pharmacies.id, triggerPharmacyIds))
        : Promise.resolve([] as { id: number; name: string | null }[]),
      needsProposalViewedAt
        ? db.select({ lastTimelineViewedAt: pharmacies.lastTimelineViewedAt })
          .from(pharmacies)
          .where(eq(pharmacies.id, pharmacyId))
          .limit(1)
        : Promise.resolve([] as { lastTimelineViewedAt: string | null }[]),
    ]);

    const readMessageIdSet = new Set(messageReadRows.map((row) => row.messageId));
    const lastTimelineViewedAt = pharmacyRows[0]?.lastTimelineViewedAt ?? null;

    const notices: NoticeItem[] = [];
    const mappedProposalReferenceIds = new Set<number>();

    for (const proposal of proposalRows) {
      const linkedNotification = latestProposalNotificationById.get(proposal.id);
      const item = proposalActionNotice(proposal, pharmacyId, linkedNotification, lastTimelineViewedAt);
      if (item) {
        const resolved = applyGroupStateToNotice(item, groupStateByActionPath.get(item.actionPath));
        if (resolved) notices.push(resolved);
      }
      if (item && linkedNotification) {
        mappedProposalReferenceIds.add(proposal.id);
      }
    }

    for (const message of messageRows) {
      const unread = !readMessageIdSet.has(message.id);
      const actionPath = sanitizeInternalPath(message.actionPath) ?? '/';
      const nextNotice: NoticeItem = {
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
      const resolved = applyGroupStateToNotice(nextNotice, groupStateByActionPath.get(nextNotice.actionPath));
      if (resolved) notices.push(resolved);
    }

    const triggerPharmacyNameById = new Map(triggerPharmacyRows.map((row) => [row.id, row.name]));
    for (const row of matchRows) {
      if (!row.triggerPharmacyId || !row.triggerUploadType || row.candidateCountBefore == null || row.candidateCountAfter == null) continue;
      const nextNotice = matchUpdateNotice(
        {
          id: row.id,
          triggerPharmacyId: row.triggerPharmacyId,
          triggerUploadType: row.triggerUploadType as 'dead_stock' | 'used_medication',
          candidateCountBefore: row.candidateCountBefore,
          candidateCountAfter: row.candidateCountAfter,
          diffJson: typeof row.diffJson === 'string' ? row.diffJson : JSON.stringify(row.diffJson ?? ''),
          isRead: row.isRead,
          createdAt: row.createdAt,
        },
        pharmacyId,
        triggerPharmacyNameById.get(row.triggerPharmacyId) ?? null,
      );
      const resolved = applyGroupStateToNotice(nextNotice, groupStateByActionPath.get(nextNotice.actionPath));
      if (resolved) notices.push(resolved);
    }

    for (const n of notificationRows) {
      if (
        n.referenceType === 'proposal'
        && PROPOSAL_EVENT_NOTIFICATION_TYPES.has(n.type)
        && n.referenceId
        && mappedProposalReferenceIds.has(n.referenceId)
      ) {
        continue;
      }
      const notice = notificationToNotice(n);
      if (notice) {
        const resolved = applyGroupStateToNotice(notice, groupStateByActionPath.get(notice.actionPath));
        if (resolved) notices.push(resolved);
      }
    }

    notices.sort(compareNoticeOrder);

    const startIndex = (() => {
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
    })();
    const pagedNotices = notices.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < notices.length;
    const lastNotice = pagedNotices[pagedNotices.length - 1];
    const nextCursor = hasMore && lastNotice
      ? encodeCursor<NoticeCursor>({
          id: lastNotice.id,
          priority: lastNotice.priority,
          createdAt: lastNotice.createdAt,
        })
      : null;

    let unreadMessages = 0;
    let actionableRequests = 0;
    for (const item of notices) {
      if (item.type === 'admin_message' && item.unread) {
        unreadMessages += 1;
      }
      if (item.unread && (item.type === 'inbound_request' || item.type === 'status_update' || item.type === 'match_update' || item.type === 'alert')) {
        actionableRequests += 1;
      }
    }

    res.json({
      notices: pagedNotices,
      groupedCases: buildGroupedCases(notices),
      summary: {
        unreadMessages,
        actionableRequests,
        total: notices.length,
      },
      pagination: {
        limit,
        hasMore,
        nextCursor,
      },
    });
  } catch (err) {
    logger.error('Notifications fetch error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: '通知の取得に失敗しました' });
  }
});

router.post('/groups/read', async (req: AuthRequest, res: Response) => {
  try {
    const pharmacyId = req.user!.id;
    const actionPath = sanitizeInternalPath(req.body?.actionPath) ?? '/';
    const now = new Date().toISOString();
    await db.insert(notificationGroupStates).values({
      tenantId: pharmacyId,
      pharmacyId,
      actionPath,
      lastReadAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [notificationGroupStates.pharmacyId, notificationGroupStates.actionPath],
      set: {
        lastReadAt: now,
        updatedAt: now,
      },
    });
    publishTimelineRefresh({ pharmacyId, reason: 'notification_group_read' });
    invalidateDashboardUnreadCache(pharmacyId);
    res.json({ message: '案件単位で既読にしました' });
  } catch (err) {
    logger.error('Notification group read error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: '案件既読処理に失敗しました' });
  }
});

router.post('/groups/snooze', async (req: AuthRequest, res: Response) => {
  try {
    const pharmacyId = req.user!.id;
    const actionPath = sanitizeInternalPath(req.body?.actionPath) ?? '/';
    const hours = Math.min(Math.max(Number(req.body?.hours ?? 2), 1), 24 * 7);
    const now = new Date().toISOString();
    const snoozedUntil = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
    await db.insert(notificationGroupStates).values({
      tenantId: pharmacyId,
      pharmacyId,
      actionPath,
      snoozedUntil,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [notificationGroupStates.pharmacyId, notificationGroupStates.actionPath],
      set: {
        snoozedUntil,
        updatedAt: now,
      },
    });
    publishTimelineRefresh({ pharmacyId, reason: 'notification_group_snoozed' });
    res.json({ message: '案件単位で後回しにしました', snoozedUntil });
  } catch (err) {
    logger.error('Notification group snooze error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: '案件スヌーズに失敗しました' });
  }
});

router.post('/groups/clear', async (req: AuthRequest, res: Response) => {
  try {
    const pharmacyId = req.user!.id;
    const actionPath = sanitizeInternalPath(req.body?.actionPath) ?? '/';
    await db.delete(notificationGroupStates)
      .where(and(
        eq(notificationGroupStates.pharmacyId, pharmacyId),
        eq(notificationGroupStates.actionPath, actionPath),
      ));
    publishTimelineRefresh({ pharmacyId, reason: 'notification_group_cleared' });
    res.json({ message: '案件単位の通知状態を解除しました' });
  } catch (err) {
    logger.error('Notification group clear error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: '案件状態の解除に失敗しました' });
  }
});

router.post('/messages/:id/read', async (req: AuthRequest, res: Response) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: '不正なIDです' });
      return;
    }

    const pharmacyId = req.user!.id;

    const [message] = await db.select({
      id: adminMessages.id,
      targetType: adminMessages.targetType,
      targetPharmacyId: adminMessages.targetPharmacyId,
    })
      .from(adminMessages)
      .where(eq(adminMessages.id, id))
      .limit(1);

    if (!message) {
      res.status(404).json({ error: 'メッセージが見つかりません' });
      return;
    }

    const isTarget = message.targetType === 'all' || message.targetPharmacyId === pharmacyId;
    if (!isTarget) {
      res.status(404).json({ error: 'メッセージが見つかりません' });
      return;
    }

    await db.insert(adminMessageReads).values({
      messageId: id,
      pharmacyId,
    }).onConflictDoNothing({
      target: [adminMessageReads.messageId, adminMessageReads.pharmacyId],
    });
    invalidateDashboardUnreadCache(pharmacyId);
    publishTimelineRefresh({
      pharmacyId,
      reason: 'admin_message_read',
    });

    res.json({ message: '既読にしました' });
  } catch (err) {
    logger.error('Notification read error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: '既読処理に失敗しました' });
  }
});

router.post('/matches/:id/read', async (req: AuthRequest, res: Response) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: '不正なIDです' });
      return;
    }

    const pharmacyId = req.user!.id;
    const [matchNotice] = await db.select({
      id: matchNotifications.id,
      pharmacyId: matchNotifications.pharmacyId,
    })
      .from(matchNotifications)
      .where(eq(matchNotifications.id, id))
      .limit(1);

    if (!matchNotice) {
      res.status(404).json({ error: '通知が見つかりません' });
      return;
    }
    if (matchNotice.pharmacyId !== pharmacyId) {
      res.status(404).json({ error: '通知が見つかりません' });
      return;
    }

    await db.update(matchNotifications)
      .set({ isRead: true })
      .where(eq(matchNotifications.id, id));
    invalidateDashboardUnreadCache(pharmacyId);
    publishTimelineRefresh({
      pharmacyId,
      reason: 'match_notification_read',
    });

    res.json({ message: '既読にしました' });
  } catch (err) {
    logger.error('Match notification read error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: '既読処理に失敗しました' });
  }
});

// GET /api/notifications/unread-count
router.get('/unread-count', async (req: AuthRequest, res: Response) => {
  try {
    const pharmacyId = req.user!.id;
    const unreadCount = await getDashboardUnreadCount(pharmacyId);
    res.json({ unreadCount });
  } catch (err) {
    logger.error('Get unread count error', { error: (err as Error).message });
    res.status(500).json({ error: '未読件数の取得に失敗しました' });
  }
});

// PATCH /api/notifications/read-all (/:id/read より先に定義すること)
const markAllReadHandler = async (req: AuthRequest, res: Response) => {
  try {
    const count = await markAllDashboardAsRead(req.user!.id);
    res.json({ message: `${count}件を既読にしました`, count });
  } catch (err) {
    logger.error('Mark all as read error', { error: (err as Error).message });
    res.status(500).json({ error: '一括既読更新に失敗しました' });
  }
};
router.patch('/read-all', markAllReadHandler);

// PATCH /api/notifications/:id/read
const markReadHandler = async (req: AuthRequest, res: Response) => {
  try {
    const notificationId = parsePositiveInt(req.params.id);
    if (!notificationId) {
      res.status(400).json({ error: '不正なIDです' });
      return;
    }
    const success = await markAsRead(notificationId, req.user!.id);
    if (!success) {
      res.status(404).json({ error: '通知が見つかりません' });
      return;
    }
    res.json({ message: '既読にしました' });
  } catch (err) {
    logger.error('Mark as read error', { error: (err as Error).message });
    res.status(500).json({ error: '既読更新に失敗しました' });
  }
};
router.patch('/:id/read', markReadHandler);

export default router;
