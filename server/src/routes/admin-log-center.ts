import { Router, Response } from 'express';
import { requireLogin, requireAdmin } from '../middleware/auth';
import { queryLogs, getLogSummary } from '../services/log-center-service';
import type { LogCenterQuery, LogSource } from '../services/log-center-service';
import { AuthRequest } from '../types';
import { handleAdminError } from './admin-utils';

const router = Router();
router.use(requireLogin);
router.use(requireAdmin);

// GET /api/admin/log-center
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const query: LogCenterQuery = {};

    if (req.query.source) {
      const raw = String(req.query.source);
      query.sources = raw.split(',').filter(Boolean) as LogSource[];
    }
    if (req.query.level) {
      query.level = String(req.query.level) as LogCenterQuery['level'];
    }
    if (req.query.search) {
      query.search = String(req.query.search);
    }
    if (req.query.pharmacyId) {
      const pid = Number(req.query.pharmacyId);
      if (Number.isInteger(pid) && pid > 0) query.pharmacyId = pid;
    }
    if (req.query.from) {
      query.from = String(req.query.from);
    }
    if (req.query.to) {
      query.to = String(req.query.to);
    }
    if (req.query.limit) {
      const lim = Number(req.query.limit);
      if (Number.isInteger(lim) && lim > 0) query.limit = lim;
    }
    if (req.query.page) {
      const p = Number(req.query.page);
      if (Number.isInteger(p) && p > 0) query.page = p;
    }

    const result = await queryLogs(query);
    res.json(result);
  } catch (err) {
    handleAdminError(err, 'Admin log-center list error', 'ログ一覧の取得に失敗しました', res);
  }
});

// GET /api/admin/log-center/summary
router.get('/summary', async (_req: AuthRequest, res: Response) => {
  try {
    const result = await getLogSummary();
    res.json(result);
  } catch (err) {
    handleAdminError(err, 'Admin log-center summary error', 'ログサマリーの取得に失敗しました', res);
  }
});

export default router;
