import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
  exchangeProposals,
  exchangeProposalItems,
  deadStockItems,
  pharmacies,
  activityLogs,
} from '../db/schema';
import { AuthRequest } from '../types';
import { findMatches } from '../services/matching-service';
import { createProposal, acceptProposal, rejectProposal } from '../services/exchange-service';
import { processPendingMatchingRefreshJobs } from '../services/matching-refresh-service';
import { parsePagination, parsePositiveInt } from '../utils/request-utils';
import { rowCount } from '../utils/db-utils';
import { logger } from '../services/logger';
import { getProposalPriority } from '../services/proposal-priority-service';

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

    const actionRows = await db.select({
      action: activityLogs.action,
      detail: activityLogs.detail,
      createdAt: activityLogs.createdAt,
      actorPharmacyId: activityLogs.pharmacyId,
      actorName: pharmacies.name,
    })
      .from(activityLogs)
      .leftJoin(pharmacies, eq(activityLogs.pharmacyId, pharmacies.id))
      .where(and(
        inArray(activityLogs.action, ['proposal_accept', 'proposal_reject', 'proposal_complete', 'proposal_create']),
        sql`${activityLogs.detail} LIKE ${`%proposalId=${id}%`}`,
      ))
      .orderBy(asc(activityLogs.createdAt), asc(activityLogs.id));

    let previousStatus: string = 'proposed';
    const timeline = [
      {
        action: 'proposal_created',
        label: '仮マッチング作成',
        at: proposal.proposedAt,
        actorPharmacyId: proposal.pharmacyAId,
        actorName: pharmA?.name ?? '提案元薬局',
        statusFrom: null,
        statusTo: 'proposed',
      },
      ...actionRows.map((row) => {
        const nextStatus = row.action === 'proposal_accept'
          ? (row.detail?.match(/status=([^|]+)/)?.[1] ?? 'accepted')
          : row.action === 'proposal_reject'
            ? 'rejected'
            : row.action === 'proposal_complete'
              ? 'completed'
              : null;
        const event = {
          action: row.action,
          label: row.action === 'proposal_accept'
            ? '承認'
            : row.action === 'proposal_reject'
              ? '拒否'
              : row.action === 'proposal_complete'
                ? '交換完了'
                : 'ステータス更新',
          at: row.createdAt,
          actorPharmacyId: row.actorPharmacyId,
          actorName: row.actorName ?? '不明',
          statusFrom: nextStatus ? previousStatus : null,
          statusTo: nextStatus,
        };
        if (nextStatus) previousStatus = nextStatus;
        return event;
      }),
    ];

    res.json({
      proposal,
      items,
      pharmacyA: { id: proposal.pharmacyAId, ...pharmA },
      pharmacyB: { id: proposal.pharmacyBId, ...pharmB },
      timeline,
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

export default router;
