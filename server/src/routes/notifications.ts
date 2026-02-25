import { Router, Response } from 'express';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../config/database';
import { requireLogin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { adminMessages, adminMessageReads, exchangeProposals } from '../db/schema';
import { parsePositiveInt } from '../utils/request-utils';
import { sanitizeInternalPath } from '../utils/path-utils';
import { logger } from '../services/logger';

type NoticeType = 'inbound_request' | 'outbound_request' | 'status_update' | 'admin_message';

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
const PROPOSAL_NOTICE_LIMIT = 50;
const PROPOSAL_NOTICE_STATUSES = ['proposed', 'accepted_a', 'accepted_b', 'confirmed'] as const;

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
}, currentPharmacyId: number): NoticeItem | null {
  const isA = proposal.pharmacyAId === currentPharmacyId;
  const actionPath = `/proposals/${proposal.id}`;
  const deadlineAt = buildProposalDeadlineAt(proposal.proposedAt);

  if (proposal.status === 'proposed') {
    if (isA) {
      return {
        id: `proposal-${proposal.id}-outbound`,
        type: 'outbound_request',
        title: '仮マッチングを送信済みです',
        body: `マッチング #${proposal.id} の相手薬局承認待ちです。`,
        actionPath,
        actionLabel: '詳細へ',
        createdAt: proposal.proposedAt,
        deadlineAt,
        unread: true,
        priority: 3,
      };
    }
    return {
      id: `proposal-${proposal.id}-inbound`,
      type: 'inbound_request',
      title: '仮マッチングが届いています',
      body: `マッチング #${proposal.id} を確認し、承認または拒否してください。`,
      actionPath,
      actionLabel: '承認/拒否を行う',
      createdAt: proposal.proposedAt,
      deadlineAt,
      unread: true,
      priority: 1,
    };
  }

  if ((proposal.status === 'accepted_a' && !isA) || (proposal.status === 'accepted_b' && isA)) {
    return {
      id: `proposal-${proposal.id}-pending-my-approval`,
      type: 'inbound_request',
      title: '相手承認済みの仮マッチングがあります',
      body: `マッチング #${proposal.id} はあなたの承認待ちです。`,
      actionPath,
      actionLabel: '承認する',
      createdAt: proposal.proposedAt,
      deadlineAt,
      unread: true,
      priority: 1,
    };
  }

  if (proposal.status === 'confirmed') {
    return {
      id: `proposal-${proposal.id}-confirmed`,
      type: 'status_update',
      title: 'マッチングが確定しました',
      body: `マッチング #${proposal.id} の受け渡し後、交換完了を実行してください。`,
      actionPath,
      actionLabel: '交換完了へ進む',
      createdAt: proposal.proposedAt,
      deadlineAt: null,
      unread: true,
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

function mergeDedupSortByTimestamp<T extends { id: number }>(
  branchA: T[],
  branchB: T[],
  getTimestamp: (row: T) => string | null,
): T[] {
  const deduped = new Map<number, T>();
  for (const row of branchA) deduped.set(row.id, row);
  for (const row of branchB) {
    if (!deduped.has(row.id)) deduped.set(row.id, row);
  }

  return [...deduped.values()].sort((left, right) => {
    const leftSort = timestampSortValue(getTimestamp(left));
    const rightSort = timestampSortValue(getTimestamp(right));
    return rightSort - leftSort || right.id - left.id;
  });
}

const router = Router();
router.use(requireLogin);

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const pharmacyId = req.user!.id;

    const [proposalRows, messageRows] = await Promise.all([
      (async () => {
        const proposalSelect = {
          id: exchangeProposals.id,
          pharmacyAId: exchangeProposals.pharmacyAId,
          pharmacyBId: exchangeProposals.pharmacyBId,
          status: exchangeProposals.status,
          proposedAt: exchangeProposals.proposedAt,
        };
        const [branchA, branchB] = await Promise.all([
          db.select(proposalSelect)
            .from(exchangeProposals)
            .where(and(
              eq(exchangeProposals.pharmacyAId, pharmacyId),
              inArray(exchangeProposals.status, PROPOSAL_NOTICE_STATUSES),
            ))
            .orderBy(desc(exchangeProposals.proposedAt))
            .limit(PROPOSAL_NOTICE_LIMIT),
          db.select(proposalSelect)
            .from(exchangeProposals)
            .where(and(
              eq(exchangeProposals.pharmacyBId, pharmacyId),
              inArray(exchangeProposals.status, PROPOSAL_NOTICE_STATUSES),
            ))
            .orderBy(desc(exchangeProposals.proposedAt))
            .limit(PROPOSAL_NOTICE_LIMIT),
        ]);

        return mergeDedupSortByTimestamp(branchA, branchB, (row) => row.proposedAt)
          .slice(0, PROPOSAL_NOTICE_LIMIT);
      })(),
      (async () => {
        const messageSelect = {
          id: adminMessages.id,
          title: adminMessages.title,
          body: adminMessages.body,
          actionPath: adminMessages.actionPath,
          createdAt: adminMessages.createdAt,
        };

        const [targetAllMessages, targetPharmacyMessages] = await Promise.all([
          db.select(messageSelect)
            .from(adminMessages)
            .where(eq(adminMessages.targetType, 'all'))
            .orderBy(desc(adminMessages.createdAt), desc(adminMessages.id))
            .limit(50),
          db.select(messageSelect)
            .from(adminMessages)
            .where(and(
              eq(adminMessages.targetType, 'pharmacy'),
              eq(adminMessages.targetPharmacyId, pharmacyId),
            ))
            .orderBy(desc(adminMessages.createdAt), desc(adminMessages.id))
            .limit(50),
        ]);

        return mergeDedupSortByTimestamp(targetAllMessages, targetPharmacyMessages, (row) => row.createdAt)
          .slice(0, 50);
      })(),
    ]);

    const messageIds = messageRows.map((message) => message.id);
    const messageReadRows = messageIds.length > 0
      ? await db.select({ messageId: adminMessageReads.messageId })
        .from(adminMessageReads)
        .where(and(
          inArray(adminMessageReads.messageId, messageIds),
          eq(adminMessageReads.pharmacyId, pharmacyId),
        ))
      : [];
    const readMessageIdSet = new Set(messageReadRows.map((row) => row.messageId));

    const notices: NoticeItem[] = [];

    for (const proposal of proposalRows) {
      const item = proposalActionNotice(proposal, pharmacyId);
      if (item) notices.push(item);
    }

    for (const message of messageRows) {
      const unread = !readMessageIdSet.has(message.id);
      const actionPath = sanitizeInternalPath(message.actionPath) ?? '/';
      notices.push({
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
      });
    }

    notices.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });

    const unreadMessages = notices.filter((item) => item.type === 'admin_message' && item.unread).length;
    const actionableRequests = notices.filter((item) =>
      item.type === 'inbound_request' || item.type === 'status_update'
    ).length;

    res.json({
      notices: notices.slice(0, 20),
      summary: {
        unreadMessages,
        actionableRequests,
        total: notices.length,
      },
    });
  } catch (err) {
    logger.error('Notifications fetch error', {
      error: err instanceof Error ? err.message : String(err),
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
      res.status(403).json({ error: 'アクセス権限がありません' });
      return;
    }

    await db.insert(adminMessageReads).values({
      messageId: id,
      pharmacyId,
    }).onConflictDoNothing({
      target: [adminMessageReads.messageId, adminMessageReads.pharmacyId],
    });

    res.json({ message: '既読にしました' });
  } catch (err) {
    logger.error('Notification read error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: '既読処理に失敗しました' });
  }
});

export default router;
