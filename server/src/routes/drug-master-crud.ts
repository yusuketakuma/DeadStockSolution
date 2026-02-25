import { Router, Request, Response } from 'express';
import { eq, and, like, or, isNotNull } from 'drizzle-orm';
import { db } from '../config/database';
import { drugMaster } from '../db/schema';
import { AuthRequest } from '../types';
import { parsePagination, normalizeSearchTerm, escapeLikeWildcards } from '../utils/request-utils';
import { rowCount } from '../utils/db-utils';
import { writeLog, getClientIp } from '../services/log-service';
import { katakanaToHiragana, hiraganaToKatakana, normalizeKana } from '../utils/kana-utils';
import {
  getDrugMasterStats,
  getDrugDetail,
  updateDrugMasterItem,
} from '../services/drug-master-service';
import { logger } from '../services/logger';

const router = Router();

// ── 統計情報 ──────────────────────────────────────

router.get('/stats', async (_req: AuthRequest, res: Response) => {
  try {
    const stats = await getDrugMasterStats();
    res.json(stats);
  } catch (err) {
    logger.error('Drug master stats error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: '統計情報の取得に失敗しました' });
  }
});

// ── 一覧取得（ページネーション・検索・フィルター対応）──

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parsePagination(req.query.page, req.query.limit, { defaultLimit: 30, maxLimit: 100 });
    const search = normalizeSearchTerm(req.query.search);
    const statusFilter = req.query.status as string | undefined; // listed / transition / delisted / all
    const categoryFilter = normalizeSearchTerm(req.query.category);

    const conditions = [];

    // ステータスフィルター
    if (statusFilter === 'listed') {
      conditions.push(eq(drugMaster.isListed, true));
    } else if (statusFilter === 'delisted') {
      conditions.push(eq(drugMaster.isListed, false));
    } else if (statusFilter === 'transition') {
      conditions.push(and(
        eq(drugMaster.isListed, true),
        isNotNull(drugMaster.transitionDeadline),
      ));
    }

    // カテゴリフィルター
    if (categoryFilter) {
      conditions.push(eq(drugMaster.category, categoryFilter));
    }

    // 検索
    if (search) {
      const normalized = normalizeKana(search);
      const hiragana = katakanaToHiragana(normalized);
      const katakana = hiraganaToKatakana(normalized);
      const likeTerms = new Set([normalized, hiragana, katakana]);
      const nameConditions = [...likeTerms].map((term) => like(drugMaster.drugName, `%${escapeLikeWildcards(term)}%`));
      const genericConditions = [...likeTerms].map((term) => like(drugMaster.genericName, `%${escapeLikeWildcards(term)}%`));
      const allSearchConditions = [...nameConditions, ...genericConditions];

      // YJコード検索
      if (/^[A-Z0-9]+$/i.test(search.trim())) {
        allSearchConditions.push(like(drugMaster.yjCode, `%${escapeLikeWildcards(search.trim())}%`));
      }

      conditions.push(or(...allSearchConditions));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalResult] = await db.select({ value: rowCount })
      .from(drugMaster)
      .where(whereClause);

    const items = await db.select({
      id: drugMaster.id,
      yjCode: drugMaster.yjCode,
      drugName: drugMaster.drugName,
      genericName: drugMaster.genericName,
      specification: drugMaster.specification,
      unit: drugMaster.unit,
      yakkaPrice: drugMaster.yakkaPrice,
      manufacturer: drugMaster.manufacturer,
      category: drugMaster.category,
      isListed: drugMaster.isListed,
      transitionDeadline: drugMaster.transitionDeadline,
      updatedAt: drugMaster.updatedAt,
    })
      .from(drugMaster)
      .where(whereClause)
      .orderBy(drugMaster.drugName)
      .limit(limit)
      .offset(offset);

    res.json({
      data: items,
      pagination: {
        page,
        limit,
        total: totalResult.value,
        totalPages: Math.ceil(totalResult.value / limit),
      },
    });
  } catch (err) {
    logger.error('Drug master list error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: '医薬品マスターの取得に失敗しました' });
  }
});

// ── 詳細取得 ─────────────────────────────────────

router.get('/detail/:yjCode', async (req: AuthRequest, res: Response) => {
  try {
    const yjCode = String(req.params.yjCode ?? '');
    if (!yjCode || yjCode.length > 20) {
      res.status(400).json({ error: '無効なYJコードです' });
      return;
    }

    const detail = await getDrugDetail(yjCode);
    if (!detail) {
      res.status(404).json({ error: '医薬品が見つかりません' });
      return;
    }

    res.json(detail);
  } catch (err) {
    logger.error('Drug master detail error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: '医薬品詳細の取得に失敗しました' });
  }
});

// ── 個別編集 ─────────────────────────────────────

router.put('/detail/:yjCode', async (req: AuthRequest, res: Response) => {
  try {
    const yjCode = String(req.params.yjCode ?? '');
    if (!yjCode || yjCode.length > 20) {
      res.status(400).json({ error: '無効なYJコードです' });
      return;
    }

    const body = req.body;
    const updates: Record<string, unknown> = {};

    if (typeof body.drugName === 'string' && body.drugName.trim()) {
      updates.drugName = body.drugName.trim().slice(0, 500);
    }
    if (body.genericName !== undefined) {
      updates.genericName = typeof body.genericName === 'string' ? body.genericName.trim().slice(0, 500) || null : null;
    }
    if (body.specification !== undefined) {
      updates.specification = typeof body.specification === 'string' ? body.specification.trim().slice(0, 200) || null : null;
    }
    if (body.unit !== undefined) {
      updates.unit = typeof body.unit === 'string' ? body.unit.trim().slice(0, 50) || null : null;
    }
    if (typeof body.yakkaPrice === 'number' && body.yakkaPrice >= 0) {
      updates.yakkaPrice = body.yakkaPrice;
    }
    if (body.manufacturer !== undefined) {
      updates.manufacturer = typeof body.manufacturer === 'string' ? body.manufacturer.trim().slice(0, 200) || null : null;
    }
    if (typeof body.isListed === 'boolean') {
      updates.isListed = body.isListed;
    }
    if (body.transitionDeadline !== undefined) {
      updates.transitionDeadline = typeof body.transitionDeadline === 'string' ? body.transitionDeadline.trim() || null : null;
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: '更新するフィールドが指定されていません' });
      return;
    }

    const updated = await updateDrugMasterItem(yjCode, updates as Parameters<typeof updateDrugMasterItem>[1]);
    if (!updated) {
      res.status(404).json({ error: '医薬品が見つかりません' });
      return;
    }

    await writeLog('drug_master_edit', {
      pharmacyId: req.user!.id,
      detail: `医薬品マスター編集: ${yjCode} ${updated.drugName}`,
      ipAddress: getClientIp(req as Request),
    });

    res.json(updated);
  } catch (err) {
    logger.error('Drug master update error', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: '医薬品の更新に失敗しました' });
  }
});

export default router;
