import { Router, Response } from 'express';
import { and, eq, inArray, desc, sql, like } from 'drizzle-orm';
import { db } from '../config/database';
import {
  pharmacies,
  activityLogs,
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

interface ActivityLogRow {
  id: number;
  pharmacyId: number | null;
  action: string;
  detail: string | null;
  ipAddress: string | null;
  createdAt: string | null;
}

type ActivityLogWhereClause = ReturnType<typeof and> | undefined;

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

export default router;
