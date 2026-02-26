import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
  exchangeProposals,
  exchangeProposalItems,
  exchangeHistory,
  deadStockItems,
  pharmacies,
  exchangeFeedback,
  proposalComments,
} from '../db/schema';
import { requireLogin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { findMatches } from '../services/matching-service';
import { createNotification } from '../services/notification-service';
import { createProposal, acceptProposal, rejectProposal, completeProposal } from '../services/exchange-service';
import { processPendingMatchingRefreshJobs } from '../services/matching-refresh-service';
import { parsePagination, parsePositiveInt } from '../utils/request-utils';
import { rowCount } from '../utils/db-utils';
import { logger } from '../services/logger';
import { getProposalPriority } from '../services/proposal-priority-service';
import { recalculateTrustScoreForPharmacy } from '../services/trust-score-service';

const router = Router();
router.use(requireLogin);

const COMMENT_POST_MIN_INTERVAL_MS = 10_000;
const COMMENT_DUPLICATE_WINDOW_MS = 5 * 60 * 1000;
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

function parseBulkAction(raw: unknown): BulkActionType | null {
  if (raw === 'accept' || raw === 'reject') return raw;
  return null;
}

function parseBulkIds(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const normalized = raw
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
  if (normalized.length === 0) return null;
  return [...new Set(normalized)];
}

function sanitizeBulkActionErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : '';
  const hiddenDetailTokens = [
    '見つかりません',
    'アクセス権限',
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
  if (message.includes('見つかりません') || message.includes('アクセス権限')) {
    return { status: 404, message: 'マッチングが見つかりません' };
  }
  if (message.includes('状態が変更された')) {
    return { status: 409, message: '状態が変更されたため、再読み込みして再試行してください' };
  }
  return { status: 400, message: '操作に失敗しました' };
}

// Find matching candidates
router.post('/find', findLimiter, async (req: AuthRequest, res: Response) => {
  try {
    await processPendingMatchingRefreshJobs().catch((err) => {
      logger.warn('Processing pending matching refresh jobs failed before find', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
    const candidates = await findMatches(req.user!.id);
    res.json({ candidates });
  } catch (err) {
    logger.error('Find matches error:', { error: (err as Error).message });
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
    logger.error('Create proposal error:', { error: (err as Error).message });
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
    }> = [];

    for (const id of ids) {
      try {
        if (action === 'accept') {
          const nextStatus = await acceptProposal(id, actorId);
          results.push({
            id,
            ok: true,
            status: nextStatus,
            message: nextStatus === 'confirmed'
              ? '仮マッチングが確定しました'
              : '承認しました（相手薬局の承認待ち）',
          });
        } else {
          await rejectProposal(id, actorId);
          results.push({
            id,
            ok: true,
            status: 'rejected',
            message: '拒否しました',
          });
        }
      } catch (err) {
        logger.warn('Bulk proposal action item failed', {
          proposalId: id,
          action,
          actorId,
          error: err instanceof Error ? err.message : String(err),
        });
        results.push({ id, ok: false, error: sanitizeBulkActionErrorMessage(err) });
      }
    }

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
    logger.error('Bulk proposal action error', { error: (err as Error).message });
    res.status(500).json({ error: '一括操作に失敗しました' });
  }
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
    const proposalSelect = {
      id: exchangeProposals.id,
      pharmacyAId: exchangeProposals.pharmacyAId,
      pharmacyBId: exchangeProposals.pharmacyBId,
      status: exchangeProposals.status,
      totalValueA: exchangeProposals.totalValueA,
      totalValueB: exchangeProposals.totalValueB,
      valueDifference: exchangeProposals.valueDifference,
      proposedAt: exchangeProposals.proposedAt,
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

    const pharmacyIds = [...new Set(rows.flatMap((row) => [row.pharmacyAId, row.pharmacyBId]))];
    const pharmacyRows = pharmacyIds.length > 0
      ? await db.select({ id: pharmacies.id, name: pharmacies.name })
        .from(pharmacies)
        .where(inArray(pharmacies.id, pharmacyIds))
      : [];
    const pharmacyMap = new Map(pharmacyRows.map((row) => [row.id, row.name]));

    const prioritized = rows.map((row) => {
      const priority = getProposalPriority({
        id: row.id,
        pharmacyAId: row.pharmacyAId,
        pharmacyBId: row.pharmacyBId,
        status: row.status,
        proposedAt: row.proposedAt,
      }, pharmacyId);

      return {
        ...row,
        pharmacyAName: pharmacyMap.get(row.pharmacyAId) ?? '',
        pharmacyBName: pharmacyMap.get(row.pharmacyBId) ?? '',
        priorityScore: priority.priorityScore,
        priorityReasons: priority.priorityReasons,
        deadlineAt: priority.deadlineAt,
      };
    });

    const enriched = prioritized;

    res.json({
      data: enriched,
      pagination: { page, limit, total: totalCount, totalPages: Math.ceil(totalCount / limit) },
    });
  } catch (err) {
    logger.error('List proposals error:', { error: (err as Error).message });
    res.status(500).json({ error: 'マッチング一覧の取得に失敗しました' });
  }
});

// Proposal detail
router.get('/proposals/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: '不正なIDです' });
      return;
    }
    const pharmacyId = req.user!.id;

    const [proposal] = await db.select()
      .from(exchangeProposals)
      .where(and(
        eq(exchangeProposals.id, id),
        or(
          eq(exchangeProposals.pharmacyAId, pharmacyId),
          eq(exchangeProposals.pharmacyBId, pharmacyId),
        ),
      ))
      .limit(1);

    if (!proposal) {
      res.status(404).json({ error: 'マッチングが見つかりません' });
      return;
    }

    // Get items
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
      .where(eq(exchangeProposalItems.proposalId, id));

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

    res.json({
      proposal,
      items,
      pharmacyA: { id: proposal.pharmacyAId, ...pharmA },
      pharmacyB: { id: proposal.pharmacyBId, ...pharmB },
    });
  } catch (err) {
    logger.error('Proposal detail error:', { error: (err as Error).message });
    res.status(500).json({ error: 'マッチング詳細の取得に失敗しました' });
  }
});

// Print data
router.get('/proposals/:id/print', async (req: AuthRequest, res: Response) => {
  try {
    // Reuse detail logic
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: '不正なIDです' });
      return;
    }
    const pharmacyId = req.user!.id;

    const [proposal] = await db.select()
      .from(exchangeProposals)
      .where(and(
        eq(exchangeProposals.id, id),
        or(
          eq(exchangeProposals.pharmacyAId, pharmacyId),
          eq(exchangeProposals.pharmacyBId, pharmacyId),
        ),
      ))
      .limit(1);

    if (!proposal) { res.status(404).json({ error: '提案が見つかりません' }); return; }

    const items = await db.select({
      id: exchangeProposalItems.id,
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
      .where(eq(exchangeProposalItems.proposalId, id));

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
    logger.error('Print data error:', { error: (err as Error).message });
    res.status(500).json({ error: '印刷データの取得に失敗しました' });
  }
});

// Accept proposal
router.post('/proposals/:id/accept', async (req: AuthRequest, res: Response) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: '不正なIDです' });
      return;
    }
    const newStatus = await acceptProposal(id, req.user!.id);
    const msg = newStatus === 'confirmed' ? '仮マッチングが確定しました' : '仮マッチングを承認しました（相手薬局の承認待ち）';
    res.json({ message: msg, status: newStatus });
  } catch (err) {
    const failure = sanitizeProposalActionError(err);
    res.status(failure.status).json({ error: failure.message });
  }
});

// Reject proposal
router.post('/proposals/:id/reject', async (req: AuthRequest, res: Response) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: '不正なIDです' });
      return;
    }
    await rejectProposal(id, req.user!.id);
    res.json({ message: '仮マッチングを拒否しました' });
  } catch (err) {
    const failure = sanitizeProposalActionError(err);
    res.status(failure.status).json({ error: failure.message });
  }
});

// Complete exchange
router.post('/proposals/:id/complete', async (req: AuthRequest, res: Response) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: '不正なIDです' });
      return;
    }
    await completeProposal(id, req.user!.id);
    res.json({ message: '交換を完了しました' });
  } catch (err) {
    const failure = sanitizeProposalActionError(err);
    res.status(failure.status).json({ error: failure.message });
  }
});

// Submit exchange feedback (participants only, completed proposals only)
router.post('/proposals/:id/feedback', async (req: AuthRequest, res: Response) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: '不正なIDです' });
      return;
    }

    const rating = Number(req.body?.rating);
    const commentRaw = typeof req.body?.comment === 'string' ? req.body.comment : '';
    const comment = commentRaw.trim();
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      res.status(400).json({ error: '評価は1〜5で入力してください' });
      return;
    }
    if (comment.length > 300) {
      res.status(400).json({ error: 'コメントは300文字以内で入力してください' });
      return;
    }

    const [proposal] = await db.select({
      id: exchangeProposals.id,
      status: exchangeProposals.status,
      pharmacyAId: exchangeProposals.pharmacyAId,
      pharmacyBId: exchangeProposals.pharmacyBId,
    })
      .from(exchangeProposals)
      .where(and(
        eq(exchangeProposals.id, id),
        or(
          eq(exchangeProposals.pharmacyAId, req.user!.id),
          eq(exchangeProposals.pharmacyBId, req.user!.id),
        ),
      ))
      .limit(1);

    if (!proposal) {
      res.status(404).json({ error: 'マッチングが見つかりません' });
      return;
    }
    if (proposal.status !== 'completed') {
      res.status(400).json({ error: '完了済みマッチングのみ評価できます' });
      return;
    }

    const actorId = req.user!.id;
    const isA = proposal.pharmacyAId === actorId;

    const targetPharmacyId = isA ? proposal.pharmacyBId : proposal.pharmacyAId;
    const now = new Date().toISOString();

    await db.insert(exchangeFeedback).values({
      proposalId: proposal.id,
      fromPharmacyId: actorId,
      toPharmacyId: targetPharmacyId,
      rating,
      comment: comment.length > 0 ? comment : null,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [exchangeFeedback.proposalId, exchangeFeedback.fromPharmacyId],
      set: {
        rating,
        comment: comment.length > 0 ? comment : null,
        updatedAt: now,
      },
    });

    await recalculateTrustScoreForPharmacy(targetPharmacyId);

    res.status(201).json({ message: '取引評価を登録しました' });
  } catch (err) {
    logger.error('Proposal feedback error', { error: (err as Error).message });
    res.status(500).json({ error: '取引評価の登録に失敗しました' });
  }
});

// Proposal comments
router.get('/proposals/:id/comments', async (req: AuthRequest, res: Response) => {
  try {
    const proposalId = parsePositiveInt(req.params.id);
    if (!proposalId) {
      res.status(400).json({ error: '不正なIDです' });
      return;
    }
    const { page, limit, offset } = parsePagination(req.query.page, req.query.limit, {
      defaultLimit: 50,
      maxLimit: 200,
    });

    const [proposal] = await db.select({
      id: exchangeProposals.id,
      pharmacyAId: exchangeProposals.pharmacyAId,
      pharmacyBId: exchangeProposals.pharmacyBId,
    })
      .from(exchangeProposals)
      .where(and(
        eq(exchangeProposals.id, proposalId),
        or(
          eq(exchangeProposals.pharmacyAId, req.user!.id),
          eq(exchangeProposals.pharmacyBId, req.user!.id),
        ),
      ))
      .limit(1);

    if (!proposal) {
      res.status(404).json({ error: 'マッチングが見つかりません' });
      return;
    }

    const [rows, [countRow]] = await Promise.all([
      db.select({
        id: proposalComments.id,
        proposalId: proposalComments.proposalId,
        authorPharmacyId: proposalComments.authorPharmacyId,
        authorName: pharmacies.name,
        body: proposalComments.body,
        isDeleted: proposalComments.isDeleted,
        createdAt: proposalComments.createdAt,
        updatedAt: proposalComments.updatedAt,
      })
        .from(proposalComments)
        .innerJoin(pharmacies, eq(proposalComments.authorPharmacyId, pharmacies.id))
        .where(eq(proposalComments.proposalId, proposalId))
        .orderBy(asc(proposalComments.createdAt), asc(proposalComments.id))
        .limit(limit)
        .offset(offset),
      db.select({ count: rowCount })
        .from(proposalComments)
        .where(eq(proposalComments.proposalId, proposalId)),
    ]);

    res.json({
      data: rows.map((row) => ({
        ...row,
        body: row.isDeleted ? '（削除済み）' : row.body,
      })),
      pagination: {
        page,
        limit,
        total: countRow.count,
        totalPages: Math.ceil(countRow.count / limit),
      },
    });
  } catch (err) {
    logger.error('List proposal comments error', { error: (err as Error).message });
    res.status(500).json({ error: 'コメント一覧の取得に失敗しました' });
  }
});

router.post('/proposals/:id/comments', async (req: AuthRequest, res: Response) => {
  try {
    const proposalId = parsePositiveInt(req.params.id);
    if (!proposalId) {
      res.status(400).json({ error: '不正なIDです' });
      return;
    }

    const [proposal] = await db.select({
      id: exchangeProposals.id,
      pharmacyAId: exchangeProposals.pharmacyAId,
      pharmacyBId: exchangeProposals.pharmacyBId,
    })
      .from(exchangeProposals)
      .where(and(
        eq(exchangeProposals.id, proposalId),
        or(
          eq(exchangeProposals.pharmacyAId, req.user!.id),
          eq(exchangeProposals.pharmacyBId, req.user!.id),
        ),
      ))
      .limit(1);

    if (!proposal) {
      res.status(404).json({ error: 'マッチングが見つかりません' });
      return;
    }

    if (req.user?.isAdmin) {
      res.status(403).json({ error: '管理者はコメントを投稿できません' });
      return;
    }

    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!body) {
      res.status(400).json({ error: 'コメント本文を入力してください' });
      return;
    }
    if (body.length > 1000) {
      res.status(400).json({ error: 'コメントは1000文字以内で入力してください' });
      return;
    }

    const saved = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${proposalId}, ${req.user!.id})`);
      const [latestOwnComment] = await tx.select({
        body: proposalComments.body,
        createdAt: proposalComments.createdAt,
      })
        .from(proposalComments)
        .where(and(
          eq(proposalComments.proposalId, proposalId),
          eq(proposalComments.authorPharmacyId, req.user!.id),
          eq(proposalComments.isDeleted, false),
        ))
        .orderBy(desc(proposalComments.createdAt), desc(proposalComments.id))
        .limit(1);

      if (latestOwnComment?.createdAt) {
        const latestPostedAtMs = Date.parse(latestOwnComment.createdAt);
        if (Number.isFinite(latestPostedAtMs)) {
          const elapsedMs = Date.now() - latestPostedAtMs;
          if (elapsedMs < COMMENT_POST_MIN_INTERVAL_MS) {
            throw new Error('RATE_LIMIT_SHORT_INTERVAL');
          }
          if (latestOwnComment.body.trim() === body && elapsedMs < COMMENT_DUPLICATE_WINDOW_MS) {
            throw new Error('RATE_LIMIT_DUPLICATE_BODY');
          }
        }
      }

      const now = new Date().toISOString();
      const [inserted] = await tx.insert(proposalComments).values({
        proposalId,
        authorPharmacyId: req.user!.id,
        body,
        isDeleted: false,
        createdAt: now,
        updatedAt: now,
      }).returning({
        id: proposalComments.id,
        proposalId: proposalComments.proposalId,
        authorPharmacyId: proposalComments.authorPharmacyId,
        body: proposalComments.body,
        isDeleted: proposalComments.isDeleted,
        createdAt: proposalComments.createdAt,
        updatedAt: proposalComments.updatedAt,
      });
      if (!inserted) throw new Error('COMMENT_INSERT_FAILED');
      return inserted;
    });

    const recipientId = proposal.pharmacyAId === req.user!.id
      ? proposal.pharmacyBId
      : proposal.pharmacyAId;

    const notificationResult = await createNotification({
      pharmacyId: recipientId,
      type: 'new_comment',
      title: 'コメントが追加されました',
      message: body.length > 50 ? body.substring(0, 50) + '...' : body,
      referenceType: 'proposal',
      referenceId: proposalId,
    });
    if (!notificationResult) {
      logger.warn('Proposal comment notification could not be persisted', {
        proposalId,
        recipientId,
      });
    }

    res.status(201).json({ message: 'コメントを投稿しました', comment: saved });
  } catch (err) {
    if (err instanceof Error && err.message === 'RATE_LIMIT_SHORT_INTERVAL') {
      res.setHeader('Retry-After', String(Math.ceil(COMMENT_POST_MIN_INTERVAL_MS / 1000)));
      res.status(429).json({ error: '短時間での連続投稿はできません。少し待ってから投稿してください。' });
      return;
    }
    if (err instanceof Error && err.message === 'RATE_LIMIT_DUPLICATE_BODY') {
      res.status(429).json({ error: '同じ内容の連続投稿はできません。' });
      return;
    }
    logger.error('Create proposal comment error', { error: (err as Error).message });
    res.status(500).json({ error: 'コメント投稿に失敗しました' });
  }
});

router.patch('/proposals/:id/comments/:commentId', async (req: AuthRequest, res: Response) => {
  try {
    const proposalId = parsePositiveInt(req.params.id);
    const commentId = parsePositiveInt(req.params.commentId);
    if (!proposalId || !commentId) {
      res.status(400).json({ error: '不正なIDです' });
      return;
    }

    if (req.user?.isAdmin) {
      res.status(403).json({ error: '管理者はコメントを編集できません' });
      return;
    }

    const [current] = await db.select({
      id: proposalComments.id,
      proposalId: proposalComments.proposalId,
      isDeleted: proposalComments.isDeleted,
    })
      .from(proposalComments)
      .where(and(
        eq(proposalComments.id, commentId),
        eq(proposalComments.proposalId, proposalId),
        eq(proposalComments.authorPharmacyId, req.user!.id),
      ))
      .limit(1);

    if (!current) {
      res.status(404).json({ error: 'コメントが見つかりません' });
      return;
    }
    if (current.isDeleted) {
      res.status(400).json({ error: '削除済みコメントは編集できません' });
      return;
    }

    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!body) {
      res.status(400).json({ error: 'コメント本文を入力してください' });
      return;
    }
    if (body.length > 1000) {
      res.status(400).json({ error: 'コメントは1000文字以内で入力してください' });
      return;
    }

    await db.update(proposalComments)
      .set({ body, updatedAt: new Date().toISOString() })
      .where(eq(proposalComments.id, commentId));

    res.json({ message: 'コメントを更新しました' });
  } catch (err) {
    logger.error('Update proposal comment error', { error: (err as Error).message });
    res.status(500).json({ error: 'コメント更新に失敗しました' });
  }
});

router.delete('/proposals/:id/comments/:commentId', async (req: AuthRequest, res: Response) => {
  try {
    const proposalId = parsePositiveInt(req.params.id);
    const commentId = parsePositiveInt(req.params.commentId);
    if (!proposalId || !commentId) {
      res.status(400).json({ error: '不正なIDです' });
      return;
    }

    if (req.user?.isAdmin) {
      res.status(403).json({ error: '管理者はコメントを削除できません' });
      return;
    }

    const [current] = await db.select({
      id: proposalComments.id,
      proposalId: proposalComments.proposalId,
      isDeleted: proposalComments.isDeleted,
    })
      .from(proposalComments)
      .where(and(
        eq(proposalComments.id, commentId),
        eq(proposalComments.proposalId, proposalId),
        eq(proposalComments.authorPharmacyId, req.user!.id),
      ))
      .limit(1);

    if (!current) {
      res.status(404).json({ error: 'コメントが見つかりません' });
      return;
    }
    if (current.isDeleted) {
      res.status(400).json({ error: '既に削除済みです' });
      return;
    }

    await db.update(proposalComments)
      .set({
        isDeleted: true,
        body: '',
        updatedAt: new Date().toISOString(),
      })
      .where(eq(proposalComments.id, commentId));

    res.json({ message: 'コメントを削除しました' });
  } catch (err) {
    logger.error('Delete proposal comment error', { error: (err as Error).message });
    res.status(500).json({ error: 'コメント削除に失敗しました' });
  }
});

// Exchange history
router.get('/history', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parsePagination(req.query.page, req.query.limit, {
      defaultLimit: 20,
      maxLimit: 100,
      maxPage: 200,
    });
    const pharmacyId = req.user!.id;
    const ownershipFilter = or(
      eq(exchangeHistory.pharmacyAId, pharmacyId),
      eq(exchangeHistory.pharmacyBId, pharmacyId),
    );

    const [rows, [countRow]] = await Promise.all([
      db.select()
        .from(exchangeHistory)
        .where(ownershipFilter)
        .orderBy(desc(exchangeHistory.completedAt), desc(exchangeHistory.id))
        .limit(limit)
        .offset(offset),
      db.select({ count: rowCount })
        .from(exchangeHistory)
        .where(ownershipFilter),
    ]);

    const pharmacyIds = [...new Set(rows.flatMap((row) => [row.pharmacyAId, row.pharmacyBId]))];
    const pharmacyRows = pharmacyIds.length > 0
      ? await db.select({ id: pharmacies.id, name: pharmacies.name })
        .from(pharmacies)
        .where(inArray(pharmacies.id, pharmacyIds))
      : [];
    const pharmacyMap = new Map(pharmacyRows.map((row) => [row.id, row.name]));

    const enriched = rows.map((row) => ({
      ...row,
      pharmacyAName: pharmacyMap.get(row.pharmacyAId) ?? '',
      pharmacyBName: pharmacyMap.get(row.pharmacyBId) ?? '',
    }));

    const totalCount = countRow.count;

    res.json({
      data: enriched,
      pagination: { page, limit, total: totalCount, totalPages: Math.ceil(totalCount / limit) },
    });
  } catch (err) {
    logger.error('Exchange history error:', { error: (err as Error).message });
    res.status(500).json({ error: '交換履歴の取得に失敗しました' });
  }
});

export default router;
