import { Router, Response } from 'express';
import { and, asc, desc, eq, or, sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
  exchangeProposals,
  pharmacies,
  proposalComments,
} from '../db/schema';
import { AuthRequest } from '../types';
import { createNotification } from '../services/notification-service';
import { parsePagination } from '../utils/request-utils';
import { rowCount } from '../utils/db-utils';
import { logger } from '../services/logger';
import { parseExchangeIdOrBadRequest } from './exchange-utils';

// Helper: Find proposal where user is party A or B
async function findProposalForUser(proposalId: number, userId: number) {
  const [proposal] = await db.select({
    id: exchangeProposals.id,
    pharmacyAId: exchangeProposals.pharmacyAId,
    pharmacyBId: exchangeProposals.pharmacyBId,
  })
    .from(exchangeProposals)
    .where(and(
      eq(exchangeProposals.id, proposalId),
      or(
        eq(exchangeProposals.pharmacyAId, userId),
        eq(exchangeProposals.pharmacyBId, userId),
      ),
    ))
    .limit(1);
  return proposal || null;
}

// Helper: Find own comment by id
async function findOwnComment(commentId: number, proposalId: number, userId: number) {
  const [current] = await db.select({
    id: proposalComments.id,
    proposalId: proposalComments.proposalId,
    isDeleted: proposalComments.isDeleted,
  })
    .from(proposalComments)
    .where(and(
      eq(proposalComments.id, commentId),
      eq(proposalComments.proposalId, proposalId),
      eq(proposalComments.authorPharmacyId, userId),
    ))
    .limit(1);
  return current || null;
}

// Helper: Parse and validate comment body
function parseCommentBody(rawBody: unknown): string {
  const body = typeof rawBody === 'string' ? rawBody.trim() : '';
  if (!body) {
    throw new Error('EMPTY_BODY');
  }
  if (body.length > 1000) {
    throw new Error('BODY_TOO_LONG');
  }
  return body;
}

// Helper: Check if user is admin and send 403 if so
function rejectIfAdmin(req: AuthRequest, res: Response, action: string): boolean {
  if (req.user?.isAdmin) {
    const actionText = action === 'post' ? 'コメントを投稿' : action === 'edit' ? 'コメントを編集' : 'コメントを削除';
    res.status(403).json({ error: `管理者は${actionText}できません` });
    return true;
  }
  return false;
}

const router = Router();

const COMMENT_POST_MIN_INTERVAL_MS = 10_000;
const COMMENT_DUPLICATE_WINDOW_MS = 5 * 60 * 1000;

// Proposal comments
router.get('/proposals/:id/comments', async (req: AuthRequest, res: Response) => {
  try {
    const proposalId = parseExchangeIdOrBadRequest(res, req.params.id);
    if (!proposalId) return;
    const { page, limit, offset } = parsePagination(req.query.page, req.query.limit, {
      defaultLimit: 50,
      maxLimit: 200,
    });

    const proposal = await findProposalForUser(proposalId, req.user!.id);

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
    const proposalId = parseExchangeIdOrBadRequest(res, req.params.id);
    if (!proposalId) return;

    const proposal = await findProposalForUser(proposalId, req.user!.id);

    if (!proposal) {
      res.status(404).json({ error: 'マッチングが見つかりません' });
      return;
    }

    if (rejectIfAdmin(req, res, 'post')) return;

    let body: string;
    try {
      body = parseCommentBody(req.body?.body);
    } catch (err) {
      if (err instanceof Error && err.message === 'EMPTY_BODY') {
        res.status(400).json({ error: 'コメント本文を入力してください' });
        return;
      }
      if (err instanceof Error && err.message === 'BODY_TOO_LONG') {
        res.status(400).json({ error: 'コメントは1000文字以内で入力してください' });
        return;
      }
      throw err;
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
    const proposalId = parseExchangeIdOrBadRequest(res, req.params.id);
    const commentId = parseExchangeIdOrBadRequest(res, req.params.commentId);
    if (!proposalId || !commentId) return;

    if (rejectIfAdmin(req, res, 'edit')) return;

    const current = await findOwnComment(commentId, proposalId, req.user!.id);

    if (!current) {
      res.status(404).json({ error: 'コメントが見つかりません' });
      return;
    }
    if (current.isDeleted) {
      res.status(400).json({ error: '削除済みコメントは編集できません' });
      return;
    }

    let body: string;
    try {
      body = parseCommentBody(req.body?.body);
    } catch (err) {
      if (err instanceof Error && err.message === 'EMPTY_BODY') {
        res.status(400).json({ error: 'コメント本文を入力してください' });
        return;
      }
      if (err instanceof Error && err.message === 'BODY_TOO_LONG') {
        res.status(400).json({ error: 'コメントは1000文字以内で入力してください' });
        return;
      }
      throw err;
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
    const proposalId = parseExchangeIdOrBadRequest(res, req.params.id);
    const commentId = parseExchangeIdOrBadRequest(res, req.params.commentId);
    if (!proposalId || !commentId) return;

    if (rejectIfAdmin(req, res, 'delete')) return;

    const current = await findOwnComment(commentId, proposalId, req.user!.id);

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

export default router;
