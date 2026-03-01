import { Router, Response } from 'express';
import { and, eq, inArray, desc, sql, like, or } from 'drizzle-orm';
import { db } from '../config/database';
import {
  pharmacies,
  activityLogs,
  systemEvents,
  systemEventSourceValues,
  systemEventLevelValues,
  type SystemEventSource,
  type SystemEventLevel,
} from '../db/schema';
import { AuthRequest } from '../types';
import { normalizeSearchTerm, escapeLikeWildcards } from '../utils/request-utils';
import { rowCount } from '../utils/db-utils';
import { type LogAction } from '../services/log-service';
import { sendPaginated, parseListPagination, handleAdminError } from './admin-utils';

const VALID_LOG_ACTIONS: LogAction[] = [
  'login', 'login_failed', 'admin_login', 'register', 'logout',
  'upload', 'proposal_create', 'proposal_accept', 'proposal_reject', 'proposal_complete',
  'account_update', 'account_deactivate', 'admin_toggle_active', 'admin_send_message',
  'dead_stock_delete', 'password_reset_request', 'password_reset_complete',
  'password_reset_failed', 'drug_master_sync', 'drug_master_package_upload', 'drug_master_edit',
];

interface AdminLogFilters {
  actionFilter?: LogAction;
  failureOnly: boolean;
  keyword?: string;
}

interface AdminSystemEventFilters {
  sourceFilter?: SystemEventSource;
  levelFilter?: SystemEventLevel;
  keyword?: string;
}

interface ActivityLogRow {
  id: number;
  pharmacyId: number | null;
  action: string;
  detail: string | null;
  ipAddress: string | null;
  createdAt: string | null;
}

interface SystemEventRow {
  id: number;
  source: string;
  level: string;
  eventType: string;
  message: string;
  detailJson: string | null;
  occurredAt: string;
  createdAt: string | null;
}

type ActivityLogWhereClause = ReturnType<typeof and> | undefined;
type SystemEventWhereClause = ReturnType<typeof and> | undefined;
const SYSTEM_EVENT_DETAIL_PREVIEW_MAX_LENGTH = 256;

const VALID_SYSTEM_EVENT_SOURCES: readonly SystemEventSource[] = systemEventSourceValues;
const VALID_SYSTEM_EVENT_LEVELS: readonly SystemEventLevel[] = systemEventLevelValues;

function parseAdminLogFilters(req: AuthRequest): AdminLogFilters {
  const rawAction = typeof req.query.action === 'string' ? req.query.action.trim() : '';
  const actionFilter = VALID_LOG_ACTIONS.includes(rawAction as LogAction)
    ? rawAction as LogAction
    : undefined;
  const rawResult = typeof req.query.result === 'string' ? req.query.result.trim() : '';

  return {
    actionFilter,
    failureOnly: rawResult === 'failure',
    keyword: normalizeSearchTerm(req.query.keyword, 120),
  };
}

function buildActivityLogWhereClause(
  filters: AdminLogFilters,
  options: { forceFailureOnly?: boolean } = {},
): ActivityLogWhereClause {
  const conditions: Array<ReturnType<typeof eq> | ReturnType<typeof like>> = [];
  if (filters.actionFilter) {
    conditions.push(eq(activityLogs.action, filters.actionFilter));
  }
  if (filters.keyword) {
    conditions.push(like(activityLogs.detail, `%${escapeLikeWildcards(filters.keyword)}%`));
  }
  if (options.forceFailureOnly || filters.failureOnly) {
    conditions.push(like(activityLogs.detail, '失敗|%'));
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

function parseAdminSystemEventFilters(req: AuthRequest): AdminSystemEventFilters {
  const rawSource = typeof req.query.source === 'string' ? req.query.source.trim() : '';
  const sourceFilter = VALID_SYSTEM_EVENT_SOURCES.includes(rawSource as SystemEventSource)
    ? rawSource as SystemEventSource
    : undefined;
  const rawLevel = typeof req.query.level === 'string' ? req.query.level.trim() : '';
  const levelFilter = VALID_SYSTEM_EVENT_LEVELS.includes(rawLevel as SystemEventLevel)
    ? rawLevel as SystemEventLevel
    : undefined;

  return {
    sourceFilter,
    levelFilter,
    keyword: normalizeSearchTerm(req.query.keyword, 120),
  };
}

function buildSystemEventWhereClause(filters: AdminSystemEventFilters): SystemEventWhereClause {
  const conditions: Array<ReturnType<typeof eq> | ReturnType<typeof or>> = [];
  if (filters.sourceFilter) {
    conditions.push(eq(systemEvents.source, filters.sourceFilter));
  }
  if (filters.levelFilter) {
    conditions.push(eq(systemEvents.level, filters.levelFilter));
  }
  if (filters.keyword) {
    const pattern = `%${escapeLikeWildcards(filters.keyword)}%`;
    conditions.push(or(
      like(systemEvents.eventType, pattern),
      like(systemEvents.message, pattern),
    ));
  }
  return conditions.length > 0 ? and(...conditions) : undefined;
}

function truncateSystemEventDetail(detailJson: string | null): string | null {
  if (!detailJson) return null;
  if (detailJson.length <= SYSTEM_EVENT_DETAIL_PREVIEW_MAX_LENGTH) return detailJson;
  return `${detailJson.slice(0, SYSTEM_EVENT_DETAIL_PREVIEW_MAX_LENGTH)}...`;
}

async function fetchActivityLogRows(
  whereClause: ActivityLogWhereClause,
  limit: number,
  offset: number,
): Promise<ActivityLogRow[]> {
  return db.select({
    id: activityLogs.id,
    pharmacyId: activityLogs.pharmacyId,
    action: activityLogs.action,
    detail: activityLogs.detail,
    ipAddress: activityLogs.ipAddress,
    createdAt: activityLogs.createdAt,
  })
    .from(activityLogs)
    .where(whereClause)
    .orderBy(desc(activityLogs.createdAt))
    .limit(limit)
    .offset(offset);
}

async function mapActivityLogsWithPharmacyName(rows: ActivityLogRow[]): Promise<Array<ActivityLogRow & { pharmacyName: string | null }>> {
  const pharmacyIds = [...new Set(rows.map((row) => row.pharmacyId).filter((id): id is number => id !== null))];
  const pharmacyRows = pharmacyIds.length > 0
    ? await db.select({ id: pharmacies.id, name: pharmacies.name })
      .from(pharmacies)
      .where(inArray(pharmacies.id, pharmacyIds))
    : [];
  const pharmacyMap = new Map(pharmacyRows.map((row) => [row.id, row.name]));

  return rows.map((row) => ({
    ...row,
    pharmacyName: row.pharmacyId ? pharmacyMap.get(row.pharmacyId) ?? null : null,
  }));
}

async function fetchSystemEventRows(
  whereClause: SystemEventWhereClause,
  limit: number,
  offset: number,
): Promise<SystemEventRow[]> {
  return db.select({
    id: systemEvents.id,
    source: systemEvents.source,
    level: systemEvents.level,
    eventType: systemEvents.eventType,
    message: systemEvents.message,
    detailJson: systemEvents.detailJson,
    occurredAt: systemEvents.occurredAt,
    createdAt: systemEvents.createdAt,
  })
    .from(systemEvents)
    .where(whereClause)
    .orderBy(desc(systemEvents.occurredAt), desc(systemEvents.id))
    .limit(limit)
    .offset(offset);
}

async function fetchFailureSummary(whereClause: ActivityLogWhereClause): Promise<{
  failureTotal: number;
  failureByAction: Record<string, number>;
  failureByReason: Array<{ reason: string; count: number }>;
}> {
  const [failureTotal] = await db.select({ count: rowCount })
    .from(activityLogs)
    .where(whereClause);

  const failureByActionRows = await db.select({
    action: activityLogs.action,
    count: rowCount,
  })
    .from(activityLogs)
    .where(whereClause)
    .groupBy(activityLogs.action);

  const failureByAction = failureByActionRows.reduce<Record<string, number>>((acc, row) => {
    acc[row.action] = row.count;
    return acc;
  }, {});

  const failureReasonExpr = sql<string>`coalesce(substring(${activityLogs.detail} from 'reason=([^|]+)'), 'unknown')`;
  const failureByReason = await db.select({
    reason: failureReasonExpr,
    count: rowCount,
  })
    .from(activityLogs)
    .where(whereClause)
    .groupBy(failureReasonExpr)
    .orderBy(sql`count(*)::int desc`)
    .limit(10);

  return {
    failureTotal: failureTotal.count,
    failureByAction,
    failureByReason,
  };
}

async function fetchSystemEventTotal(whereClause: SystemEventWhereClause): Promise<number> {
  const [totalRow] = await db.select({ count: rowCount })
    .from(systemEvents)
    .where(whereClause);
  return totalRow.count;
}

async function fetchSystemEventSummary(whereClause: SystemEventWhereClause): Promise<{
  bySource: Record<string, number>;
  byLevel: Record<string, number>;
}> {
  const [bySourceRows, byLevelRows] = await Promise.all([
    db.select({
      source: systemEvents.source,
      count: rowCount,
    })
      .from(systemEvents)
      .where(whereClause)
      .groupBy(systemEvents.source),
    db.select({
      level: systemEvents.level,
      count: rowCount,
    })
      .from(systemEvents)
      .where(whereClause)
      .groupBy(systemEvents.level),
  ]);

  return {
    bySource: bySourceRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.source] = row.count;
      return acc;
    }, {}),
    byLevel: byLevelRows.reduce<Record<string, number>>((acc, row) => {
      acc[row.level] = row.count;
      return acc;
    }, {}),
  };
}

const router = Router();

router.get('/logs', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parseListPagination(req, 50);
    const filters = parseAdminLogFilters(req);
    const whereClause = buildActivityLogWhereClause(filters);
    const failureWhereClause = buildActivityLogWhereClause(filters, { forceFailureOnly: true });

    const rows = await fetchActivityLogRows(whereClause, limit, offset);
    const mappedRows = await mapActivityLogsWithPharmacyName(rows);

    const [total] = await db.select({ count: rowCount })
      .from(activityLogs)
      .where(whereClause);

    const failureSummary = await fetchFailureSummary(failureWhereClause);

    sendPaginated(res, mappedRows, page, limit, total.count, {
      summary: {
        failureTotal: failureSummary.failureTotal,
        failureByAction: failureSummary.failureByAction,
        failureByReason: failureSummary.failureByReason,
      },
      filters: {
        action: filters.actionFilter ?? null,
        result: filters.failureOnly ? 'failure' : 'all',
        keyword: filters.keyword ?? null,
      },
    });
  } catch (err) {
    handleAdminError(err, 'Admin logs error', 'ログの取得に失敗しました', res);
  }
});

router.get('/system-events', async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, offset } = parseListPagination(req, 50);
    const filters = parseAdminSystemEventFilters(req);
    const whereClause = buildSystemEventWhereClause(filters);
    const shouldLoadSummary = page === 1;
    const [rows, total, summary] = await Promise.all([
      fetchSystemEventRows(whereClause, limit, offset),
      fetchSystemEventTotal(whereClause),
      shouldLoadSummary
        ? fetchSystemEventSummary(whereClause)
        : Promise.resolve({ bySource: {}, byLevel: {} }),
    ]);
    const responseRows = rows.map((row) => ({
      ...row,
      detailJson: truncateSystemEventDetail(row.detailJson),
    }));

    sendPaginated(res, responseRows, page, limit, total, {
      summary: {
        bySource: summary.bySource,
        byLevel: summary.byLevel,
      },
      filters: {
        source: filters.sourceFilter ?? null,
        level: filters.levelFilter ?? null,
        keyword: filters.keyword ?? null,
      },
    });
  } catch (err) {
    handleAdminError(err, 'Admin system events error', 'システムイベントの取得に失敗しました', res);
  }
});

export default router;
