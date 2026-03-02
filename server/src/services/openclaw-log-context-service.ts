import { and, desc, eq, gte, inArray, like, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { activityLogs } from '../db/schema';
import { rowCount } from '../utils/db-utils';
import { parseBoundedInt } from '../utils/number-utils';

const DEFAULT_WINDOW_HOURS = 24;
const DEFAULT_RECENT_FAILURE_LIMIT = 20;
const DEFAULT_RECENT_ACTIVITY_LIMIT = 20;
const DEFAULT_DETAIL_MAX_LENGTH = 280;
const IMPORT_FAILURE_ACTIONS = ['upload', 'drug_master_sync', 'drug_master_package_upload'] as const;

interface ActionCount {
  action: string;
  count: number;
}

interface ReasonCount {
  reason: string;
  count: number;
}

interface ContextLogRow {
  action: string;
  detail: string | null;
  createdAt: string | null;
  pharmacyId: number | null;
}

export interface OpenClawLogContext {
  generatedAt: string;
  windowHours: number;
  monitoredImportActions: string[];
  importFailures: {
    total: number;
    byAction: ActionCount[];
    byReason: ReasonCount[];
    recent: ContextLogRow[];
  };
  pharmacyActivity: {
    pharmacyId: number;
    recent: ContextLogRow[];
  };
}

function sanitizeDetail(detail: string | null): string | null {
  if (!detail) return null;
  const normalized = detail.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  const maxLength = parseBoundedInt(process.env.OPENCLAW_LOG_CONTEXT_DETAIL_MAX_LENGTH, DEFAULT_DETAIL_MAX_LENGTH, 80, 2000);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}

function normalizeLogRows(rows: ContextLogRow[]): ContextLogRow[] {
  return rows.map((row) => ({
    action: row.action,
    detail: sanitizeDetail(row.detail),
    createdAt: row.createdAt,
    pharmacyId: row.pharmacyId,
  }));
}

export async function buildOpenClawLogContext(pharmacyId: number, now: Date = new Date()): Promise<OpenClawLogContext> {
  const windowHours = parseBoundedInt(process.env.OPENCLAW_LOG_CONTEXT_WINDOW_HOURS, DEFAULT_WINDOW_HOURS, 1, 24 * 30);
  const failureLimit = parseBoundedInt(process.env.OPENCLAW_LOG_CONTEXT_RECENT_FAILURE_LIMIT, DEFAULT_RECENT_FAILURE_LIMIT, 1, 200);
  const activityLimit = parseBoundedInt(process.env.OPENCLAW_LOG_CONTEXT_RECENT_ACTIVITY_LIMIT, DEFAULT_RECENT_ACTIVITY_LIMIT, 1, 200);
  const windowStartIso = new Date(now.getTime() - windowHours * 60 * 60 * 1000).toISOString();

  const failureWhereClause = and(
    eq(activityLogs.pharmacyId, pharmacyId),
    gte(activityLogs.createdAt, windowStartIso),
    like(activityLogs.detail, '失敗|%'),
    inArray(activityLogs.action, IMPORT_FAILURE_ACTIONS),
  );

  const [failureTotalRow] = await db.select({ count: rowCount })
    .from(activityLogs)
    .where(failureWhereClause);

  const failureByActionRows = await db.select({
    action: activityLogs.action,
    count: rowCount,
  })
    .from(activityLogs)
    .where(failureWhereClause)
    .groupBy(activityLogs.action);

  const failureReasonExpr = sql<string>`coalesce(substring(${activityLogs.detail} from 'reason=([^|]+)'), 'unknown')`;
  const failureByReasonRows = await db.select({
    reason: failureReasonExpr,
    count: rowCount,
  })
    .from(activityLogs)
    .where(failureWhereClause)
    .groupBy(failureReasonExpr)
    .orderBy(sql`count(*)::int desc`)
    .limit(10);

  const recentFailureRows = await db.select({
    action: activityLogs.action,
    detail: activityLogs.detail,
    createdAt: activityLogs.createdAt,
    pharmacyId: activityLogs.pharmacyId,
  })
    .from(activityLogs)
    .where(failureWhereClause)
    .orderBy(desc(activityLogs.createdAt))
    .limit(failureLimit);

  const pharmacyWhereClause = and(
    eq(activityLogs.pharmacyId, pharmacyId),
    gte(activityLogs.createdAt, windowStartIso),
  );
  const recentPharmacyRows = await db.select({
    action: activityLogs.action,
    detail: activityLogs.detail,
    createdAt: activityLogs.createdAt,
    pharmacyId: activityLogs.pharmacyId,
  })
    .from(activityLogs)
    .where(pharmacyWhereClause)
    .orderBy(desc(activityLogs.createdAt))
    .limit(activityLimit);

  return {
    generatedAt: now.toISOString(),
    windowHours,
    monitoredImportActions: [...IMPORT_FAILURE_ACTIONS],
    importFailures: {
      total: failureTotalRow?.count ?? 0,
      byAction: failureByActionRows.map((row) => ({
        action: row.action,
        count: row.count,
      })),
      byReason: failureByReasonRows.map((row) => ({
        reason: row.reason,
        count: row.count,
      })),
      recent: normalizeLogRows(recentFailureRows),
    },
    pharmacyActivity: {
      pharmacyId,
      recent: normalizeLogRows(recentPharmacyRows),
    },
  };
}
