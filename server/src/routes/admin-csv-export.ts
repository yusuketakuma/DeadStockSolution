// ── CSV エクスポートルート ──────────────────────────────
// GET /csv/pharmacies — 薬局一覧
// GET /csv/exchanges  — 交換一覧
// GET /csv/reports    — レポート一覧
// GET /csv/logs       — ログ一覧
// GET /csv/risk       — リスク一覧

import { Router, Response, RequestHandler } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { AuthRequest } from '../types';
import { logger } from '../services/logger';
import type { CsvWriter } from '../services/csv-export-service';
import {
  exportPharmaciesCsv,
  exportExchangesCsv,
  exportReportsCsv,
  exportLogsCsv,
  exportRiskCsv,
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

function createCsvExportHandler(
  exportFn: (writer: CsvWriter) => Promise<number>,
  filenamePrefix: string,
  errorMessageJa: string,
): RequestHandler {
  return async (_req: AuthRequest, res: Response) => {
    try {
      const date = formatDateForFilename();
      setCsvHeaders(res, `${filenamePrefix}-${date}.csv`);
      await exportFn(res);
      res.end();
    } catch (err) {
      logger.error(`CSV export ${filenamePrefix} route error`, {
        error: err instanceof Error ? err.message : String(err),
      });
      if (!res.headersSent) {
        res.status(500).json({ error: errorMessageJa });
      } else {
        res.end();
      }
    }
  };
}

router.get('/csv/pharmacies', csvExportLimiter, createCsvExportHandler(exportPharmaciesCsv, 'pharmacies', '薬局CSVの出力に失敗しました'));
router.get('/csv/exchanges', csvExportLimiter, createCsvExportHandler(exportExchangesCsv, 'exchanges', '交換CSVの出力に失敗しました'));
router.get('/csv/reports', csvExportLimiter, createCsvExportHandler(exportReportsCsv, 'reports', 'レポートCSVの出力に失敗しました'));
router.get('/csv/logs', csvExportLimiter, createCsvExportHandler(exportLogsCsv, 'logs', 'ログCSVの出力に失敗しました'));
router.get('/csv/risk', csvExportLimiter, createCsvExportHandler(exportRiskCsv, 'risk', 'リスクCSVの出力に失敗しました'));

export default router;
