import { Router, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../config/database';
import {
  exchangeProposals,
  exchangeProposalItems,
  deadStockItems,
  pharmacies,
  proposalComments,
  exchangeFeedback,
  proposalCounterOffers,
} from '../db/schema';
import { AuthRequest } from '../types';
import { findMatches } from '../services/matching-service';
import { createProposal, acceptProposal, rejectProposal, completeProposal } from '../services/exchange-execution-service';
import { parsePagination, isPositiveSafeInteger } from '../utils/request-utils';
import { rowCount } from '../utils/db-utils';
import { logger } from '../services/logger';
import { getProposalPriority } from '../services/proposal-priority-service';
import { createNotification } from '../services/notification-service';
import {
  buildProposalTimeline,
  fetchProposalTimelineActionRows,
} from '../services/proposal-timeline-service';
import { parseExchangeIdOrBadRequest } from './exchange-utils';
import { getErrorMessage } from '../middleware/error-handler';
import type { EnrichedProposalTimelineEvent } from '../types/timeline';

const router = Router();

const CREATE_PROPOSAL_CLIENT_ERROR = '候補データが無効です。候補を再取得して再試行してください';

function isProposalInputError(message: string): boolean {
  return [
    '不正',
    '見つかりません',
    '在庫',
    '薬局',
    'マッチング',
    '提案',
    '交換金額',
    '数量',
  ].some((token) => message.includes(token));
}

const findLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const proposalWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '提案リクエストが多すぎます。しばらく待ってからお試しください。' },
  keyGenerator: (req) => (req as AuthRequest).user?.id?.toString() ?? ipKeyGenerator(req.ip ?? 'unknown'),
});

type BulkActionType = 'accept' | 'reject';
const BULK_ACTION_CONCURRENCY = 8;

function parseBulkAction(raw: unknown): BulkActionType | null {
  if (raw === 'accept' || raw === 'reject') return raw;
  return null;
}

function parseBulkIds(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const normalized = raw
    .map((value) => Number(value))
    .filter(isPositiveSafeInteger);
  if (normalized.length === 0) return null;
  return [...new Set(normalized)];
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      results[current] = await mapper(items[current]);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function sanitizeProposalError(err: unknown): { status: number; message: string } {
  const message = err instanceof Error ? err.message : '';
  const errorMappings: Array<{ tokens: string[]; status: number; message: string }> = [
    {
      tokens: ['見つかりません', 'アクセス権限', 'アクセスする権限'],
      status: 404,
      message: 'マッチングが見つかりません',
    },
    {
      tokens: ['在庫状態の問題により交換を完了できません'],
      status: 400,
      message: '在庫状態の問題により交換を完了できません',
    },
    {
      tokens: ['状態が変更された'],
      status: 409,
      message: '状態が変更されたため、再読み込みして再試行してください',
    },
    {
      tokens: ['承認できる状態', '拒否できる状態', '完了できません'],
      status: 400,
      message: '対象を処理できませんでした',
    },
  ];
  for (const mapping of errorMappings) {
    if (mapping.tokens.some((token) => message.includes(token))) {
      return { status: mapping.status, message: mapping.message };
    }
  }
  return { status: 400, message: '操作に失敗しました' };
}

interface ProposalActionHandlerConfig<TResult> {
  run: (proposalId: number, actorId: number) => Promise<TResult>;
  buildResponse: (result: TResult) => Record<string, unknown>;
}

interface BulkActionResult {
  id: number;
  ok: boolean;
  status?: string;
  message?: string;
  error?: string;
}

interface ProposalDetailPharmacyRow {
  name: string | null;
  phone: string | null;
  fax: string | null;
  address: string | null;
  prefecture: string | null;
}

interface ProposalPrintPharmacyRow extends ProposalDetailPharmacyRow {
  licenseNumber: string | null;
}

interface ProposalCounterOfferItemInput {
  proposalItemId?: number;
  drugName: string;
  quantity: number;
}

type ProposalData = {
  proposal: typeof exchangeProposals.$inferSelect;
  items: Array<{
    id: number;
    deadStockItemId: number;
    fromPharmacyId: number;
    toPharmacyId: number;
    quantity: number;
    yakkaValue: string | null;
    drugName: string;
    unit: string | null;
    yakkaUnitPrice: string | null;
  }>;
};

async function handleProposalAction<TResult>(
  req: AuthRequest,
  res: Response,
  config: ProposalActionHandlerConfig<TResult>,
): Promise<void> {
  try {
    const id = parseExchangeIdOrBadRequest(res, req.params.id);
    if (!id) return;

    const actorId = req.user!.id;
    const result = await config.run(id, actorId);
    res.json(config.buildResponse(result));
  } catch (err) {
    const failure = sanitizeProposalError(err);
    res.status(failure.status).json({ error: failure.message });
  }
}

async function runBulkAction(
  action: BulkActionType,
  id: number,
  actorId: number,
): Promise<BulkActionResult> {
  try {
    if (action === 'accept') {
      const nextStatus = await acceptProposal(id, actorId);
      return {
        id,
        ok: true,
        status: nextStatus,
        message: nextStatus === 'confirmed'
          ? '仮マッチングが確定しました'
          : '承認しました（相手薬局の承認待ち）',
      };
    }

    await rejectProposal(id, actorId);
    return {
      id,
      ok: true,
      status: 'rejected',
      message: '拒否しました',
    };
  } catch (err) {
    logger.warn('Bulk proposal action item failed', {
      proposalId: id,
      action,
      actorId,
      error: getErrorMessage(err),
    });
    return { id, ok: false, error: sanitizeProposalError(err).message };
  }
}

async function fetchProposalData(proposalId: number, pharmacyId: number): Promise<ProposalData | null> {
  const [proposal] = await db.select()
    .from(exchangeProposals)
    .where(and(
      eq(exchangeProposals.id, proposalId),
      or(
        eq(exchangeProposals.pharmacyAId, pharmacyId),
        eq(exchangeProposals.pharmacyBId, pharmacyId),
      ),
    ))
    .limit(1);

  if (!proposal) return null;

  const items = await db.select({
    id: exchangeProposalItems.id,
    deadStockItemId: exchangeProposalItems.deadStockItemId,
    fromPharmacyId: exchangeProposalItems.fromPharmacyId,
    toPharmacyId: exchangeProposalItems.toPharmacyId,
    quantity: exchangeProposalItems.quantity,
    yakkaValue: exchangeProposalItems.yakkaValue,
    drugName: deadStockItems.drugName,
    unit: deadStockItems.unit,
    yakkaUnitPrice: deadStockItems.yakkaUnitPrice,
  })
    .from(exchangeProposalItems)
    .innerJoin(deadStockItems, eq(exchangeProposalItems.deadStockItemId, deadStockItems.id))
    .where(eq(exchangeProposalItems.proposalId, proposalId));

  return { proposal, items };
}

async function fetchProposalDetailPharmacies(
  proposal: { pharmacyAId: number; pharmacyBId: number },
): Promise<[ProposalDetailPharmacyRow | undefined, ProposalDetailPharmacyRow | undefined]> {
  const detailFields = {
    name: pharmacies.name,
    phone: pharmacies.phone,
    fax: pharmacies.fax,
    address: pharmacies.address,
    prefecture: pharmacies.prefecture,
  };

  const [[pharmA], [pharmB]] = await Promise.all([
    db.select(detailFields).from(pharmacies).where(eq(pharmacies.id, proposal.pharmacyAId)).limit(1),
    db.select(detailFields).from(pharmacies).where(eq(pharmacies.id, proposal.pharmacyBId)).limit(1),
  ]);

  return [pharmA, pharmB];
}

async function fetchProposalPrintPharmacies(
  proposal: { pharmacyAId: number; pharmacyBId: number },
): Promise<[ProposalPrintPharmacyRow | undefined, ProposalPrintPharmacyRow | undefined]> {
  const printFields = {
    name: pharmacies.name,
    phone: pharmacies.phone,
    fax: pharmacies.fax,
    address: pharmacies.address,
    prefecture: pharmacies.prefecture,
    licenseNumber: pharmacies.licenseNumber,
  };

  const [[pharmA], [pharmB]] = await Promise.all([
    db.select(printFields).from(pharmacies).where(eq(pharmacies.id, proposal.pharmacyAId)).limit(1),
    db.select(printFields).from(pharmacies).where(eq(pharmacies.id, proposal.pharmacyBId)).limit(1),
  ]);

  return [pharmA, pharmB];
}

function compareTimelineAtDesc(
  a: { at?: string | Date | null },
  b: { at?: string | Date | null },
): number {
  if (!a.at && !b.at) return 0;
  if (!a.at) return 1;
  if (!b.at) return -1;
  return new Date(b.at).getTime() - new Date(a.at).getTime();
}

const handleFind = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const groupOnly = req.body?.groupOnly === true;
    const candidates = await findMatches(req.user!.id, { groupOnly });
    res.json({ candidates });
  } catch (err) {
    logger.error('Find matches error:', { error: getErrorMessage(err) });
    const message = process.env.NODE_ENV === 'production'
      ? 'マッチングに失敗しました'
      : (err instanceof Error ? err.message : 'マッチングに失敗しました');
    res.status(500).json({ error: message });
  }
};

const handleCreateProposal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const candidate = req.body?.candidate;
    if (!candidate || typeof candidate !== 'object') {
      res.status(400).json({ error: '候補データが必要です' });
      return;
    }

    const proposalId = await createProposal(req.user!.id, candidate);
    res.status(201).json({ proposalId, message: '仮マッチングを開始しました' });
  } catch (err) {
    logger.error('Create proposal error:', { error: getErrorMessage(err) });
    if (err instanceof Error && isProposalInputError(err.message)) {
      logger.warn('Create proposal rejected due to invalid candidate payload', {
        pharmacyId: req.user!.id,
        reason: err.message,
      });
      res.status(400).json({ error: CREATE_PROPOSAL_CLIENT_ERROR });
      return;
    }
    res.status(500).json({ error: '仮マッチングの作成に失敗しました' });
  }
};

const handleBulkAction = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const action = parseBulkAction(req.body?.action);
    const ids = parseBulkIds(req.body?.ids);

    if (!action || !ids) {
      res.status(400).json({ error: 'action と ids を正しく指定してください' });
      return;
    }
    if (ids.length > 50) {
      res.status(400).json({ error: '一括操作は最大50件までです' });
      return;
    }

    const actorId = req.user!.id;
    const results = await mapWithConcurrency(
      ids,
      BULK_ACTION_CONCURRENCY,
      (id) => runBulkAction(action, id, actorId),
    );

    const successCount = results.filter((row) => row.ok).length;
    res.json({
      action,
      results,
      summary: {
        total: ids.length,
        success: successCount,
        failed: ids.length - successCount,
      },
    });
  } catch (err) {
    logger.error('Bulk proposal action error', { error: getErrorMessage(err) });
    res.status(500).json({ error: '一括操作に失敗しました' });
  }
};

const handleAcceptProposal = async (req: AuthRequest, res: Response): Promise<void> => {
  await handleProposalAction(req, res, {
    run: acceptProposal,
    buildResponse: (status) => ({
      message: status === 'confirmed'
        ? '仮マッチングが確定しました'
        : '仮マッチングを承認しました（相手薬局の承認待ち）',
      status,
    }),
  });
};

const handleRejectProposal = async (req: AuthRequest, res: Response): Promise<void> => {
  await handleProposalAction(req, res, {
    run: rejectProposal,
    buildResponse: () => ({ message: '仮マッチングを拒否しました' }),
  });
};

const handleCompleteProposal = async (req: AuthRequest, res: Response): Promise<void> => {
  await handleProposalAction(req, res, {
    run: completeProposal,
    buildResponse: () => ({ message: '交換を完了しました' }),
  });
};

const handlePendingCount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const pharmacyId = req.user!.id;
    const [result] = await db.select({ count: rowCount })
      .from(exchangeProposals)
      .where(and(
        or(
          eq(exchangeProposals.pharmacyAId, pharmacyId),
          eq(exchangeProposals.pharmacyBId, pharmacyId),
        ),
        sql`(
          (${exchangeProposals.status} = 'proposed' AND ${exchangeProposals.pharmacyBId} = ${pharmacyId})
          OR (${exchangeProposals.status} = 'accepted_a' AND ${exchangeProposals.pharmacyBId} = ${pharmacyId})
          OR (${exchangeProposals.status} = 'accepted_b' AND ${exchangeProposals.pharmacyAId} = ${pharmacyId})
        )`,
      ));
    res.json({ pendingCount: result.count });
  } catch (err) {
    logger.error('Pending proposal count error', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: '要対応件数の取得に失敗しました' });
  }
};

const handleListProposals = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const sort = typeof req.query.sort === 'string' ? req.query.sort : 'recent';
    const { page, limit, offset } = parsePagination(req.query.page, req.query.limit, {
      defaultLimit: 20,
      maxLimit: 100,
    });
    const pharmacyId = req.user!.id;
    const pharmacyA = alias(pharmacies, 'pharmacy_a');
    const pharmacyB = alias(pharmacies, 'pharmacy_b');
    const proposalSelect = {
      id: exchangeProposals.id,
      pharmacyAId: exchangeProposals.pharmacyAId,
      pharmacyBId: exchangeProposals.pharmacyBId,
      status: exchangeProposals.status,
      totalValueA: exchangeProposals.totalValueA,
      totalValueB: exchangeProposals.totalValueB,
      valueDifference: exchangeProposals.valueDifference,
      proposedAt: exchangeProposals.proposedAt,
      expiresAt: exchangeProposals.expiresAt,
      expiryReminderSentAt: exchangeProposals.expiryReminderSentAt,
      pharmacyAName: pharmacyA.name,
      pharmacyBName: pharmacyB.name,
    };
    const ownershipFilter = or(
      eq(exchangeProposals.pharmacyAId, pharmacyId),
      eq(exchangeProposals.pharmacyBId, pharmacyId),
    );
    const inboundWaitingExpr = sql<boolean>`(
      (${exchangeProposals.status} = 'proposed' AND ${exchangeProposals.pharmacyBId} = ${pharmacyId})
      OR (${exchangeProposals.status} = 'accepted_a' AND ${exchangeProposals.pharmacyBId} = ${pharmacyId})
      OR (${exchangeProposals.status} = 'accepted_b' AND ${exchangeProposals.pharmacyAId} = ${pharmacyId})
    )`;
    const deadlineAtExpr = sql`COALESCE(${exchangeProposals.expiresAt}, (${exchangeProposals.proposedAt} + interval '72 hours'))`;
    const priorityScoreExpr = sql<number>`(
      CASE
        WHEN ${exchangeProposals.status} = 'confirmed' THEN 70
        WHEN ${inboundWaitingExpr} THEN 85
        WHEN ${exchangeProposals.status} = 'proposed' AND ${exchangeProposals.pharmacyAId} = ${pharmacyId} THEN 45
        WHEN ${exchangeProposals.status} IN ('accepted_a', 'accepted_b') THEN 55
        WHEN ${exchangeProposals.status} = 'completed' THEN 10
        WHEN ${exchangeProposals.status} IN ('rejected', 'cancelled') THEN 5
        ELSE 0
      END
      +
      CASE
        WHEN ${inboundWaitingExpr} AND ${exchangeProposals.proposedAt} IS NOT NULL THEN
          CASE
            WHEN ${deadlineAtExpr} <= now() THEN 20
            WHEN ${deadlineAtExpr} <= (now() + interval '24 hours') THEN 12
            WHEN ${deadlineAtExpr} <= (now() + interval '48 hours') THEN 6
            ELSE 0
          END
        ELSE 0
      END
    )`;
    const deadlineGroupExpr = sql<number>`CASE WHEN ${inboundWaitingExpr} THEN 0 ELSE 1 END`;
    const inboundDeadlineSortExpr = sql`CASE WHEN ${inboundWaitingExpr} THEN ${deadlineAtExpr} ELSE NULL END`;

    const [rows, [countRow]] = await Promise.all([
      db.select(proposalSelect)
        .from(exchangeProposals)
        .leftJoin(pharmacyA, eq(exchangeProposals.pharmacyAId, pharmacyA.id))
        .leftJoin(pharmacyB, eq(exchangeProposals.pharmacyBId, pharmacyB.id))
        .where(ownershipFilter)
        .orderBy(
          ...(sort === 'priority'
            ? [
              desc(priorityScoreExpr),
              asc(deadlineGroupExpr),
              asc(inboundDeadlineSortExpr),
            ]
            : []),
          desc(exchangeProposals.proposedAt),
          desc(exchangeProposals.id),
        )
        .limit(limit)
        .offset(offset),
      db.select({ count: rowCount })
        .from(exchangeProposals)
        .where(ownershipFilter),
    ]);
    const proposalIds = rows.map((row) => row.id);
    const pendingCounterOffers = proposalIds.length > 0
      ? await (async () => {
        try {
          return await db.select({
            proposalId: proposalCounterOffers.proposalId,
            proposerPharmacyId: proposalCounterOffers.proposerPharmacyId,
            responderPharmacyId: proposalCounterOffers.responderPharmacyId,
            status: proposalCounterOffers.status,
          })
            .from(proposalCounterOffers)
            .where(and(
              inArray(proposalCounterOffers.proposalId, proposalIds),
              eq(proposalCounterOffers.status, 'pending'),
            ));
        } catch {
          return [];
        }
      })()
      : [];
    const pendingCounterOfferByProposalId = new Map(
      pendingCounterOffers.map((row) => [row.proposalId, row]),
    );
    const totalCount = countRow.count;
    const enriched = rows.map((row) => {
      const priority = getProposalPriority({
        id: row.id,
        pharmacyAId: row.pharmacyAId,
        pharmacyBId: row.pharmacyBId,
        status: row.status,
        proposedAt: row.proposedAt,
        expiresAt: row.expiresAt,
      }, pharmacyId);
      const pendingCounterOffer = pendingCounterOfferByProposalId.get(row.id);

      return {
        ...row,
        pharmacyAName: row.pharmacyAName ?? '',
        pharmacyBName: row.pharmacyBName ?? '',
        priorityScore: priority.priorityScore,
        priorityReasons: priority.priorityReasons,
        deadlineAt: priority.deadlineAt,
        hasPendingCounterOffer: Boolean(pendingCounterOffer),
        pendingCounterOfferRole: pendingCounterOffer
          ? (pendingCounterOffer.proposerPharmacyId === pharmacyId ? 'sent' : 'received')
          : null,
      };
    });

    res.json({
      data: enriched,
      pagination: { page, limit, total: totalCount, totalPages: Math.ceil(totalCount / limit) },
    });
  } catch (err) {
    logger.error('List proposals error:', { error: getErrorMessage(err) });
    res.status(500).json({ error: 'マッチング一覧の取得に失敗しました' });
  }
};

const handleProposalDetail = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseExchangeIdOrBadRequest(res, req.params.id);
    if (!id) return;
    const pharmacyId = req.user!.id;

    const data = await fetchProposalData(id, pharmacyId);
    if (!data) {
      res.status(404).json({ error: 'マッチングが見つかりません' });
      return;
    }

    const { proposal, items } = data;

    // 独立した4クエリを並列実行（fetchProposalData完了後）
    const [[pharmA, pharmB], actionRows, commentRows, feedbackRows, counterOfferRows] = await Promise.all([
      fetchProposalDetailPharmacies(proposal),
      fetchProposalTimelineActionRows(id),
      db.select({
        id: proposalComments.id,
        body: proposalComments.body,
        createdAt: proposalComments.createdAt,
        authorPharmacyId: proposalComments.authorPharmacyId,
        authorName: pharmacies.name,
      })
        .from(proposalComments)
        .leftJoin(pharmacies, eq(proposalComments.authorPharmacyId, pharmacies.id))
        .where(eq(proposalComments.proposalId, id))
        .orderBy(asc(proposalComments.createdAt)),
      db.select({
        id: exchangeFeedback.id,
        rating: exchangeFeedback.rating,
        comment: exchangeFeedback.comment,
        createdAt: exchangeFeedback.createdAt,
        fromPharmacyId: exchangeFeedback.fromPharmacyId,
        fromName: pharmacies.name,
      })
        .from(exchangeFeedback)
        .leftJoin(pharmacies, eq(exchangeFeedback.fromPharmacyId, pharmacies.id))
        .where(eq(exchangeFeedback.proposalId, id))
        .orderBy(asc(exchangeFeedback.createdAt)),
      (async () => {
        try {
          return await db.select({
            id: proposalCounterOffers.id,
            proposerPharmacyId: proposalCounterOffers.proposerPharmacyId,
            responderPharmacyId: proposalCounterOffers.responderPharmacyId,
            status: proposalCounterOffers.status,
            summary: proposalCounterOffers.summary,
            itemsJson: proposalCounterOffers.itemsJson,
            responseNote: proposalCounterOffers.responseNote,
            createdAt: proposalCounterOffers.createdAt,
            respondedAt: proposalCounterOffers.respondedAt,
          })
            .from(proposalCounterOffers)
            .where(eq(proposalCounterOffers.proposalId, id))
            .orderBy(desc(proposalCounterOffers.createdAt));
        } catch {
          return [];
        }
      })(),
    ]);

    const timeline = buildProposalTimeline({
      proposedAt: proposal.proposedAt,
      proposalCreatorPharmacyId: proposal.pharmacyAId,
      proposalCreatorName: pharmA?.name ?? '提案元薬局',
      actionRows,
      includeStatusTransitions: true,
    });

    // Build enriched timeline combining status changes, comments, and feedback
    const enrichedTimeline: EnrichedProposalTimelineEvent[] = [
      // Re-map existing timeline events as status_change
      ...timeline.map((e) => ({
        ...e,
        eventType: 'status_change' as const,
      })),
      // Comment events
      ...commentRows.map((c) => ({
        action: 'comment_added',
        label: 'コメント追加',
        at: c.createdAt,
        actorPharmacyId: c.authorPharmacyId,
        actorName: c.authorName ?? '不明',
        eventType: 'comment' as const,
        commentBody: c.body,
      })),
      // Feedback events
      ...feedbackRows.map((f) => ({
        action: 'feedback_submitted',
        label: '評価登録',
        at: f.createdAt,
        actorPharmacyId: f.fromPharmacyId,
        actorName: f.fromName ?? '不明',
        eventType: 'feedback' as const,
        feedbackRating: f.rating,
        feedbackComment: f.comment ?? undefined,
      })),
      ...counterOfferRows.map((row) => ({
        action: `counter_offer_${row.status}`,
        label: row.status === 'pending'
          ? '正式な反対提案'
          : row.status === 'accepted'
            ? '反対提案承認'
            : row.status === 'rejected'
              ? '反対提案却下'
              : '反対提案更新',
        at: row.respondedAt ?? row.createdAt,
        actorPharmacyId: row.proposerPharmacyId,
        actorName: row.proposerPharmacyId === proposal.pharmacyAId ? pharmA?.name ?? '不明' : pharmB?.name ?? '不明',
        eventType: 'comment' as const,
        commentBody: row.summary,
      })),
    ].sort(compareTimelineAtDesc);

    res.json({
      proposal,
      items,
      pharmacyA: { id: proposal.pharmacyAId, ...pharmA },
      pharmacyB: { id: proposal.pharmacyBId, ...pharmB },
      timeline,
      enrichedTimeline,
      counterOffers: counterOfferRows.map((row) => ({
        ...row,
        items: JSON.parse(row.itemsJson) as ProposalCounterOfferItemInput[],
      })),
    });
  } catch (err) {
    logger.error('Proposal detail error:', { error: getErrorMessage(err) });
    res.status(500).json({ error: 'マッチング詳細の取得に失敗しました' });
  }
};

const handleCreateCounterOffer = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const proposalId = parseExchangeIdOrBadRequest(res, req.params.id);
    if (!proposalId) return;
    const actorId = req.user!.id;

    const [proposal] = await db.select()
      .from(exchangeProposals)
      .where(and(
        eq(exchangeProposals.id, proposalId),
        or(
          eq(exchangeProposals.pharmacyAId, actorId),
          eq(exchangeProposals.pharmacyBId, actorId),
        ),
      ))
      .limit(1);

    if (!proposal) {
      res.status(404).json({ error: '提案が見つかりません' });
      return;
    }

    const items = Array.isArray(req.body?.items) ? req.body.items as Array<Record<string, unknown>> : [];
    const normalizedItems = items
      .map((item: Record<string, unknown>) => ({
        proposalItemId: Number.isInteger(item.proposalItemId) ? Number(item.proposalItemId) : undefined,
        drugName: typeof item.drugName === 'string' ? item.drugName.trim() : '',
        quantity: Number(item.quantity),
      }))
      .filter((item: ProposalCounterOfferItemInput) => item.drugName && Number.isFinite(item.quantity) && item.quantity > 0)
      .slice(0, 20);
    const summary = typeof req.body?.summary === 'string' ? req.body.summary.trim().slice(0, 2000) : '';

    if (!summary || normalizedItems.length === 0) {
      res.status(400).json({ error: 'summary と items が必要です' });
      return;
    }

    await db.update(proposalCounterOffers)
      .set({
        status: 'superseded',
        respondedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(and(
        eq(proposalCounterOffers.proposalId, proposalId),
        eq(proposalCounterOffers.status, 'pending'),
      ));

    const responderPharmacyId = proposal.pharmacyAId === actorId ? proposal.pharmacyBId : proposal.pharmacyAId;
    const [created] = await db.insert(proposalCounterOffers).values({
      proposalId,
      proposerPharmacyId: actorId,
      responderPharmacyId,
      status: 'pending',
      summary,
      itemsJson: JSON.stringify(normalizedItems),
      updatedAt: new Date().toISOString(),
    }).returning({
      id: proposalCounterOffers.id,
      status: proposalCounterOffers.status,
    });

    await createNotification({
      pharmacyId: responderPharmacyId,
      type: 'proposal_status_changed',
      title: '正式な反対提案が届きました',
      message: summary.slice(0, 200),
      referenceType: 'proposal',
      referenceId: proposalId,
      detailJson: {
        counterOfferId: created.id,
        source: 'counter_offer_created',
      },
    });

    res.status(201).json({
      message: '正式な反対提案を送信しました',
      counterOfferId: created.id,
      status: created.status,
    });
  } catch (err) {
    logger.error('Create counter offer error:', { error: getErrorMessage(err) });
    res.status(500).json({ error: '正式な反対提案の作成に失敗しました' });
  }
};

const handleRespondCounterOffer = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const proposalId = parseExchangeIdOrBadRequest(res, req.params.id);
    if (!proposalId) return;
    const counterOfferId = Number(req.params.counterOfferId);
    if (!Number.isInteger(counterOfferId) || counterOfferId <= 0) {
      res.status(400).json({ error: 'counterOfferId が不正です' });
      return;
    }

    const actorId = req.user!.id;
    const decision = req.body?.decision === 'accepted' || req.body?.decision === 'rejected'
      ? req.body.decision as 'accepted' | 'rejected'
      : null;
    const responseNote = typeof req.body?.responseNote === 'string' ? req.body.responseNote.trim().slice(0, 2000) : null;

    if (!decision) {
      res.status(400).json({ error: 'decision が不正です' });
      return;
    }

    const [counterOffer] = await db.select()
      .from(proposalCounterOffers)
      .where(and(
        eq(proposalCounterOffers.id, counterOfferId),
        eq(proposalCounterOffers.proposalId, proposalId),
      ))
      .limit(1);

    if (!counterOffer) {
      res.status(404).json({ error: '正式な反対提案が見つかりません' });
      return;
    }
    if (counterOffer.responderPharmacyId !== actorId) {
      res.status(403).json({ error: 'この反対提案には応答できません' });
      return;
    }
    if (counterOffer.status !== 'pending') {
      res.status(409).json({ error: 'この反対提案はすでに応答済みです' });
      return;
    }

    await db.update(proposalCounterOffers)
      .set({
        status: decision,
        responseNote,
        respondedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(proposalCounterOffers.id, counterOfferId));

    if (decision === 'accepted') {
      const [proposal] = await db.select()
        .from(exchangeProposals)
        .where(eq(exchangeProposals.id, proposalId))
        .limit(1);
      if (!proposal) {
        res.status(404).json({ error: '提案が見つかりません' });
        return;
      }
      const currentItems = await db.select({
        id: exchangeProposalItems.id,
        fromPharmacyId: exchangeProposalItems.fromPharmacyId,
        quantity: exchangeProposalItems.quantity,
        yakkaValue: exchangeProposalItems.yakkaValue,
      })
        .from(exchangeProposalItems)
        .where(eq(exchangeProposalItems.proposalId, proposalId));

      const parsedItems = JSON.parse(counterOffer.itemsJson) as ProposalCounterOfferItemInput[];
      for (const item of parsedItems) {
        if (!item.proposalItemId) continue;
        const existing = currentItems.find((row) => row.id === item.proposalItemId);
        if (!existing) continue;
        const unitPrice = Number(existing.yakkaValue ?? 0) > 0 && existing.quantity > 0
          ? Number(existing.yakkaValue) / existing.quantity
          : 0;
        await db.update(exchangeProposalItems)
          .set({
            quantity: item.quantity,
            yakkaValue: unitPrice > 0 ? String(unitPrice * item.quantity) : existing.yakkaValue,
          })
          .where(eq(exchangeProposalItems.id, item.proposalItemId));
      }

      const updatedItems = await db.select({
        fromPharmacyId: exchangeProposalItems.fromPharmacyId,
        yakkaValue: exchangeProposalItems.yakkaValue,
      })
        .from(exchangeProposalItems)
        .where(eq(exchangeProposalItems.proposalId, proposalId));
      const totalValueA = updatedItems
        .filter((item) => item.fromPharmacyId === proposal.pharmacyAId)
        .reduce((sum, item) => sum + Number(item.yakkaValue ?? 0), 0);
      const totalValueB = updatedItems
        .filter((item) => item.fromPharmacyId === proposal.pharmacyBId)
        .reduce((sum, item) => sum + Number(item.yakkaValue ?? 0), 0);
      await db.update(exchangeProposals)
        .set({
          totalValueA: String(totalValueA),
          totalValueB: String(totalValueB),
          valueDifference: String(Math.abs(totalValueA - totalValueB)),
        })
        .where(eq(exchangeProposals.id, proposalId));
    }

    await createNotification({
      pharmacyId: counterOffer.proposerPharmacyId,
      type: 'proposal_status_changed',
      title: decision === 'accepted' ? '正式な反対提案が承認されました' : '正式な反対提案が却下されました',
      message: responseNote || (decision === 'accepted' ? '相手薬局が反対提案を承認しました。' : '相手薬局が反対提案を却下しました。'),
      referenceType: 'proposal',
      referenceId: proposalId,
      detailJson: {
        counterOfferId,
        source: 'counter_offer_responded',
        decision,
      },
    });

    res.json({ message: decision === 'accepted' ? '反対提案を承認しました' : '反対提案を却下しました' });
  } catch (err) {
    logger.error('Respond counter offer error:', { error: getErrorMessage(err) });
    res.status(500).json({ error: '正式な反対提案への応答に失敗しました' });
  }
};

const handlePrintProposal = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const id = parseExchangeIdOrBadRequest(res, req.params.id);
    if (!id) return;
    const pharmacyId = req.user!.id;

    const data = await fetchProposalData(id, pharmacyId);
    if (!data) {
      res.status(404).json({ error: '提案が見つかりません' });
      return;
    }

    const { proposal, items } = data;

    const [pharmA, pharmB] = await fetchProposalPrintPharmacies(proposal);
    const counterOffers = await (async () => {
      try {
        return await db.select({
          id: proposalCounterOffers.id,
          status: proposalCounterOffers.status,
          summary: proposalCounterOffers.summary,
          itemsJson: proposalCounterOffers.itemsJson,
          createdAt: proposalCounterOffers.createdAt,
          respondedAt: proposalCounterOffers.respondedAt,
        })
          .from(proposalCounterOffers)
          .where(eq(proposalCounterOffers.proposalId, id))
          .orderBy(desc(proposalCounterOffers.createdAt))
          .limit(3);
      } catch {
        return [];
      }
    })();

    res.json({
      proposal,
      items,
      pharmacyA: pharmA ?? null,
      pharmacyB: pharmB ?? null,
      counterOffers: counterOffers.map((row) => ({
        ...row,
        items: JSON.parse(row.itemsJson) as ProposalCounterOfferItemInput[],
      })),
    });
  } catch (err) {
    logger.error('Print data error:', { error: getErrorMessage(err) });
    res.status(500).json({ error: '印刷データの取得に失敗しました' });
  }
};

// Find matching candidates
router.post('/find', findLimiter, handleFind);

// Create proposal from selected candidate
router.post('/proposals', proposalWriteLimiter, handleCreateProposal);

// Bulk accept/reject proposals
router.post('/proposals/bulk-action', proposalWriteLimiter, handleBulkAction);

// Accept proposal (single action endpoint kept for backward compatibility with detail page)
router.post('/proposals/:id/accept', proposalWriteLimiter, handleAcceptProposal);

// Reject proposal (single action endpoint kept for backward compatibility with detail page)
router.post('/proposals/:id/reject', proposalWriteLimiter, handleRejectProposal);

// Complete exchange (single action endpoint kept for backward compatibility with detail page)
router.post('/proposals/:id/complete', proposalWriteLimiter, handleCompleteProposal);

// Pending action count (lightweight badge endpoint)
router.get('/proposals/pending-count', handlePendingCount);

// List my proposals
router.get('/proposals', handleListProposals);

// Proposal detail
router.get('/proposals/:id', handleProposalDetail);

router.post('/proposals/:id/counter-offers', proposalWriteLimiter, handleCreateCounterOffer);
router.post('/proposals/:id/counter-offers/:counterOfferId/respond', proposalWriteLimiter, handleRespondCounterOffer);

// Print data
router.get('/proposals/:id/print', handlePrintProposal);

export default router;
