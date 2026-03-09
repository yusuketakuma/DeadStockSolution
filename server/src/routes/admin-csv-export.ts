// ── CSV エクスポートルート ──────────────────────────────
// GET /csv/pharmacies — 薬局一覧
// GET /csv/exchanges  — 交換一覧
// GET /csv/reports    — レポート一覧

import { Router, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { AuthRequest } from '../types';
import { logger } from '../services/logger';
import {
  exportPharmaciesCsv,
  exportExchangesCsv,
  exportReportsCsv,
} from '../services/csv-export-service';

const csvExportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'エクスポートリクエストが多すぎます。しばらく待ってからお試しください。' },
  keyGenerator: (req) => {
    const userId = (req as AuthRequest).user?.id;
    return userId ? `user:${userId}` : ipKeyGenerator(req.ip ?? 'unknown');
  },
});

const router = Router();

function formatDateForFilename(): string {
  return new Date().toISOString().slice(0, 10);
}

function setCsvHeaders(res: Response, filename: string): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
}

router.get('/csv/pharmacies', csvExportLimiter, async (_req: AuthRequest, res: Response) => {
  try {
    const date = formatDateForFilename();
    setCsvHeaders(res, `pharmacies-${date}.csv`);
    await exportPharmaciesCsv(res);
    res.end();
  } catch (err) {
    logger.error('CSV export pharmacies route error', {
      error: err instanceof Error ? err.message : String(err),
    });
    // ストリーミング開始後はステータスコード変更不可の場合がある
    if (!res.headersSent) {
      res.status(500).json({ error: '薬局CSVの出力に失敗しました' });
    } else {
      res.end();
    }
  }
});

router.get('/csv/exchanges', csvExportLimiter, async (_req: AuthRequest, res: Response) => {
  try {
    const date = formatDateForFilename();
    setCsvHeaders(res, `exchanges-${date}.csv`);
    await exportExchangesCsv(res);
    res.end();
  } catch (err) {
    logger.error('CSV export exchanges route error', {
      error: err instanceof Error ? err.message : String(err),
    });
    if (!res.headersSent) {
      res.status(500).json({ error: '交換CSVの出力に失敗しました' });
    } else {
      res.end();
    }
  }
});

router.get('/csv/reports', csvExportLimiter, async (_req: AuthRequest, res: Response) => {
  try {
    const date = formatDateForFilename();
    setCsvHeaders(res, `reports-${date}.csv`);
    await exportReportsCsv(res);
    res.end();
  } catch (err) {
    logger.error('CSV export reports route error', {
      error: err instanceof Error ? err.message : String(err),
    });
    if (!res.headersSent) {
      res.status(500).json({ error: 'レポートCSVの出力に失敗しました' });
    } else {
      res.end();
    }
  }
});

export default router;
