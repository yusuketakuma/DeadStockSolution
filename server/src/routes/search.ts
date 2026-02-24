import { Router, Response } from 'express';
import { eq, or, like, and } from 'drizzle-orm';
import { db } from '../config/database';
import { deadStockItems, pharmacies, drugMaster } from '../db/schema';
import { requireLogin } from '../middleware/auth';
import { AuthRequest } from '../types';
import { katakanaToHiragana, hiraganaToKatakana, normalizeKana } from '../utils/kana-utils';

const router = Router();
router.use(requireLogin);

const MAX_SUGGESTIONS = 10;

function sanitizeQuery(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const sanitized = value
    .replace(/[\x00-\x1F\x7F]/g, '')
    .replace(/[%_]/g, '')
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

    const query = normalizeKana(rawQuery);
    const hiragana = katakanaToHiragana(query);
    const katakana = hiraganaToKatakana(query);

    // Build OR conditions for original, hiragana, and katakana variants
    const likeTerms = new Set([query, hiragana, katakana]);
    const conditions = [...likeTerms].map((term) => like(deadStockItems.drugName, `%${term}%`));

    const results = await db.selectDistinct({
      drugName: deadStockItems.drugName,
    })
      .from(deadStockItems)
      .where(and(
        eq(deadStockItems.isAvailable, true),
        conditions.length === 1 ? conditions[0] : or(...conditions),
      ))
      .limit(MAX_SUGGESTIONS);

    res.json(results.map((r) => r.drugName));
  } catch (err) {
    console.error('Drug search suggest error:', err);
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

    const query = normalizeKana(rawQuery);
    const hiragana = katakanaToHiragana(query);
    const katakana = hiraganaToKatakana(query);

    const likeTerms = new Set([query, hiragana, katakana]);
    const nameConditions = [...likeTerms].map((term) => like(drugMaster.drugName, `%${term}%`));

    // YJコード検索にも対応
    const isCodeSearch = /^[A-Z0-9]+$/i.test(rawQuery.trim());
    const allConditions = [...nameConditions];
    if (isCodeSearch) {
      allConditions.push(like(drugMaster.yjCode, `%${rawQuery.trim()}%`));
    }

    const results = await db.select({
      yjCode: drugMaster.yjCode,
      drugName: drugMaster.drugName,
      yakkaPrice: drugMaster.yakkaPrice,
      unit: drugMaster.unit,
      specification: drugMaster.specification,
    })
      .from(drugMaster)
      .where(and(
        eq(drugMaster.isListed, true),
        or(...allConditions),
      ))
      .limit(MAX_SUGGESTIONS);

    res.json(results);
  } catch (err) {
    console.error('Drug master search error:', err);
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

    const query = normalizeKana(rawQuery);
    const hiragana = katakanaToHiragana(query);
    const katakana = hiraganaToKatakana(query);

    const likeTerms = new Set([query, hiragana, katakana]);
    const conditions = [...likeTerms].map((term) => like(pharmacies.name, `%${term}%`));

    const results = await db.selectDistinct({
      name: pharmacies.name,
    })
      .from(pharmacies)
      .where(and(
        eq(pharmacies.isActive, true),
        conditions.length === 1 ? conditions[0] : or(...conditions),
      ))
      .limit(MAX_SUGGESTIONS);

    res.json(results.map((r) => r.name));
  } catch (err) {
    console.error('Pharmacy search suggest error:', err);
    res.status(500).json({ error: '検索に失敗しました' });
  }
});

export default router;
