import { Router, Response } from 'express';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { uploads } from '../db/schema';
import { AuthRequest } from '../types';
import { requireLogin } from '../middleware/auth';
import { logger } from '../services/logger';
import parserRouter from './upload-parser';
import { getBaseContext, getErrorMessage } from './upload-validation';

const router = Router();

router.use(requireLogin);

router.use('/', parserRouter);

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
