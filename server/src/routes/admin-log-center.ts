import { Router, Response } from 'express';
import { requireLogin, requireAdmin } from '../middleware/auth';
import { queryLogs, getLogSummary } from '../services/log-center-service';
import type { LogCenterQuery, LogSource } from '../services/log-center-service';
import { AuthRequest } from '../types';
import { handleAdminError, sendPaginated, parseListPagination } from './admin-utils';
import { parsePositiveInt, normalizeSearchTerm } from '../utils/request-utils';

const router = Router();
router.use(requireLogin);
router.use(requireAdmin);

// GET /api/admin/log-center
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit } = parseListPagination(req, 50);
    const query: LogCenterQuery = { page, limit };

    if (req.query.source) {
      const raw = String(req.query.source);
      query.sources = raw.split(',').filter(Boolean) as LogSource[];
    }
    if (req.query.level) {
      query.level = String(req.query.level) as LogCenterQuery['level'];
    }
    const search = normalizeSearchTerm(req.query.search);
    if (search) {
      query.search = search;
    }
    if (req.query.pharmacyId) {
      const pid = parsePositiveInt(req.query.pharmacyId);
      if (pid) query.pharmacyId = pid;
    }
    if (req.query.from) {
      query.from = String(req.query.from);
    }
    if (req.query.to) {
      query.to = String(req.query.to);
    }

    const result = await queryLogs(query);
    sendPaginated(res, result.entries, result.page, result.limit, result.total);
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
