import { Router, Response } from 'express';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { uploads } from '../db/schema';
import { AuthRequest } from '../types';
import { requireLogin } from '../middleware/auth';
import { logger } from '../services/logger';
import { searchMasterCandidates } from '../services/drug-master-enrichment';
import parserRouter from './upload-parser';
import { getBaseContext, getErrorMessage } from './upload-validation';

const router = Router();

router.use(requireLogin);

router.use('/', parserRouter);

// ── Master candidate search for ambiguous rows ──

router.post('/enrich-preview', async (req: AuthRequest, res: Response) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: '行データが空です' });
      return;
    }

    // 簡易行構造: [{drugCode, drugName, unit}]
    const inputRows = rows.slice(0, 500).map((r: { drugCode?: string; drugName?: string; unit?: string }) => ({
      drugCode: typeof r.drugCode === 'string' ? r.drugCode.trim() || null : null,
      drugName: typeof r.drugName === 'string' ? r.drugName.trim() : '',
      unit: typeof r.unit === 'string' ? r.unit.trim() || null : null,
      yakkaUnitPrice: null,
    })).filter((r: { drugName: string }) => r.drugName.length > 0);

    const { enrichWithDrugMaster } = await import('../services/drug-master-enrichment');
    const enriched = await enrichWithDrugMaster(inputRows, 'dead_stock');

    const summary = {
      total: enriched.length,
      matched: enriched.filter((r) => r.matchConfidence === 'exact').length,
      fuzzy: enriched.filter((r) => r.matchConfidence === 'fuzzy').length,
      unmatched: enriched.filter((r) => r.matchConfidence === 'none').length,
    };

    const unmatchedRows = enriched
      .map((r, i) => ({ index: i, drugName: r.drugName, drugCode: r.drugCode, matchConfidence: r.matchConfidence }))
      .filter((r) => r.matchConfidence === 'none');

    res.json({ summary, unmatchedRows });
  } catch (err) {
    logger.error('Enrich preview error', { error: getErrorMessage(err) });
    res.status(500).json({ error: 'エンリッチメントプレビューに失敗しました' });
  }
});

router.get('/master-candidates', async (req: AuthRequest, res: Response) => {
  try {
    const drugName = typeof req.query.drugName === 'string' ? req.query.drugName.trim() : '';
    if (drugName.length < 2) {
      res.status(400).json({ error: '薬品名は2文字以上で入力してください' });
      return;
    }
    const candidates = await searchMasterCandidates(drugName, 10);
    res.json({ candidates });
  } catch (err) {
    logger.error('Master candidate search error', { error: getErrorMessage(err) });
    res.status(500).json({ error: '候補検索に失敗しました' });
  }
});

// ── Upload status - check if current month uploads exist ──

router.get('/status', async (req: AuthRequest, res: Response) => {
  try {
    const pharmacyId = req.user!.id;
    const now = new Date();
    const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

    const lastUploadRows = await db.select({
      uploadType: uploads.uploadType,
      createdAt: sql<string | null>`max(${uploads.createdAt})`,
    })
      .from(uploads)
      .where(and(
        eq(uploads.pharmacyId, pharmacyId),
        inArray(uploads.uploadType, ['dead_stock', 'used_medication']),
      ))
      .groupBy(uploads.uploadType);

    let lastDeadStockDate: string | null = null;
    let lastUsedMedDate: string | null = null;
    for (const row of lastUploadRows) {
      if (row.uploadType === 'dead_stock') lastDeadStockDate = row.createdAt;
      if (row.uploadType === 'used_medication') lastUsedMedDate = row.createdAt;
    }

    res.json({
      deadStockUploaded: lastDeadStockDate !== null,
      usedMedicationUploaded: lastUsedMedDate !== null && lastUsedMedDate >= firstOfMonth,
      lastDeadStockUpload: lastDeadStockDate,
      lastUsedMedicationUpload: lastUsedMedDate,
    });
  } catch (err) {
    logger.error('Upload status error', () => ({
      ...getBaseContext(req),
      error: getErrorMessage(err),
      stack: err instanceof Error ? err.stack : undefined,
    }));
    res.status(500).json({ error: 'ステータスの取得に失敗しました' });
  }
});

export default router;
