import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { and, asc, desc, eq, or, sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
  exchangeProposals,
  exchangeProposalItems,
  deadStockItems,
  pharmacies,
} from '../db/schema';
import { AuthRequest } from '../types';
import { findMatches } from '../services/matching-service';
import { createProposal, acceptProposal, rejectProposal, completeProposal } from '../services/exchange-service';
import { parsePagination, isPositiveSafeInteger } from '../utils/request-utils';
import { rowCount } from '../utils/db-utils';
import { logger } from '../services/logger';
import { getProposalPriority } from '../services/proposal-priority-service';
import { getClientIp, writeLog } from '../services/log-service';
import {
  buildProposalTimeline,
  fetchProposalTimelineActionRows,
} from '../services/proposal-timeline-service';
import { parseExchangeIdOrBadRequest } from './exchange-utils';
import { getErrorMessage } from '../middleware/error-handler';

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

type BulkActionType = 'accept' | 'reject';
const BULK_ACTION_CONCURRENCY = 8;
type ProposalLogAction = 'proposal_accept' | 'proposal_reject' | 'proposal_complete';

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

  async function worker() {
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

function sanitizeBulkActionErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : '';
  const hiddenDetailTokens = [
    '見つかりません',
    'アクセス権限',
    'アクセスする権限',
    '承認できる状態',
    '拒否できる状態',
    '状態が変更された',
    '完了できません',
  ];
  if (hiddenDetailTokens.some((token) => message.includes(token))) {
    return '対象を処理できませんでした';
  }
  return '操作に失敗しました';
}

function sanitizeProposalActionError(err: unknown): { status: number; message: string } {
  const message = err instanceof Error ? err.message : '';
  if (
    message.includes('見つかりません')
    || message.includes('アクセス権限')
    || message.includes('アクセスする権限')
  ) {
    return { status: 404, message: 'マッチングが見つかりません' };
  }
  if (message.includes('状態が変更された')) {
    return { status: 409, message: '状態が変更されたため、再読み込みして再試行してください' };
  }
  return { status: 400, message: '操作に失敗しました' };
}

interface ProposalActionHandlerConfig<TResult> {
  logAction: ProposalLogAction;
  run: (proposalId: number, actorId: number) => Promise<TResult>;
  buildLogDetail: (proposalId: number, result: TResult) => string;
  buildResponse: (result: TResult) => Record<string, unknown>;
}

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
    void writeLog(config.logAction, {
      pharmacyId: actorId,
      detail: config.buildLogDetail(id, result),
      ipAddress: getClientIp(req),
    });
    res.json(config.buildResponse(result));
  } catch (err) {
    const failure = sanitizeProposalActionError(err);
    res.status(failure.status).json({ error: failure.message });
  }
}

// Find matching candidates
router.post('/find', findLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const candidates = await findMatches(req.user!.id);
    res.json({ candidates });
  } catch (err) {
    logger.error('Find matches error:', { error: getErrorMessage(err) });
    const message = process.env.NODE_ENV === 'production'
      ? 'マッチングに失敗しました'
      : (err instanceof Error ? err.message : 'マッチングに失敗しました');
    res.status(500).json({ error: message });
  }
});

// Create proposal from selected candidate
router.post('/proposals', async (req: AuthRequest, res: Response) => {
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
});

// Bulk accept/reject proposals
router.post('/proposals/bulk-action', async (req: AuthRequest, res: Response) => {
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
    const results: Array<{
      id: number;
      ok: boolean;
      status?: string;
      message?: string;
      error?: string;
    }> = await mapWithConcurrency(ids, BULK_ACTION_CONCURRENCY, async (id) => {
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
        return { id, ok: false, error: sanitizeBulkActionErrorMessage(err) };
      }
    });

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
});

// Accept proposal (single action endpoint kept for backward compatibility with detail page)
router.post('/proposals/:id/accept', async (req: AuthRequest, res: Response) => {
  await handleProposalAction(req, res, {
    logAction: 'proposal_accept',
    run: acceptProposal,
    buildLogDetail: (proposalId, status) => `proposalId=${proposalId}|status=${status}`,
    buildResponse: (status) => ({
      message: status === 'confirmed'
        ? '仮マッチングが確定しました'
        : '仮マッチングを承認しました（相手薬局の承認待ち）',
      status,
    }),
  });
});

// Reject proposal (single action endpoint kept for backward compatibility with detail page)
router.post('/proposals/:id/reject', async (req: AuthRequest, res: Response) => {
  await handleProposalAction(req, res, {
    logAction: 'proposal_reject',
    run: rejectProposal,
    buildLogDetail: (proposalId) => `proposalId=${proposalId}|status=rejected`,
    buildResponse: () => ({ message: '仮マッチングを拒否しました' }),
  });
});

// Complete exchange (single action endpoint kept for backward compatibility with detail page)
router.post('/proposals/:id/complete', async (req: AuthRequest, res: Response) => {
  await handleProposalAction(req, res, {
    logAction: 'proposal_complete',
    run: completeProposal,
    buildLogDetail: (proposalId) => `proposalId=${proposalId}|status=completed`,
    buildResponse: () => ({ message: '交換を完了しました' }),
  });
});

// List my proposals
router.get('/proposals', async (req: AuthRequest, res: Response) => {
  try {
    const sort = typeof req.query.sort === 'string' ? req.query.sort : 'recent';
    const { page, limit, offset } = parsePagination(req.query.page, req.query.limit, {
      defaultLimit: 20,
      maxLimit: 100,
    });
    const pharmacyId = req.user!.id;
    const pharmacyAName = sql<string>`(SELECT name FROM pharmacies WHERE id = ${exchangeProposals.pharmacyAId})`.as('pharmacy_a_name');
    const pharmacyBName = sql<string>`(SELECT name FROM pharmacies WHERE id = ${exchangeProposals.pharmacyBId})`.as('pharmacy_b_name');
    const proposalSelect = {
      id: exchangeProposals.id,
      pharmacyAId: exchangeProposals.pharmacyAId,
      pharmacyBId: exchangeProposals.pharmacyBId,
      status: exchangeProposals.status,
      totalValueA: exchangeProposals.totalValueA,
      totalValueB: exchangeProposals.totalValueB,
      valueDifference: exchangeProposals.valueDifference,
      proposedAt: exchangeProposals.proposedAt,
      pharmacyAName,
      pharmacyBName,
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
    const deadlineAtExpr = sql`(${exchangeProposals.proposedAt} + interval '72 hours')`;
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
    const totalCount = countRow.count;
    const enriched = rows.map((row) => {
      const priority = getProposalPriority({
        id: row.id,
        pharmacyAId: row.pharmacyAId,
        pharmacyBId: row.pharmacyBId,
        status: row.status,
        proposedAt: row.proposedAt,
      }, pharmacyId);

      return {
        ...row,
        pharmacyAName: row.pharmacyAName ?? '',
        pharmacyBName: row.pharmacyBName ?? '',
        priorityScore: priority.priorityScore,
        priorityReasons: priority.priorityReasons,
        deadlineAt: priority.deadlineAt,
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
});

async function fetchProposalData(proposalId: number, pharmacyId: number) {
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
// Proposal detail
router.get('/proposals/:id', async (req: AuthRequest, res: Response) => {
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

    // Get pharmacy info
    const [[pharmA], [pharmB]] = await Promise.all([
      db.select({
        name: pharmacies.name, phone: pharmacies.phone, fax: pharmacies.fax,
        address: pharmacies.address, prefecture: pharmacies.prefecture,
      }).from(pharmacies).where(eq(pharmacies.id, proposal.pharmacyAId)).limit(1),
      db.select({
        name: pharmacies.name, phone: pharmacies.phone, fax: pharmacies.fax,
        address: pharmacies.address, prefecture: pharmacies.prefecture,
      }).from(pharmacies).where(eq(pharmacies.id, proposal.pharmacyBId)).limit(1),
    ]);

    const actionRows = await fetchProposalTimelineActionRows(id);
    const timeline = buildProposalTimeline({
      proposedAt: proposal.proposedAt,
      proposalCreatorPharmacyId: proposal.pharmacyAId,
      proposalCreatorName: pharmA?.name ?? '提案元薬局',
      actionRows,
      includeStatusTransitions: true,
    });

    res.json({
      proposal,
      items,
      pharmacyA: { id: proposal.pharmacyAId, ...pharmA },
      pharmacyB: { id: proposal.pharmacyBId, ...pharmB },
      timeline,
    });
  } catch (err) {
    logger.error('Proposal detail error:', { error: getErrorMessage(err) });
    res.status(500).json({ error: 'マッチング詳細の取得に失敗しました' });
  }
});

// Print data
router.get('/proposals/:id/print', async (req: AuthRequest, res: Response) => {
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

    const printFields = {
      name: pharmacies.name, phone: pharmacies.phone, fax: pharmacies.fax,
      address: pharmacies.address, prefecture: pharmacies.prefecture, licenseNumber: pharmacies.licenseNumber,
    };
    const [[pharmA], [pharmB]] = await Promise.all([
      db.select(printFields).from(pharmacies).where(eq(pharmacies.id, proposal.pharmacyAId)).limit(1),
      db.select(printFields).from(pharmacies).where(eq(pharmacies.id, proposal.pharmacyBId)).limit(1),
    ]);

    res.json({
      proposal,
      items,
      pharmacyA: pharmA ?? null,
      pharmacyB: pharmB ?? null,
    });
  } catch (err) {
    logger.error('Print data error:', { error: getErrorMessage(err) });
    res.status(500).json({ error: '印刷データの取得に失敗しました' });
  }
});

export default router;
