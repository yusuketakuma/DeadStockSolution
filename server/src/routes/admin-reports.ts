import { Router, Response } from 'express';
import { AuthRequest } from '../types';
import {
  generateMonthlyReport,
  getMonthlyReportById,
  listMonthlyReports,
  MonthlyReportMetrics,
  monthlyReportToCsv,
  resolveDefaultTargetMonth,
  validateYearMonth,
} from '../services/monthly-report-service';
import { handleAdminError, parseListPagination, parseIdOrBadRequest, sendPaginated } from './admin-utils';

const router = Router();

router.get('/reports/monthly', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit } = parseListPagination(req);
    const result = await listMonthlyReports(page, limit);
    sendPaginated(res, result.data, page, limit, result.total);
  } catch (err) {
    handleAdminError(err, 'Admin monthly reports list error', '月次レポート一覧の取得に失敗しました', res);
  }
});

router.post('/reports/monthly/generate', async (req: AuthRequest, res: Response) => {
  try {
    const defaultTarget = resolveDefaultTargetMonth();
    const yearRaw = Number(req.body?.year ?? defaultTarget.year);
    const monthRaw = Number(req.body?.month ?? defaultTarget.month);
    validateYearMonth(yearRaw, monthRaw);

    const result = await generateMonthlyReport(yearRaw, monthRaw, req.user?.id ?? null);
    res.status(201).json({
      message: `${result.year}年${result.month}月のレポートを生成しました`,
      report: {
        id: result.id,
        year: result.year,
        month: result.month,
        generatedAt: result.generatedAt,
      },
      metrics: result.metrics,
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('不正')) {
      res.status(400).json({ error: err.message });
      return;
    }
    handleAdminError(err, 'Admin monthly report generate error', '月次レポート生成に失敗しました', res);
  }
});

router.get('/reports/monthly/:id/download', async (req: AuthRequest, res: Response) => {
  try {
    const id = parseIdOrBadRequest(res, req.params.id);
    if (!id) return;

    const report = await getMonthlyReportById(id);
    if (!report) {
      res.status(404).json({ error: 'レポートが見つかりません' });
      return;
    }

    const formatRaw = typeof req.query.format === 'string' ? req.query.format : 'json';
    const format = formatRaw === 'csv' ? 'csv' : 'json';
    const filenameBase = `monthly-report-${report.year}-${String(report.month).padStart(2, '0')}`;

    if (format === 'csv') {
      const parsed = JSON.parse(report.reportJson) as MonthlyReportMetrics;
      const csv = monthlyReportToCsv(parsed);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.csv"`);
      res.send(`\uFEFF${csv}`);
      return;
    }

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameBase}.json"`);
    res.send(report.reportJson);
  } catch (err) {
    handleAdminError(err, 'Admin monthly report download error', '月次レポートのダウンロードに失敗しました', res);
  }
});

export default router;
