import { Router } from 'express';
import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { matchCandidateBookmarks, matchDismissFeedback, pharmacies } from '../db/schema';
import { AuthRequest } from '../types';
import { wrapRoute } from '../middleware/wrap-route';

const router = Router();
const VALID_DISMISS_REASONS = ['distance', 'expiry', 'value_gap', 'item_fit', 'other'] as const;

// POST / — ブックマーク作成
router.post('/', wrapRoute<AuthRequest>(async (req, res) => {
  const pharmacyId = req.user!.id;
  const { candidatePharmacyId, drugCode, memo } = req.body as {
    candidatePharmacyId?: unknown;
    drugCode?: unknown;
    memo?: unknown;
  };

  if (!Number.isInteger(candidatePharmacyId) || (candidatePharmacyId as number) <= 0) {
    res.status(400).json({ error: 'candidatePharmacyId が不正です' });
    return;
  }
  if (typeof drugCode !== 'string' || drugCode.trim() === '') {
    res.status(400).json({ error: 'drugCode が不正です' });
    return;
  }
  if (memo !== undefined && typeof memo !== 'string') {
    res.status(400).json({ error: 'memo が不正です' });
    return;
  }

  // 重複チェック
  const existing = await db
    .select({ id: matchCandidateBookmarks.id })
    .from(matchCandidateBookmarks)
    .where(
      and(
        eq(matchCandidateBookmarks.pharmacyId, pharmacyId),
        eq(matchCandidateBookmarks.candidatePharmacyId, candidatePharmacyId as number),
        eq(matchCandidateBookmarks.drugCode, drugCode.trim()),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    res.status(409).json({ error: '既にブックマーク済みです' });
    return;
  }

  const [created] = await db
    .insert(matchCandidateBookmarks)
    .values({
      pharmacyId,
      candidatePharmacyId: candidatePharmacyId as number,
      drugCode: drugCode.trim(),
      memo: typeof memo === 'string' ? memo : null,
    })
    .returning();

  res.status(201).json(created);
}));

// GET / — ブックマーク一覧 (候補薬局名をjoin、ページネーション付き)
router.get('/', wrapRoute<AuthRequest>(async (req, res) => {
  const pharmacyId = req.user!.id;
  const pageRaw = Number(req.query.page ?? 1);
  const limitRaw = Number(req.query.limit ?? 20);

  const page = Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const limit = Number.isInteger(limitRaw) && limitRaw >= 1 && limitRaw <= 100 ? limitRaw : 20;
  const offset = (page - 1) * limit;

  const rows = await db
    .select({
      id: matchCandidateBookmarks.id,
      pharmacyId: matchCandidateBookmarks.pharmacyId,
      candidatePharmacyId: matchCandidateBookmarks.candidatePharmacyId,
      candidatePharmacyName: pharmacies.name,
      drugCode: matchCandidateBookmarks.drugCode,
      memo: matchCandidateBookmarks.memo,
      createdAt: matchCandidateBookmarks.createdAt,
    })
    .from(matchCandidateBookmarks)
    .leftJoin(pharmacies, eq(matchCandidateBookmarks.candidatePharmacyId, pharmacies.id))
    .where(eq(matchCandidateBookmarks.pharmacyId, pharmacyId))
    .orderBy(desc(matchCandidateBookmarks.createdAt))
    .limit(limit)
    .offset(offset);

  res.json({ items: rows, page, limit });
}));

// PATCH /:id — メモ更新 (ownership check)
router.patch('/:id', wrapRoute<AuthRequest>(async (req, res) => {
  const pharmacyId = req.user!.id;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: '不正なIDです' });
    return;
  }

  const { memo } = req.body as { memo?: unknown };
  if (typeof memo !== 'string') {
    res.status(400).json({ error: 'memo が不正です' });
    return;
  }

  // ownership check
  const [existing] = await db
    .select({ id: matchCandidateBookmarks.id, pharmacyId: matchCandidateBookmarks.pharmacyId })
    .from(matchCandidateBookmarks)
    .where(eq(matchCandidateBookmarks.id, id))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: 'ブックマークが見つかりません' });
    return;
  }
  if (existing.pharmacyId !== pharmacyId) {
    res.status(403).json({ error: '権限がありません' });
    return;
  }

  const [updated] = await db
    .update(matchCandidateBookmarks)
    .set({ memo })
    .where(eq(matchCandidateBookmarks.id, id))
    .returning();

  res.json(updated);
}));

// DELETE /:id — ブックマーク削除 (ownership check)
router.delete('/:id', wrapRoute<AuthRequest>(async (req, res) => {
  const pharmacyId = req.user!.id;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: '不正なIDです' });
    return;
  }

  // ownership check
  const [existing] = await db
    .select({ id: matchCandidateBookmarks.id, pharmacyId: matchCandidateBookmarks.pharmacyId })
    .from(matchCandidateBookmarks)
    .where(eq(matchCandidateBookmarks.id, id))
    .limit(1);

  if (!existing) {
    res.status(404).json({ error: 'ブックマークが見つかりません' });
    return;
  }
  if (existing.pharmacyId !== pharmacyId) {
    res.status(403).json({ error: '権限がありません' });
    return;
  }

  await db
    .delete(matchCandidateBookmarks)
    .where(eq(matchCandidateBookmarks.id, id));

  res.json({ ok: true });
}));

router.get('/dismiss-feedback', wrapRoute<AuthRequest>(async (req, res) => {
  const pharmacyId = req.user!.id;

  const rows = await db.select({
    reason: matchDismissFeedback.reason,
    count: sql<number>`coalesce(sum(${matchDismissFeedback.dismissCount}), 0)::int`,
  })
    .from(matchDismissFeedback)
    .where(eq(matchDismissFeedback.pharmacyId, pharmacyId))
    .groupBy(matchDismissFeedback.reason);

  const stats = {
    distance: 0,
    expiry: 0,
    value_gap: 0,
    item_fit: 0,
    other: 0,
  };

  for (const row of rows) {
    if (row.reason in stats) {
      stats[row.reason as keyof typeof stats] = Number(row.count ?? 0);
    }
  }

  res.json({ stats });
}));

router.post('/dismiss-feedback', wrapRoute<AuthRequest>(async (req, res) => {
  const pharmacyId = req.user!.id;
  const { candidatePharmacyId, reason, drugCodes } = req.body as {
    candidatePharmacyId?: unknown;
    reason?: unknown;
    drugCodes?: unknown;
  };

  if (!Number.isInteger(candidatePharmacyId) || (candidatePharmacyId as number) <= 0) {
    res.status(400).json({ error: 'candidatePharmacyId が不正です' });
    return;
  }
  if (typeof reason !== 'string' || !VALID_DISMISS_REASONS.includes(reason as typeof VALID_DISMISS_REASONS[number])) {
    res.status(400).json({ error: 'reason が不正です' });
    return;
  }

  const normalizedDrugCodes = Array.isArray(drugCodes)
    ? [...new Set(drugCodes
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean))]
    : [];
  const targets = normalizedDrugCodes.length > 0 ? normalizedDrugCodes : [''];

  const now = new Date();
  for (const drugCode of targets) {
    await db.insert(matchDismissFeedback).values({
      pharmacyId,
      candidatePharmacyId: candidatePharmacyId as number,
      reason,
      drugCode,
      drugGroup: drugCode ? drugCode.split('-')[0] ?? '' : '',
      dismissCount: 1,
      lastDismissedAt: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: [
        matchDismissFeedback.pharmacyId,
        matchDismissFeedback.candidatePharmacyId,
        matchDismissFeedback.reason,
        matchDismissFeedback.drugCode,
        matchDismissFeedback.drugGroup,
      ],
      set: {
        dismissCount: sql`${matchDismissFeedback.dismissCount} + 1`,
        lastDismissedAt: now,
        updatedAt: now,
      },
    });
  }

  const rows = await db.select({
    reason: matchDismissFeedback.reason,
    count: sql<number>`coalesce(sum(${matchDismissFeedback.dismissCount}), 0)::int`,
  })
    .from(matchDismissFeedback)
    .where(eq(matchDismissFeedback.pharmacyId, pharmacyId))
    .groupBy(matchDismissFeedback.reason);

  const stats = {
    distance: 0,
    expiry: 0,
    value_gap: 0,
    item_fit: 0,
    other: 0,
  };

  for (const row of rows) {
    if (row.reason in stats) {
      stats[row.reason as keyof typeof stats] = Number(row.count ?? 0);
    }
  }

  res.status(201).json({ stats });
}));

export default router;
