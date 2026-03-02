import { db } from '../config/database';
import { activityLogs, systemEvents, drugMasterSyncLogs } from '../db/schema';
import { desc, and, eq, gte, lte, ilike, or, sql, count } from 'drizzle-orm';

// ── 定数・型 ──────────────────────────────────────────

export const LOG_SOURCES = ['activity_logs', 'system_events', 'drug_master_sync_logs'] as const;
export type LogSource = (typeof LOG_SOURCES)[number];

export interface NormalizedLogEntry {
  id: number;
  source: LogSource;
  level: 'critical' | 'error' | 'warning' | 'info';
  category: string;
  errorCode: string | null;
  message: string;
  detail: unknown;
  pharmacyId: number | null;
  timestamp: string;
}

export interface LogCenterQuery {
  sources?: LogSource[];
  level?: NormalizedLogEntry['level'];
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

// ── 正規化（純粋関数） ──────────────────────────────────

/**
 * activity_logs の失敗パターン: detail が '失敗|' で始まる行
 */
const FAILURE_ACTIONS = ['login_failed', 'password_reset_failed'] as const;

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

function normalizeSystemEvent(row: Record<string, unknown>): NormalizedLogEntry {
  const level = String(row.level ?? 'error') as NormalizedLogEntry['level'];
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

// ── クエリ関数 ──────────────────────────────────────────

export async function queryLogs(query: LogCenterQuery): Promise<{
  entries: NormalizedLogEntry[];
  total: number;
  page: number;
  limit: number;
}> {
  const sources = query.sources ?? [...LOG_SOURCES];
  const page = query.page ?? 1;
  const limit = query.limit ?? 50;

  const allEntries: NormalizedLogEntry[] = [];

  // 各ソースを並列クエリ
  const promises = sources.map(async (source) => {
    switch (source) {
      case 'activity_logs':
        return queryActivityLogs(query);
      case 'system_events':
        return querySystemEvents(query);
      case 'drug_master_sync_logs':
        return querySyncLogs(query);
    }
  });

  const results = await Promise.all(promises);
  for (const rows of results) {
    allEntries.push(...rows);
  }

  // レベルフィルタ（DB 側で完全にはフィルタできないため正規化後にフィルタ）
  const filtered = query.level
    ? allEntries.filter((e) => e.level === query.level)
    : allEntries;

  // タイムスタンプ降順ソート
  filtered.sort((a, b) => {
    if (a.timestamp > b.timestamp) return -1;
    if (a.timestamp < b.timestamp) return 1;
    return 0;
  });

  // ページネーション
  const offset = (page - 1) * limit;
  const paginated = filtered.slice(offset, offset + limit);

  return {
    entries: paginated,
    total: filtered.length,
    page,
    limit,
  };
}

async function queryActivityLogs(query: LogCenterQuery): Promise<NormalizedLogEntry[]> {
  const conditions = [];

  if (query.pharmacyId != null) {
    conditions.push(eq(activityLogs.pharmacyId, query.pharmacyId));
  }
  if (query.from) {
    conditions.push(gte(activityLogs.createdAt, query.from));
  }
  if (query.to) {
    conditions.push(lte(activityLogs.createdAt, query.to));
  }
  if (query.search) {
    conditions.push(
      or(
        ilike(activityLogs.action, `%${query.search}%`),
        ilike(activityLogs.detail, `%${query.search}%`),
      ),
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = await db
    .select()
    .from(activityLogs)
    .where(where)
    .orderBy(desc(activityLogs.createdAt))
    .limit(1000);

  return rows.map((r) => normalizeLogEntry('activity_logs', r as unknown as Record<string, unknown>));
}

async function querySystemEvents(query: LogCenterQuery): Promise<NormalizedLogEntry[]> {
  const conditions = [];

  if (query.from) {
    conditions.push(gte(systemEvents.occurredAt, query.from));
  }
  if (query.to) {
    conditions.push(lte(systemEvents.occurredAt, query.to));
  }
  if (query.search) {
    conditions.push(
      or(
        ilike(systemEvents.message, `%${query.search}%`),
        ilike(systemEvents.eventType, `%${query.search}%`),
      ),
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = await db
    .select()
    .from(systemEvents)
    .where(where)
    .orderBy(desc(systemEvents.occurredAt))
    .limit(1000);

  return rows.map((r) => normalizeLogEntry('system_events', r as unknown as Record<string, unknown>));
}

async function querySyncLogs(query: LogCenterQuery): Promise<NormalizedLogEntry[]> {
  const conditions = [];

  if (query.pharmacyId != null) {
    conditions.push(eq(drugMasterSyncLogs.triggeredBy, query.pharmacyId));
  }
  if (query.from) {
    conditions.push(gte(drugMasterSyncLogs.startedAt, query.from));
  }
  if (query.to) {
    conditions.push(lte(drugMasterSyncLogs.startedAt, query.to));
  }
  if (query.search) {
    conditions.push(
      or(
        ilike(drugMasterSyncLogs.syncType, `%${query.search}%`),
        ilike(drugMasterSyncLogs.sourceDescription, `%${query.search}%`),
      ),
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = await db
    .select()
    .from(drugMasterSyncLogs)
    .where(where)
    .orderBy(desc(drugMasterSyncLogs.startedAt))
    .limit(1000);

  return rows.map((r) => normalizeLogEntry('drug_master_sync_logs', r as unknown as Record<string, unknown>));
}

// ── サマリー ──────────────────────────────────────────

export async function getLogSummary(): Promise<LogSummary> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayStr = todayStart.toISOString();

  // 各テーブルのカウントを並列取得
  const [
    activityTotal,
    activityToday,
    systemTotal,
    systemToday,
    systemErrors,
    systemWarnings,
    syncTotal,
    syncToday,
    syncFailed,
    syncPartial,
  ] = await Promise.all([
    // activity_logs
    db.select({ cnt: count() }).from(activityLogs).then((r) => r[0]?.cnt ?? 0),
    db.select({ cnt: count() }).from(activityLogs)
      .where(gte(activityLogs.createdAt, todayStr))
      .then((r) => r[0]?.cnt ?? 0),

    // system_events
    db.select({ cnt: count() }).from(systemEvents).then((r) => r[0]?.cnt ?? 0),
    db.select({ cnt: count() }).from(systemEvents)
      .where(gte(systemEvents.occurredAt, todayStr))
      .then((r) => r[0]?.cnt ?? 0),
    db.select({ cnt: count() }).from(systemEvents)
      .where(eq(systemEvents.level, 'error'))
      .then((r) => r[0]?.cnt ?? 0),
    db.select({ cnt: count() }).from(systemEvents)
      .where(eq(systemEvents.level, 'warning'))
      .then((r) => r[0]?.cnt ?? 0),

    // drug_master_sync_logs
    db.select({ cnt: count() }).from(drugMasterSyncLogs).then((r) => r[0]?.cnt ?? 0),
    db.select({ cnt: count() }).from(drugMasterSyncLogs)
      .where(gte(drugMasterSyncLogs.startedAt, todayStr))
      .then((r) => r[0]?.cnt ?? 0),
    db.select({ cnt: count() }).from(drugMasterSyncLogs)
      .where(eq(drugMasterSyncLogs.status, 'failed'))
      .then((r) => r[0]?.cnt ?? 0),
    db.select({ cnt: count() }).from(drugMasterSyncLogs)
      .where(eq(drugMasterSyncLogs.status, 'partial'))
      .then((r) => r[0]?.cnt ?? 0),
  ]);

  const total = Number(activityTotal) + Number(systemTotal) + Number(syncTotal);
  const errors = Number(systemErrors) + Number(syncFailed);
  const warnings = Number(systemWarnings) + Number(syncPartial);
  const today = Number(activityToday) + Number(systemToday) + Number(syncToday);

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
      activity_logs: Number(activityTotal),
      system_events: Number(systemTotal),
      drug_master_sync_logs: Number(syncTotal),
    },
  };
}
