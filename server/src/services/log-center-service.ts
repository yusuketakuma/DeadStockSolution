import { db } from '../config/database';
import { activityLogs, systemEvents, drugMasterSyncLogs } from '../db/schema';
import { desc, and, eq, gte, lte, ilike, or, sql, count } from 'drizzle-orm';
import { escapeLikeWildcards } from '../utils/request-utils';

// ── 定数・型 ──────────────────────────────────────────

export const LOG_SOURCES = ['activity_logs', 'system_events', 'drug_master_sync_logs'] as const;
export type LogSource = (typeof LOG_SOURCES)[number];
export const LOG_LEVELS = ['critical', 'error', 'warning', 'info'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface NormalizedLogEntry {
  id: number;
  source: LogSource;
  level: LogLevel;
  category: string;
  errorCode: string | null;
  message: string;
  detail: unknown;
  pharmacyId: number | null;
  timestamp: string;
}

export interface LogCenterQuery {
  sources?: LogSource[];
  level?: LogLevel;
  search?: string;
  pharmacyId?: number;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface LogSummary {
  total: number;
  errors: number;
  warnings: number;
  today: number;
  bySeverity: Record<string, number>;
  bySource: Record<string, number>;
}

function toUnknownRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

// ── 正規化（純粋関数） ──────────────────────────────────

/**
 * activity_logs の失敗パターン: detail が '失敗|' で始まる行
 */
const FAILURE_ACTIONS = ['login_failed', 'password_reset_failed'] as const;

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);
}

export function normalizeLogEntry(source: LogSource, row: Record<string, unknown>): NormalizedLogEntry {
  switch (source) {
    case 'activity_logs':
      return normalizeActivityLog(row);
    case 'system_events':
      return normalizeSystemEvent(row);
    case 'drug_master_sync_logs':
      return normalizeSyncLog(row);
  }
}

function normalizeActivityLog(row: Record<string, unknown>): NormalizedLogEntry {
  const action = String(row.action ?? '');
  const detail = row.detail != null ? String(row.detail) : '';
  const errorCode = row.errorCode != null ? String(row.errorCode) : null;

  let level: NormalizedLogEntry['level'] = 'info';
  if (detail.startsWith('失敗|')) {
    level = 'error';
  } else if (FAILURE_ACTIONS.includes(action as (typeof FAILURE_ACTIONS)[number])) {
    level = 'warning';
  }

  return {
    id: Number(row.id),
    source: 'activity_logs',
    level,
    category: String(row.resourceType ?? action),
    errorCode,
    message: `[${action}] ${detail}`,
    detail: parseJsonSafe(row.metadataJson),
    pharmacyId: row.pharmacyId != null ? Number(row.pharmacyId) : null,
    timestamp: String(row.createdAt ?? ''),
  };
}

const VALID_LEVELS = new Set<NormalizedLogEntry['level']>(['critical', 'error', 'warning', 'info']);

function normalizeSystemEvent(row: Record<string, unknown>): NormalizedLogEntry {
  const rawLevel = String(row.level ?? 'error');
  const level: NormalizedLogEntry['level'] = VALID_LEVELS.has(rawLevel as NormalizedLogEntry['level'])
    ? (rawLevel as NormalizedLogEntry['level'])
    : 'error';
  const errorCode = row.errorCode != null ? String(row.errorCode) : null;

  return {
    id: Number(row.id),
    source: 'system_events',
    level,
    category: String(row.eventType ?? ''),
    errorCode,
    message: String(row.message ?? ''),
    detail: parseJsonSafe(row.detailJson),
    pharmacyId: null,
    timestamp: String(row.occurredAt ?? ''),
  };
}

function normalizeSyncLog(row: Record<string, unknown>): NormalizedLogEntry {
  const status = String(row.status ?? '');
  const syncType = String(row.syncType ?? '');
  const sourceDescription = String(row.sourceDescription ?? '');

  let level: NormalizedLogEntry['level'] = 'info';
  let errorCode: string | null = null;
  if (status === 'failed') {
    level = 'error';
    errorCode = 'SYNC_MASTER_FAILED';
  } else if (status === 'partial') {
    level = 'warning';
  }

  return {
    id: Number(row.id),
    source: 'drug_master_sync_logs',
    level,
    category: 'drug_master_sync',
    errorCode,
    message: `[sync:${syncType}] ${sourceDescription} — ${status}`,
    detail: {
      itemsProcessed: row.itemsProcessed ?? 0,
      itemsAdded: row.itemsAdded ?? 0,
      itemsUpdated: row.itemsUpdated ?? 0,
      itemsDeleted: row.itemsDeleted ?? 0,
      errorMessage: row.errorMessage ?? null,
    },
    pharmacyId: row.triggeredBy != null ? Number(row.triggeredBy) : null,
    timestamp: String(row.startedAt ?? ''),
  };
}

function parseJsonSafe(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// ── ソーステーブル設定 ──────────────────────────────────

const SOURCE_TABLE_CONFIG = {
  activity_logs: {
    table: activityLogs,
    timestampCol: activityLogs.createdAt,
    pharmacyIdCol: activityLogs.pharmacyId as typeof activityLogs.pharmacyId | null,
    searchCols: [activityLogs.action, activityLogs.detail] as const,
    levelCol: null,
  },
  system_events: {
    table: systemEvents,
    timestampCol: systemEvents.occurredAt,
    pharmacyIdCol: null,
    searchCols: [systemEvents.message, systemEvents.eventType] as const,
    levelCol: systemEvents.level as typeof systemEvents.level | null,
  },
  drug_master_sync_logs: {
    table: drugMasterSyncLogs,
    timestampCol: drugMasterSyncLogs.startedAt,
    pharmacyIdCol: drugMasterSyncLogs.triggeredBy as typeof drugMasterSyncLogs.triggeredBy | null,
    searchCols: [drugMasterSyncLogs.syncType, drugMasterSyncLogs.sourceDescription] as const,
    levelCol: null,
  },
} satisfies Record<LogSource, {
  table: unknown;
  timestampCol: unknown;
  pharmacyIdCol: unknown;
  searchCols: readonly unknown[];
  levelCol: unknown;
}>;

// ── 共通条件構築 ──────────────────────────────────────────

function buildSourceConditions(source: LogSource, query: LogCenterQuery) {
  const config = SOURCE_TABLE_CONFIG[source];
  const conditions = [];

  if (query.pharmacyId != null && config.pharmacyIdCol) {
    conditions.push(eq(config.pharmacyIdCol, query.pharmacyId));
  }
  if (query.from) {
    conditions.push(gte(config.timestampCol, query.from));
  }
  if (query.to) {
    conditions.push(lte(config.timestampCol, query.to));
  }
  if (query.search) {
    const escaped = escapeLikeWildcards(query.search);
    conditions.push(
      or(...config.searchCols.map((col) => ilike(col, `%${escaped}%`))),
    );
  }
  if (query.level) {
    const levelCondition = buildLevelCondition(source, query.level, config.levelCol);
    if (levelCondition) {
      conditions.push(levelCondition);
    }
  }

  return { config, where: conditions.length > 0 ? and(...conditions) : undefined };
}

function buildLevelCondition(
  source: LogSource,
  level: NonNullable<LogCenterQuery['level']>,
  levelCol: unknown,
): ReturnType<typeof sql> | null {
  const cacheKey = `${source}:${level}`;
  const cached = levelConditionCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  if (source === 'system_events' && levelCol) {
    const condition = sql`${levelCol} = ${level}`;
    levelConditionCache.set(cacheKey, condition);
    return condition;
  }

  if (source === 'activity_logs') {
    if (level === 'critical') {
      const condition = sql`1 = 0`;
      levelConditionCache.set(cacheKey, condition);
      return condition;
    }
    if (level === 'error') {
      const condition = sql`coalesce(${activityLogs.detail}, '') like '失敗|%'`;
      levelConditionCache.set(cacheKey, condition);
      return condition;
    }
    if (level === 'warning') {
      const condition = sql`coalesce(${activityLogs.detail}, '') not like '失敗|%' and ${activityLogs.action} in ('login_failed', 'password_reset_failed')`;
      levelConditionCache.set(cacheKey, condition);
      return condition;
    }
    if (level === 'info') {
      const condition = sql`coalesce(${activityLogs.detail}, '') not like '失敗|%' and ${activityLogs.action} not in ('login_failed', 'password_reset_failed')`;
      levelConditionCache.set(cacheKey, condition);
      return condition;
    }
    const condition = sql`1 = 0`;
    levelConditionCache.set(cacheKey, condition);
    return condition;
  }

  if (source === 'drug_master_sync_logs') {
    if (level === 'critical') {
      const condition = sql`1 = 0`;
      levelConditionCache.set(cacheKey, condition);
      return condition;
    }
    if (level === 'error') {
      const condition = sql`${drugMasterSyncLogs.status} = 'failed'`;
      levelConditionCache.set(cacheKey, condition);
      return condition;
    }
    if (level === 'warning') {
      const condition = sql`${drugMasterSyncLogs.status} = 'partial'`;
      levelConditionCache.set(cacheKey, condition);
      return condition;
    }
    if (level === 'info') {
      const condition = sql`${drugMasterSyncLogs.status} not in ('failed', 'partial')`;
      levelConditionCache.set(cacheKey, condition);
      return condition;
    }
    const condition = sql`1 = 0`;
    levelConditionCache.set(cacheKey, condition);
    return condition;
  }

  levelConditionCache.set(cacheKey, null);
  return null;
}

const levelConditionCache = new Map<string, ReturnType<typeof sql> | null>();

// ── 汎用ソーステーブルクエリ ──────────────────────────────

async function querySourceTable(source: LogSource, query: LogCenterQuery, fetchLimit = 1000): Promise<NormalizedLogEntry[]> {
  const { config, where } = buildSourceConditions(source, query);
  const rows = await db
    .select()
    .from(config.table)
    .where(where)
    .orderBy(desc(config.timestampCol))
    .limit(fetchLimit);

  return rows.map((row) => normalizeLogEntry(source, toUnknownRecord(row)));
}

// ── ソーステーブル COUNT ──────────────────────────────────

async function countSourceTable(source: LogSource, query: LogCenterQuery): Promise<number> {
  const { config, where } = buildSourceConditions(source, query);
  const [row] = await db
    .select({ cnt: count() })
    .from(config.table)
    .where(where);
  return Number(row?.cnt ?? 0);
}

function compareEntryTimestampDesc(left: NormalizedLogEntry, right: NormalizedLogEntry): number {
  if (left.timestamp > right.timestamp) return -1;
  if (left.timestamp < right.timestamp) return 1;
  return 0;
}

function mergeEntriesForPage(
  sourceEntries: NormalizedLogEntry[][],
  offset: number,
  limit: number,
): NormalizedLogEntry[] {
  const targetLength = offset + limit;
  if (targetLength <= 0) return [];

  const indexes = sourceEntries.map(() => 0);
  const merged: NormalizedLogEntry[] = [];

  while (merged.length < targetLength) {
    let selectedSource = -1;
    let selectedEntry: NormalizedLogEntry | null = null;

    for (let sourceIndex = 0; sourceIndex < sourceEntries.length; sourceIndex += 1) {
      const rowIndex = indexes[sourceIndex];
      const candidate = sourceEntries[sourceIndex]?.[rowIndex];
      if (!candidate) continue;
      if (!selectedEntry) {
        selectedEntry = candidate;
        selectedSource = sourceIndex;
        continue;
      }
      const compare = compareEntryTimestampDesc(candidate, selectedEntry);
      if (compare < 0 || (compare === 0 && sourceIndex < selectedSource)) {
        selectedEntry = candidate;
        selectedSource = sourceIndex;
      }
    }

    if (!selectedEntry || selectedSource < 0) break;
    merged.push(selectedEntry);
    indexes[selectedSource] += 1;
  }

  return merged.slice(offset, offset + limit);
}

// ── クエリ関数 ──────────────────────────────────────────

export async function queryLogs(query: LogCenterQuery): Promise<{
  entries: NormalizedLogEntry[];
  total: number;
  page: number;
  limit: number;
}> {
  const sources = query.sources ?? [...LOG_SOURCES];
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.max(1, query.limit ?? 50);
  const offset = (page - 1) * limit;
  const requiredRows = offset + limit;

  // まず件数だけ取得して総数を確定
  const countPromises = sources.map((source) => countSourceTable(source, query));
  const counts = await Promise.all(countPromises);
  const total = counts.reduce((sum, c) => sum + c, 0);

  // 深いページでも欠落しないよう、必要行数までを各ソースから取得する
  const dataPromises = sources.map((source, index) => {
    const fetchLimit = Math.min(counts[index], requiredRows);
    if (fetchLimit <= 0) return Promise.resolve([]);
    return querySourceTable(source, query, fetchLimit);
  });
  const results = await Promise.all(dataPromises);
  const paginated = mergeEntriesForPage(results, offset, limit);

  return {
    entries: paginated,
    total,
    page,
    limit,
  };
}

// ── サマリー（3クエリ: 各テーブルで条件別集計） ──────────

export async function getLogSummary(): Promise<LogSummary> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStr = todayStart.toISOString();

  const [activityRow, systemRow, syncRow] = await Promise.all([
    // activity_logs: total + today (1 query)
    db.select({
      total: count(),
      today: sql<number>`count(*) filter (where ${activityLogs.createdAt} >= ${todayStr})`,
    }).from(activityLogs).then((r) => r[0]),

    // system_events: total + today + errors + warnings (1 query)
    db.select({
      total: count(),
      today: sql<number>`count(*) filter (where ${systemEvents.occurredAt} >= ${todayStr})`,
      errors: sql<number>`count(*) filter (where ${systemEvents.level} = 'error')`,
      warnings: sql<number>`count(*) filter (where ${systemEvents.level} = 'warning')`,
    }).from(systemEvents).then((r) => r[0]),

    // drug_master_sync_logs: total + today + failed + partial (1 query)
    db.select({
      total: count(),
      today: sql<number>`count(*) filter (where ${drugMasterSyncLogs.startedAt} >= ${todayStr})`,
      failed: sql<number>`count(*) filter (where ${drugMasterSyncLogs.status} = 'failed')`,
      partial: sql<number>`count(*) filter (where ${drugMasterSyncLogs.status} = 'partial')`,
    }).from(drugMasterSyncLogs).then((r) => r[0]),
  ]);

  const activityTotal = Number(activityRow?.total ?? 0);
  const systemTotal = Number(systemRow?.total ?? 0);
  const syncTotal = Number(syncRow?.total ?? 0);
  const total = activityTotal + systemTotal + syncTotal;

  const errors = Number(systemRow?.errors ?? 0) + Number(syncRow?.failed ?? 0);
  const warnings = Number(systemRow?.warnings ?? 0) + Number(syncRow?.partial ?? 0);
  const today = Number(activityRow?.today ?? 0) + Number(systemRow?.today ?? 0) + Number(syncRow?.today ?? 0);

  return {
    total,
    errors,
    warnings,
    today,
    bySeverity: {
      error: errors,
      warning: warnings,
      info: total - errors - warnings,
    },
    bySource: {
      activity_logs: activityTotal,
      system_events: systemTotal,
      drug_master_sync_logs: syncTotal,
    },
  };
}
