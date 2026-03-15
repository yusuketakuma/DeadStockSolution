import { Router, Response } from 'express';
import { requireLogin, requireAdmin } from '../middleware/auth';
import {
  queryLogs,
  getLogSummary,
  getLogInsights,
  getLogEntryById,
  getLogInsightForEntry,
  LOG_ISSUE_WORKFLOW_STATUSES,
  LOG_SOURCES,
  LOG_LEVELS,
  isLogLevel,
} from '../services/log-center-service';
import { updateLogIssueState, getLogIssueHistory } from '../services/log-center-issue-service';
import type {
  LogCenterQuery,
  LogSource,
  NormalizedLogEntry,
  LogInsightsQuery,
  LogIssueWorkflowStatus,
} from '../services/log-center-service';
import { escalateLogAlertToOpenClaw } from '../services/openclaw-log-push-service';
import { AuthRequest } from '../types';
import { handleAdminError, sendPaginated, parseListPagination } from './admin-utils';
import { parsePositiveInt, normalizeSearchTerm, parseTimestamp } from '../utils/request-utils';

const VALID_LOG_SOURCES = new Set<LogSource>(LOG_SOURCES);
const VALID_LOG_ISSUE_STATUSES = new Set<LogIssueWorkflowStatus>(LOG_ISSUE_WORKFLOW_STATUSES);
const LOG_LEVEL_LABEL = LOG_LEVELS.join(', ');

const MAX_SPAN_MS = 90 * 24 * 60 * 60 * 1000; // 90日
const INSIGHTS_DEFAULT_LIMIT = 200;
const INSIGHTS_MAX_LIMIT = 500;
const EXPORT_PAGE_SIZE = 500;

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

function parseLogDateRange(query: AuthRequest['query']): { range?: Pick<LogCenterQuery, 'from' | 'to'>; error?: string } {
  if (!query.from && !query.to) {
    return {};
  }

  const fromDate = query.from ? parseTimestamp(query.from) : null;
  const toDate = query.to ? parseTimestamp(query.to) : null;

  if (query.from && fromDate === null) {
    return { error: 'from パラメータが不正な日時形式です' };
  }
  if (query.to && toDate === null) {
    return { error: 'to パラメータが不正な日時形式です' };
  }
  if (fromDate && toDate && fromDate > toDate) {
    return { error: 'from は to 以前の日時を指定してください' };
  }
  if (fromDate && toDate && toDate.getTime() - fromDate.getTime() > MAX_SPAN_MS) {
    return { error: '指定できる期間は最大90日です' };
  }

  return {
    range: {
      from: fromDate?.toISOString(),
      to: toDate?.toISOString(),
    },
  };
}

function parsePositiveBoundedInt(raw: unknown, max: number): number | undefined {
  if (raw == null) return undefined;
  const parsed = parsePositiveInt(typeof raw === 'string' ? raw : undefined);
  if (!parsed) return undefined;
  return Math.min(parsed, max);
}

function buildLogFilterQueryFromRequest(req: AuthRequest): { query?: Omit<LogCenterQuery, 'page' | 'limit'>; error?: string } {
  const query: Omit<LogCenterQuery, 'page' | 'limit'> = {};
  if (req.query.source) {
    const sources = parseLogSources(req.query.source);
    if (sources) {
      query.sources = sources;
    }
  }

  const level = parseLogLevel(req.query.level);
  if (level === null) {
    return { error: `level パラメータは ${LOG_LEVEL_LABEL} のいずれかを指定してください` };
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

  const { range, error } = parseLogDateRange(req.query);
  if (error) {
    return { error };
  }
  if (range?.from) {
    query.from = range.from;
  }
  if (range?.to) {
    query.to = range.to;
  }

  return { query };
}

function buildLogCenterQueryFromRequest(req: AuthRequest): { query?: LogCenterQuery; error?: string } {
  const base = buildLogFilterQueryFromRequest(req);
  if (!base.query || base.error) {
    return base;
  }

  const { page, limit } = parseListPagination(req, 50);
  return {
    query: {
      ...base.query,
      page,
      limit,
    },
  };
}

function buildInsightsQueryFromRequest(req: AuthRequest): { query?: LogInsightsQuery; error?: string } {
  const base = buildLogFilterQueryFromRequest(req);
  if (!base.query || base.error) {
    return base;
  }

  const explicitLimit = parsePositiveBoundedInt(req.query.limit, INSIGHTS_MAX_LIMIT);
  const query: LogInsightsQuery = {
    ...base.query,
    page: 1,
    limit: explicitLimit ?? INSIGHTS_DEFAULT_LIMIT,
  };
  const minOccurrences = parsePositiveBoundedInt(req.query.minOccurrences, 100);
  if (minOccurrences) {
    query.minOccurrences = minOccurrences;
  }
  const topLimit = parsePositiveBoundedInt(req.query.topLimit, 50);
  if (topLimit) {
    query.topLimit = topLimit;
  }
  return { query };
}

async function queryAllLogsForExport(query: Omit<LogCenterQuery, 'page' | 'limit'>): Promise<NormalizedLogEntry[]> {
  const firstPage = await queryLogs({
    ...query,
    page: 1,
    limit: EXPORT_PAGE_SIZE,
  });
  if (firstPage.total <= firstPage.entries.length) {
    return firstPage.entries;
  }

  const entries = [...firstPage.entries];
  const totalPages = Math.ceil(firstPage.total / EXPORT_PAGE_SIZE);
  for (let page = 2; page <= totalPages; page += 1) {
    const result = await queryLogs({
      ...query,
      page,
      limit: EXPORT_PAGE_SIZE,
    });
    entries.push(...result.entries);
  }

  return entries;
}

function escapeCsvCell(value: unknown): string {
  const text = typeof value === 'string' ? value : value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function serializeEntriesAsCsv(entries: NormalizedLogEntry[]): string {
  const headers = [
    'id',
    'source',
    'level',
    'timestamp',
    'category',
    'tenantLabel',
    'tenantEmail',
    'errorCode',
    'whatHappened',
    'codeLocation',
    'improvementSuggestion',
    'message',
    'detail',
  ];
  const rows = entries.map((entry) => [
    entry.id,
    entry.source,
    entry.level,
    entry.timestamp,
    entry.category,
    entry.tenant.tenantLabel ?? '',
    entry.tenant.pharmacyEmail ?? '',
    entry.errorCode ?? '',
    entry.whatHappened,
    entry.codeLocation ?? '',
    entry.improvementSuggestion ?? '',
    entry.message,
    typeof entry.detail === 'string' ? entry.detail : JSON.stringify(entry.detail),
  ]);
  return [headers, ...rows]
    .map((row) => row.map((value) => escapeCsvCell(value)).join(','))
    .join('\n');
}

function parseLogIssueTarget(sourceRaw: unknown, logIdRaw: unknown): { source: LogSource; logId: number } | null {
  const source = typeof sourceRaw === 'string' && VALID_LOG_SOURCES.has(sourceRaw as LogSource)
    ? sourceRaw as LogSource
    : null;
  const logId = parsePositiveInt(
    typeof logIdRaw === 'number' || typeof logIdRaw === 'string'
      ? String(logIdRaw)
      : undefined,
  );
  if (!source || !logId) return null;
  return { source, logId };
}

// GET /api/admin/log-center
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const { query, error } = buildLogCenterQueryFromRequest(req);
    if (error) {
      res.status(400).json({ error });
      return;
    }
    const result = await queryLogs(query!);
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

// GET /api/admin/log-center/insights
router.get('/insights', async (_req: AuthRequest, res: Response) => {
  try {
    const { query, error } = buildInsightsQueryFromRequest(_req);
    if (error) {
      res.status(400).json({ error });
      return;
    }
    const result = await getLogInsights(query);
    res.json(result);
  } catch (err) {
    handleAdminError(err, 'Admin log-center insights error', '再発監視サマリーの取得に失敗しました', res);
  }
});

// GET /api/admin/log-center/export
router.get('/export', async (req: AuthRequest, res: Response) => {
  try {
    const format = req.query.format === 'csv' ? 'csv' : 'json';
    const { query, error } = buildLogFilterQueryFromRequest(req);
    if (error) {
      res.status(400).json({ error });
      return;
    }
    const entries = await queryAllLogsForExport(query!);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="admin-log-center-${stamp}.csv"`);
      res.send(serializeEntriesAsCsv(entries));
      return;
    }

    res.setHeader('Content-Disposition', `attachment; filename="admin-log-center-${stamp}.json"`);
    res.json({
      exportedAt: new Date().toISOString(),
      count: entries.length,
      total: entries.length,
      filters: query,
      entries,
    });
  } catch (err) {
    handleAdminError(err, 'Admin log-center export error', 'ログエクスポートに失敗しました', res);
  }
});

// POST /api/admin/log-center/openclaw
router.post('/openclaw', async (req: AuthRequest, res: Response) => {
  try {
    const target = parseLogIssueTarget(req.body?.source, req.body?.logId);
    const note = typeof req.body?.note === 'string' && req.body.note.trim().length > 0
      ? req.body.note.trim()
      : undefined;

    if (!target) {
      res.status(400).json({ error: 'source と logId は必須です' });
      return;
    }

    const entry = await getLogEntryById(target.source, target.logId);
    if (!entry) {
      res.status(404).json({ error: '対象ログが見つかりません' });
      return;
    }

    const insight = await getLogInsightForEntry(entry);
    await escalateLogAlertToOpenClaw({
      source: entry.source,
      severity: entry.level === 'critical' ? 'critical' : entry.level === 'warning' ? 'warning' : 'error',
      errorCode: entry.errorCode,
      message: entry.message,
      logId: entry.id,
      occurredAt: entry.timestamp,
      detail: entry.detail,
      codeLocation: entry.codeLocation,
      tenant: {
        pharmacyId: entry.tenant.pharmacyId,
        pharmacyName: entry.tenant.pharmacyName,
        pharmacyEmail: entry.tenant.pharmacyEmail,
      },
      whatHappened: entry.whatHappened,
      improvementSuggestion: entry.improvementSuggestion,
      recurrenceCount: insight?.count,
      impactedTenantCount: insight?.impactedTenantCount,
    }, note);

    res.json({
      ok: true,
      escalated: true,
      source: target.source,
      logId: target.logId,
      recurrenceCount: insight?.count ?? 1,
      impactedTenantCount: insight?.impactedTenantCount ?? (entry.tenant.pharmacyId != null ? 1 : 0),
    });
  } catch (err) {
    handleAdminError(err, 'Admin log-center openclaw escalation error', 'OpenClaw 通知の送信に失敗しました', res);
  }
});

// PATCH /api/admin/log-center/status
router.patch('/status', async (req: AuthRequest, res: Response) => {
  try {
    const target = parseLogIssueTarget(req.body?.source, req.body?.logId);
    const status = typeof req.body?.status === 'string' && VALID_LOG_ISSUE_STATUSES.has(req.body.status as LogIssueWorkflowStatus)
      ? req.body.status as LogIssueWorkflowStatus
      : null;
    const note = typeof req.body?.note === 'string' ? req.body.note : null;

    if (!target || !status || !req.user) {
      res.status(400).json({ error: 'source, logId, status は必須です' });
      return;
    }

    const entry = await getLogEntryById(target.source, target.logId);
    if (!entry) {
      res.status(404).json({ error: '対象ログが見つかりません' });
      return;
    }

    const currentState = await updateLogIssueState({
      source: target.source,
      logId: target.logId,
      status,
      note,
      actorPharmacyId: req.user.id,
      actorEmail: req.user.email,
    });
    const history = await getLogIssueHistory(target.source, target.logId);

    res.json({
      ok: true,
      source: target.source,
      logId: target.logId,
      currentState,
      history,
    });
  } catch (err) {
    handleAdminError(err, 'Admin log-center status update error', 'ログステータスの更新に失敗しました', res);
  }
});

// GET /api/admin/log-center/status-history
router.get('/status-history', async (req: AuthRequest, res: Response) => {
  try {
    const target = parseLogIssueTarget(req.query.source, req.query.logId);
    if (!target) {
      res.status(400).json({ error: 'source と logId は必須です' });
      return;
    }
    const history = await getLogIssueHistory(target.source, target.logId);
    res.json({
      source: target.source,
      logId: target.logId,
      history,
    });
  } catch (err) {
    handleAdminError(err, 'Admin log-center status history error', 'ログステータス履歴の取得に失敗しました', res);
  }
});

export default router;
