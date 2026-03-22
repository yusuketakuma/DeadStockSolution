import { Router, Response } from 'express';
import { eq, and, sql, desc, asc } from 'drizzle-orm';
import { db } from '../config/database';
import { deadStockItems, pharmacies, drugMaster } from '../db/schema';
import { requireLogin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { buildTokenizedSearchConditions, buildDrugMasterSearchCondition } from '../utils/search-utils';
import { logger } from '../services/logger';

const router = Router();
router.use(requireLogin);

const MAX_SUGGESTIONS = 10;
const MAX_DRUG_MASTER_SUGGESTIONS = 150;

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
    const queryLower = rawQuery.toLowerCase();
    const prefixPattern = `${queryLower}%`;
    const containsPattern = `%${queryLower}%`;

    const relevanceScore = sql<number>`
      CASE
        WHEN LOWER(${deadStockItems.drugName}) = ${queryLower} THEN 1000
        WHEN LOWER(${deadStockItems.drugName}) LIKE ${prefixPattern} THEN 800
        WHEN LOWER(${deadStockItems.drugName}) LIKE ${containsPattern} THEN 400
        ELSE 100
      END
    `;

    const results = await db.select({
      drugName: deadStockItems.drugName,
      score: sql<number>`MAX(${relevanceScore})`.as('score'),
    })
      .from(deadStockItems)
      .where(and(
        eq(deadStockItems.isAvailable, true),
        searchCondition,
      ))
      .groupBy(deadStockItems.drugName)
      .orderBy(desc(sql`score`), asc(sql`char_length(${deadStockItems.drugName})`))
      .limit(MAX_DRUG_MASTER_SUGGESTIONS);

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

    const queryLower = rawQuery.toLowerCase();
    const prefixPattern = `${queryLower}%`;
    const containsPattern = `%${queryLower}%`;

    const relevanceScore = sql<number>`
      CASE
        WHEN LOWER(${drugMaster.drugName}) = ${queryLower} THEN 1000
        WHEN LOWER(${drugMaster.drugName}) LIKE ${prefixPattern} THEN 800
        WHEN LOWER(${drugMaster.genericName}) = ${queryLower} THEN 700
        WHEN LOWER(${drugMaster.genericName}) LIKE ${prefixPattern} THEN 600
        WHEN LOWER(${drugMaster.drugName}) LIKE ${containsPattern} THEN 400
        WHEN LOWER(${drugMaster.genericName}) LIKE ${containsPattern} THEN 300
        WHEN LOWER(${drugMaster.manufacturer}) LIKE ${containsPattern} THEN 200
        ELSE 100
      END
    `;

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
      .orderBy(desc(relevanceScore), asc(sql`char_length(${drugMaster.drugName})`))
      .limit(MAX_DRUG_MASTER_SUGGESTIONS);

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

    const queryLower = rawQuery.toLowerCase();
    const prefixPattern = `${queryLower}%`;
    const containsPattern = `%${queryLower}%`;

    const relevanceScore = sql<number>`
      CASE
        WHEN LOWER(${drugMaster.drugName}) = ${queryLower} THEN 1000
        WHEN LOWER(${drugMaster.drugName}) LIKE ${prefixPattern} THEN 800
        WHEN LOWER(${drugMaster.genericName}) = ${queryLower} THEN 700
        WHEN LOWER(${drugMaster.genericName}) LIKE ${prefixPattern} THEN 600
        WHEN LOWER(${drugMaster.drugName}) LIKE ${containsPattern} THEN 400
        WHEN LOWER(${drugMaster.genericName}) LIKE ${containsPattern} THEN 300
        ELSE 100
      END
    `;

    const results = await db.select({
      drugName: drugMaster.drugName,
      score: sql<number>`MAX(${relevanceScore})`.as('score'),
    })
      .from(drugMaster)
      .where(and(
        eq(drugMaster.isListed, true),
        searchCondition,
      ))
      .groupBy(drugMaster.drugName)
      .orderBy(desc(sql`score`), asc(sql`char_length(${drugMaster.drugName})`))
      .limit(MAX_DRUG_MASTER_SUGGESTIONS);

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
    const queryLower = rawQuery.toLowerCase();
    const prefixPattern = `${queryLower}%`;
    const containsPattern = `%${queryLower}%`;

    const relevanceScore = sql<number>`
      CASE
        WHEN LOWER(${pharmacies.name}) = ${queryLower} THEN 1000
        WHEN LOWER(${pharmacies.name}) LIKE ${prefixPattern} THEN 800
        WHEN LOWER(${pharmacies.name}) LIKE ${containsPattern} THEN 400
        ELSE 100
      END
    `;

    const results = await db.select({
      name: pharmacies.name,
      score: sql<number>`MAX(${relevanceScore})`.as('score'),
    })
      .from(pharmacies)
      .where(and(
        eq(pharmacies.isActive, true),
        searchCondition,
      ))
      .groupBy(pharmacies.name)
      .orderBy(desc(sql`score`), asc(sql`char_length(${pharmacies.name})`))
      .limit(MAX_SUGGESTIONS);

    res.json(results.map((r) => r.name));
  } catch (err) {
    logger.error('Pharmacy search suggest error', { error: (err as Error).message });
    res.status(500).json({ error: '検索に失敗しました' });
  }
});

export default router;
