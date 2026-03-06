import { Router, Response } from 'express';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../config/database';
import { requireLogin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { adminMessages, adminMessageReads, exchangeProposals, matchNotifications, pharmacies, notifications as notificationsTable } from '../db/schema';
import { parsePositiveInt } from '../utils/request-utils';
import { logger } from '../services/logger';
import { getErrorMessage } from '../middleware/error-handler';
import {
  getDashboardUnreadCount,
  invalidateDashboardUnreadCache,
  markAsRead,
  markAllDashboardAsRead,
} from '../services/notification-service';
import {
  NoticeItem,
  NoticeCursor,
  AdminMessageRow,
  ProposalRow,
  NotificationRowForProposalLink,
  NotificationNoticeRow,
  NOTICE_RESULT_LIMIT,
  SOURCE_NOTICE_FETCH_LIMIT,
  PROPOSAL_NOTICE_LIMIT,
  PROPOSAL_NOTICE_STATUSES,
  PROPOSAL_EVENT_NOTIFICATION_TYPES,
  MATCH_NOTICE_LIMIT,
  MAX_NOTICE_PAGE_LIMIT,
  isUndefinedTableError,
  parseNoticeCursor,
  buildLatestProposalNotificationMap,
  toAdminMessageNotice,
  notificationToNotice,
  matchUpdateNotice,
  proposalActionNotice,
  compareNoticeOrder,
  resolveNoticeStartIndex,
  buildNoticeSummary,
  mergeDedupSortByTimestamp,
  encodeNoticeCursor,
} from './notifications-helpers';

const router = Router();
router.use(requireLogin);

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
    const notificationSelect = {
      id: notificationsTable.id,
      type: notificationsTable.type,
      title: notificationsTable.title,
      message: notificationsTable.message,
      referenceType: notificationsTable.referenceType,
      referenceId: notificationsTable.referenceId,
      isRead: notificationsTable.isRead,
      createdAt: notificationsTable.createdAt,
    };

    // 全6クエリを完全並列実行（直列→並列で約50%高速化）
    const [proposalsA, proposalsB, messagesAll, messagesPharmacy, matchRows, notificationRows] = await Promise.all([
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
            error: getErrorMessage(err),
          });
          return [];
        }
      })(),
      db.select(notificationSelect)
        .from(notificationsTable)
        .where(eq(notificationsTable.pharmacyId, pharmacyId))
        .orderBy(desc(notificationsTable.createdAt), desc(notificationsTable.id))
        .limit(SOURCE_NOTICE_FETCH_LIMIT),
    ]);

    const proposalRows: ProposalRow[] = mergeDedupSortByTimestamp(
      proposalsA,
      proposalsB,
      (row) => row.proposedAt,
      PROPOSAL_NOTICE_LIMIT,
    );
    const messageRows: AdminMessageRow[] = mergeDedupSortByTimestamp(
      messagesAll,
      messagesPharmacy,
      (row) => row.createdAt,
      SOURCE_NOTICE_FETCH_LIMIT,
    );

    const latestProposalNotificationById = buildLatestProposalNotificationMap(notificationRows);

    // messageReads と triggerPharmacy names を並列取得
    const messageIds = messageRows.map((message) => message.id);
    const triggerPharmacyIds = [...new Set(matchRows.map((row) => row.triggerPharmacyId))];

    const [messageReadRows, triggerPharmacyRows] = await Promise.all([
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
        : Promise.resolve([]),
    ]);

    const readMessageIdSet = new Set(messageReadRows.map((row) => row.messageId));

    const notices: NoticeItem[] = [];
    const mappedProposalReferenceIds = new Set<number>();

    for (const proposal of proposalRows) {
      const linkedNotification = latestProposalNotificationById.get(proposal.id);
      const item = proposalActionNotice(proposal, pharmacyId, linkedNotification);
      if (item) notices.push(item);
      if (item && linkedNotification) {
        mappedProposalReferenceIds.add(proposal.id);
      }
    }

    for (const message of messageRows) {
      const unread = !readMessageIdSet.has(message.id);
      notices.push(toAdminMessageNotice(message, unread));
    }

    const triggerPharmacyNameById = new Map(triggerPharmacyRows.map((row) => [row.id, row.name]));
    for (const row of matchRows) {
      notices.push(matchUpdateNotice(
        row,
        pharmacyId,
        triggerPharmacyNameById.get(row.triggerPharmacyId) ?? null,
      ));
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
      if (notice) notices.push(notice);
    }

    notices.sort(compareNoticeOrder);
    const startIndex = resolveNoticeStartIndex(notices, cursor);
    const pagedNotices = notices.slice(startIndex, startIndex + limit);
    const hasMore = startIndex + limit < notices.length;
    const lastNotice = pagedNotices[pagedNotices.length - 1];
    const nextCursor = hasMore && lastNotice
      ? encodeNoticeCursor({
          id: lastNotice.id,
          priority: lastNotice.priority,
          createdAt: lastNotice.createdAt,
        })
      : null;

    const { unreadMessages, actionableRequests } = buildNoticeSummary(notices);

    res.json({
      notices: pagedNotices,
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
      error: getErrorMessage(err),
    });
    res.status(500).json({ error: '通知の取得に失敗しました' });
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

    res.json({ message: '既読にしました' });
  } catch (err) {
    logger.error('Notification read error', {
      error: getErrorMessage(err),
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

    res.json({ message: '既読にしました' });
  } catch (err) {
    logger.error('Match notification read error', {
      error: getErrorMessage(err),
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
    logger.error('Get unread count error', { error: getErrorMessage(err) });
    res.status(500).json({ error: '未読件数の取得に失敗しました' });
  }
});

// PATCH /api/notifications/read-all (/:id/read より先に定義すること)
const markAllReadHandler = async (req: AuthRequest, res: Response) => {
  try {
    const count = await markAllDashboardAsRead(req.user!.id);
    res.json({ message: `${count}件を既読にしました`, count });
  } catch (err) {
    logger.error('Mark all as read error', { error: getErrorMessage(err) });
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
    logger.error('Mark as read error', { error: getErrorMessage(err) });
    res.status(500).json({ error: '既読更新に失敗しました' });
  }
};
router.patch('/:id/read', markReadHandler);

export default router;
