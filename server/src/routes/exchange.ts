import { Router, Response } from 'express';
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
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
import { getProposalPriority, sortByPriority } from '../services/proposal-priority-service';
import { recalculateTrustScoreForPharmacy } from '../services/trust-score-service';

const router = Router();
router.use(requireLogin);

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

function proposalAccessibleByUser(
  proposal: { pharmacyAId: number; pharmacyBId: number },
  user: { id: number; isAdmin: boolean },
): boolean {
  return user.isAdmin || proposal.pharmacyAId === user.id || proposal.pharmacyBId === user.id;
}

// Find matching candidates
router.post('/find', async (req: AuthRequest, res: Response) => {
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
      res.status(400).json({ error: err.message });
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
        const message = err instanceof Error ? err.message : '操作に失敗しました';
        results.push({ id, ok: false, error: message });
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
    const [rows, totalCount] = sort === 'priority'
      ? await (async () => {
        const allRows = await db.select(proposalSelect)
          .from(exchangeProposals)
          .where(ownershipFilter)
          .orderBy(desc(exchangeProposals.proposedAt), desc(exchangeProposals.id));
        return [allRows, allRows.length] as const;
      })()
      : await (async () => {
        const [pagedRows, [countRow]] = await Promise.all([
          db.select(proposalSelect)
            .from(exchangeProposals)
            .where(ownershipFilter)
            .orderBy(desc(exchangeProposals.proposedAt), desc(exchangeProposals.id))
            .limit(limit)
            .offset(offset),
          db.select({ count: rowCount })
            .from(exchangeProposals)
            .where(ownershipFilter),
        ]);
        return [pagedRows, countRow.count] as const;
      })();

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

    const enriched = sort === 'priority'
      ? sortByPriority(prioritized).slice(offset, offset + limit)
      : prioritized;

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
      .where(eq(exchangeProposals.id, id))
      .limit(1);

    if (!proposal) {
      res.status(404).json({ error: 'マッチングが見つかりません' });
      return;
    }

    if (proposal.pharmacyAId !== pharmacyId && proposal.pharmacyBId !== pharmacyId) {
      res.status(403).json({ error: 'アクセス権限がありません' });
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
      .where(eq(exchangeProposals.id, id))
      .limit(1);

    if (!proposal) { res.status(404).json({ error: '提案が見つかりません' }); return; }
    if (proposal.pharmacyAId !== pharmacyId && proposal.pharmacyBId !== pharmacyId) {
      res.status(403).json({ error: 'アクセス権限がありません' }); return;
    }

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
    res.status(400).json({ error: err instanceof Error ? err.message : '承認に失敗しました' });
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
    res.status(400).json({ error: err instanceof Error ? err.message : '拒否に失敗しました' });
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
    res.status(400).json({ error: err instanceof Error ? err.message : '完了処理に失敗しました' });
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
      .where(eq(exchangeProposals.id, id))
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
    const isB = proposal.pharmacyBId === actorId;
    if (!isA && !isB) {
      res.status(403).json({ error: 'このマッチングにアクセスする権限がありません' });
      return;
    }

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

    const [proposal] = await db.select({
      id: exchangeProposals.id,
      pharmacyAId: exchangeProposals.pharmacyAId,
      pharmacyBId: exchangeProposals.pharmacyBId,
    })
      .from(exchangeProposals)
      .where(eq(exchangeProposals.id, proposalId))
      .limit(1);

    if (!proposal) {
      res.status(404).json({ error: 'マッチングが見つかりません' });
      return;
    }

    const viewer = { id: req.user!.id, isAdmin: Boolean(req.user?.isAdmin) };
    if (!proposalAccessibleByUser(proposal, viewer)) {
      res.status(403).json({ error: 'アクセス権限がありません' });
      return;
    }

    const rows = await db.select({
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
      .orderBy(asc(proposalComments.createdAt), asc(proposalComments.id));

    res.json({
      data: rows.map((row) => ({
        ...row,
        body: row.isDeleted ? '（削除済み）' : row.body,
      })),
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
      .where(eq(exchangeProposals.id, proposalId))
      .limit(1);

    if (!proposal) {
      res.status(404).json({ error: 'マッチングが見つかりません' });
      return;
    }

    if (req.user?.isAdmin) {
      res.status(403).json({ error: '管理者はコメントを投稿できません' });
      return;
    }

    const isParty = proposal.pharmacyAId === req.user!.id || proposal.pharmacyBId === req.user!.id;
    if (!isParty) {
      res.status(403).json({ error: 'アクセス権限がありません' });
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

    const now = new Date().toISOString();
    const [saved] = await db.insert(proposalComments).values({
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

    const recipientId = proposal.pharmacyAId === req.user!.id
      ? proposal.pharmacyBId
      : proposal.pharmacyAId;

    void createNotification({
      pharmacyId: recipientId,
      type: 'new_comment',
      title: 'コメントが追加されました',
      message: body.length > 50 ? body.substring(0, 50) + '...' : body,
      referenceType: 'proposal',
      referenceId: proposalId,
    });

    res.status(201).json({ message: 'コメントを投稿しました', comment: saved });
  } catch (err) {
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
      authorPharmacyId: proposalComments.authorPharmacyId,
      isDeleted: proposalComments.isDeleted,
    })
      .from(proposalComments)
      .where(and(
        eq(proposalComments.id, commentId),
        eq(proposalComments.proposalId, proposalId),
      ))
      .limit(1);

    if (!current) {
      res.status(404).json({ error: 'コメントが見つかりません' });
      return;
    }
    if (current.authorPharmacyId !== req.user!.id) {
      res.status(403).json({ error: '自分のコメントのみ編集できます' });
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
      authorPharmacyId: proposalComments.authorPharmacyId,
      isDeleted: proposalComments.isDeleted,
    })
      .from(proposalComments)
      .where(and(
        eq(proposalComments.id, commentId),
        eq(proposalComments.proposalId, proposalId),
      ))
      .limit(1);

    if (!current) {
      res.status(404).json({ error: 'コメントが見つかりません' });
      return;
    }
    if (current.authorPharmacyId !== req.user!.id) {
      res.status(403).json({ error: '自分のコメントのみ削除できます' });
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
    });
    const pharmacyId = req.user!.id;
    const fetchSize = offset + limit;

    const [branchA, branchB, [countA], [countB], [countOverlap]] = await Promise.all([
      db.select()
        .from(exchangeHistory)
        .where(eq(exchangeHistory.pharmacyAId, pharmacyId))
        .orderBy(desc(exchangeHistory.completedAt), desc(exchangeHistory.id))
        .limit(fetchSize),
      db.select()
        .from(exchangeHistory)
        .where(eq(exchangeHistory.pharmacyBId, pharmacyId))
        .orderBy(desc(exchangeHistory.completedAt), desc(exchangeHistory.id))
        .limit(fetchSize),
      db.select({ count: rowCount })
        .from(exchangeHistory)
        .where(eq(exchangeHistory.pharmacyAId, pharmacyId)),
      db.select({ count: rowCount })
        .from(exchangeHistory)
        .where(eq(exchangeHistory.pharmacyBId, pharmacyId)),
      db.select({ count: rowCount })
        .from(exchangeHistory)
        .where(and(
          eq(exchangeHistory.pharmacyAId, pharmacyId),
          eq(exchangeHistory.pharmacyBId, pharmacyId),
        )),
    ]);

    const rows = mergeDedupSortByTimestamp(branchA, branchB, (row) => row.completedAt)
      .slice(offset, offset + limit);

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

    const totalCount = countA.count + countB.count - countOverlap.count;

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
