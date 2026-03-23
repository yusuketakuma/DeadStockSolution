import { Router, Response } from 'express';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../config/database';
import { matchCandidateBookmarks, pharmacies } from '../db/schema';
import { AuthRequest } from '../types';
import { logger } from '../services/logger';

const router = Router();

// POST / — ブックマーク作成
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Create match bookmark error', { error: message });
    res.status(500).json({ error: 'ブックマークの作成に失敗しました' });
  }
});

// GET / — ブックマーク一覧 (候補薬局名をjoin、ページネーション付き)
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const pharmacyId = req.user!.id;
    const pageRaw = Number(req.query.page ?? 1);
    const limitRaw = Number(req.query.limit ?? 20);

    const page = Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
    const limit = Number.isInteger(limitRaw) && limitRaw >= 1 && limitRaw <= 100 ? limitRaw : 20;
    const offset = (page - 1) * limit;

    const candidatePharmacy = {
      id: pharmacies.id,
      name: pharmacies.name,
    };

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

    // suppress unused variable lint warning
    void candidatePharmacy;

    res.json({ items: rows, page, limit });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('List match bookmarks error', { error: message });
    res.status(500).json({ error: 'ブックマーク一覧の取得に失敗しました' });
  }
});

// PATCH /:id — メモ更新 (ownership check)
router.patch('/:id', async (req: AuthRequest, res: Response) => {
  try {
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Update match bookmark error', { error: message });
    res.status(500).json({ error: 'ブックマークの更新に失敗しました' });
  }
});

// DELETE /:id — ブックマーク削除 (ownership check)
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Delete match bookmark error', { error: message });
    res.status(500).json({ error: 'ブックマークの削除に失敗しました' });
  }
});

export default router;
