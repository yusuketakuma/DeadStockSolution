import { Router, Response } from 'express';
import { requireLogin, requireAdmin } from '../middleware/auth';
import { queryLogs, getLogSummary, LOG_SOURCES, LOG_LEVELS, isLogLevel } from '../services/log-center-service';
import type { LogCenterQuery, LogSource } from '../services/log-center-service';
import { AuthRequest } from '../types';
import { handleAdminError, sendPaginated, parseListPagination } from './admin-utils';
import { parsePositiveInt, normalizeSearchTerm, parseTimestamp } from '../utils/request-utils';

const VALID_LOG_SOURCES = new Set<LogSource>(LOG_SOURCES);
const LOG_LEVEL_LABEL = LOG_LEVELS.join(', ');

const MAX_SPAN_MS = 90 * 24 * 60 * 60 * 1000; // 90日

const router = Router();
router.use(requireLogin);
router.use(requireAdmin);

function parseLogSources(raw: unknown): LogSource[] | undefined {
  if (typeof raw !== 'string') return undefined;

  const parsed = raw.split(',').map((value) => value.trim()).filter(Boolean);
  const filtered = parsed.filter((value): value is LogSource => VALID_LOG_SOURCES.has(value as LogSource));
  if (filtered.length === 0) return undefined;

  // 重複は除去
  return [...new Set(filtered)];
}

function parseLogLevel(raw: unknown): LogCenterQuery['level'] | null | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim();
  if (!normalized || !isLogLevel(normalized)) return null;
  return normalized;
}

// GET /api/admin/log-center
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit } = parseListPagination(req, 50);
    const query: LogCenterQuery = { page, limit };

    if (req.query.source) {
      const sources = parseLogSources(req.query.source);
      if (sources) {
        query.sources = sources;
      }
    }
    const level = parseLogLevel(req.query.level);
    if (level === null) {
      res.status(400).json({ error: `level パラメータは ${LOG_LEVEL_LABEL} のいずれかを指定してください` });
      return;
    }
    if (level) {
      query.level = level;
    }
    const search = normalizeSearchTerm(req.query.search);
    if (search) {
      query.search = search;
    }
    if (req.query.pharmacyId) {
      const pid = parsePositiveInt(req.query.pharmacyId);
      if (pid) query.pharmacyId = pid;
    }
    if (req.query.from || req.query.to) {
      const fromDate = req.query.from ? parseTimestamp(req.query.from) : null;
      const toDate = req.query.to ? parseTimestamp(req.query.to) : null;

      // ISO 8601 形式チェック
      if (req.query.from && fromDate === null) {
        res.status(400).json({ error: 'from パラメータが不正な日時形式です' });
        return;
      }
      if (req.query.to && toDate === null) {
        res.status(400).json({ error: 'to パラメータが不正な日時形式です' });
        return;
      }

      // from ≤ to の検証
      if (fromDate && toDate && fromDate > toDate) {
        res.status(400).json({ error: 'from は to 以前の日時を指定してください' });
        return;
      }

      // 最大スパン 90日の検証
      if (fromDate && toDate && toDate.getTime() - fromDate.getTime() > MAX_SPAN_MS) {
        res.status(400).json({ error: '指定できる期間は最大90日です' });
        return;
      }

      if (fromDate) query.from = fromDate.toISOString();
      if (toDate) query.to = toDate.toISOString();
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
