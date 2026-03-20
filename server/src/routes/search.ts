import { Router, Response } from 'express';
import { eq, and } from 'drizzle-orm';
import { db } from '../config/database';
import { deadStockItems, pharmacies, drugMaster } from '../db/schema';
import { requireLogin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { buildTokenizedSearchConditions, buildDrugMasterSearchCondition } from '../utils/search-utils';
import { logger } from '../services/logger';

const router = Router();
router.use(requireLogin);

const MAX_SUGGESTIONS = 10;

function sanitizeQuery(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const sanitized = value
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim();
  if (!sanitized) return undefined;
  return sanitized.slice(0, 100);
}

// Drug name suggestions for incremental search
router.get('/drugs', async (req: AuthRequest, res: Response) => {
  try {
    const rawQuery = sanitizeQuery(req.query.q);
    if (!rawQuery) {
      res.json([]);
      return;
    }

    const searchCondition = buildTokenizedSearchConditions(rawQuery, [deadStockItems.drugName]);

    const results = await db.selectDistinct({
      drugName: deadStockItems.drugName,
    })
      .from(deadStockItems)
      .where(and(
        eq(deadStockItems.isAvailable, true),
        searchCondition,
      ))
      .limit(MAX_SUGGESTIONS);

    res.json(results.map((r) => r.drugName));
  } catch (err) {
    logger.error('Drug search suggest error', { error: (err as Error).message });
    res.status(500).json({ error: '検索に失敗しました' });
  }
});

// Drug master suggestions (includes yakka price)
router.get('/drug-master', async (req: AuthRequest, res: Response) => {
  try {
    const rawQuery = sanitizeQuery(req.query.q);
    if (!rawQuery) {
      res.json([]);
      return;
    }

    const searchCondition = buildDrugMasterSearchCondition(
      rawQuery,
      [drugMaster.drugName, drugMaster.genericName, drugMaster.manufacturer],
      drugMaster.yjCode,
    );

    const results = await db.select({
      id: drugMaster.id,
      yjCode: drugMaster.yjCode,
      drugName: drugMaster.drugName,
      genericName: drugMaster.genericName,
      yakkaPrice: drugMaster.yakkaPrice,
      unit: drugMaster.unit,
      specification: drugMaster.specification,
    })
      .from(drugMaster)
      .where(and(
        eq(drugMaster.isListed, true),
        searchCondition,
      ))
      .limit(MAX_SUGGESTIONS);

    res.json(results);
  } catch (err) {
    logger.error('Drug master search error', { error: (err as Error).message });
    res.status(500).json({ error: '検索に失敗しました' });
  }
});

// Drug master name suggestions for SearchInput (returns string[])
router.get('/drug-master-names', async (req: AuthRequest, res: Response) => {
  try {
    const rawQuery = sanitizeQuery(req.query.q);
    if (!rawQuery) {
      res.json([]);
      return;
    }

    const searchCondition = buildDrugMasterSearchCondition(
      rawQuery,
      [drugMaster.drugName, drugMaster.genericName, drugMaster.manufacturer],
      drugMaster.yjCode,
    );

    const results = await db.selectDistinct({
      drugName: drugMaster.drugName,
    })
      .from(drugMaster)
      .where(and(
        eq(drugMaster.isListed, true),
        searchCondition,
      ))
      .limit(MAX_SUGGESTIONS);

    res.json(results.map((r) => r.drugName));
  } catch (err) {
    logger.error('Drug master name suggest error', { error: (err as Error).message });
    res.status(500).json({ error: '検索に失敗しました' });
  }
});

// Pharmacy name suggestions for incremental search
router.get('/pharmacies', async (req: AuthRequest, res: Response) => {
  try {
    const rawQuery = sanitizeQuery(req.query.q);
    if (!rawQuery) {
      res.json([]);
      return;
    }

    const searchCondition = buildTokenizedSearchConditions(rawQuery, [pharmacies.name]);

    const results = await db.selectDistinct({
      name: pharmacies.name,
    })
      .from(pharmacies)
      .where(and(
        eq(pharmacies.isActive, true),
        searchCondition,
      ))
      .limit(MAX_SUGGESTIONS);

    res.json(results.map((r) => r.name));
  } catch (err) {
    logger.error('Pharmacy search suggest error', { error: (err as Error).message });
    res.status(500).json({ error: '検索に失敗しました' });
  }
});

export default router;
