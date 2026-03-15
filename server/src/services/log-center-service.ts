import { db } from '../config/database';
import { activityLogs, systemEvents, drugMasterSyncLogs, pharmacies, errorCodes } from '../db/schema';
import { desc, and, eq, gte, lte, ilike, or, sql, count, inArray } from 'drizzle-orm';
import { escapeLikeWildcards } from '../utils/request-utils';

// ── 定数・型 ──────────────────────────────────────────

export const LOG_SOURCES = ['activity_logs', 'system_events', 'drug_master_sync_logs'] as const;
export type LogSource = (typeof LOG_SOURCES)[number];
export const LOG_LEVELS = ['critical', 'error', 'warning', 'info'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export const LOG_ISSUE_WORKFLOW_STATUSES = ['new', 'investigating', 'resolved', 'false_positive'] as const;
export type LogIssueWorkflowStatus = (typeof LOG_ISSUE_WORKFLOW_STATUSES)[number];

export interface LogIssueActor {
  pharmacyId: number | null;
  pharmacyName: string | null;
  pharmacyEmail: string | null;
}

export interface LogIssueState {
  status: LogIssueWorkflowStatus;
  note: string | null;
  updatedAt: string | null;
  updatedBy: LogIssueActor | null;
}

export interface LogIssueHistoryEntry {
  id: number;
  kind: 'status_update' | 'auto_escalation';
  source: LogSource;
  logId: number;
  status: LogIssueWorkflowStatus | null;
  note: string | null;
  reasonCodes: string[];
  createdAt: string;
  actor: LogIssueActor | null;
}

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
  whatHappened: string;
  codeLocation: string | null;
  improvementSuggestion: string | null;
  tenant: {
    pharmacyId: number | null;
    pharmacyName: string | null;
    pharmacyEmail: string | null;
    tenantLabel: string | null;
  };
  errorCodeMeta: {
    titleJa: string | null;
    descriptionJa: string | null;
    resolutionJa: string | null;
    severity: string | null;
    category: string | null;
  } | null;
  operatorState: LogIssueState;
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

export interface LogInsightItem {
  fingerprint: string;
  level: LogLevel;
  title: string;
  codeLocation: string | null;
  errorCode: string | null;
  count: number;
  impactedTenantCount: number;
  latestOccurredAt: string;
  sampleLogId: number;
  source: LogSource;
}

export interface LogInsightsSummary {
  repeatedErrorCount: number;
  impactedTenantCount: number;
  topIssues: LogInsightItem[];
}

export interface LogInsightsQuery extends LogCenterQuery {
  minOccurrences?: number;
  topLimit?: number;
}

function toUnknownRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function getNestedRecord(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = record[key];
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function getStringValue(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function getNumberValue(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function extractTenantContext(detail: unknown, fallbackPharmacyId: number | null) {
  const detailRecord = toUnknownRecord(detail);
  const tenantRecord = getNestedRecord(detailRecord, 'tenant');
  const tenantPharmacyId = getNumberValue(tenantRecord ?? detailRecord, 'pharmacyId');
  const pharmacyId = fallbackPharmacyId ?? tenantPharmacyId;
  const pharmacyName = getStringValue(tenantRecord ?? detailRecord, 'pharmacyName');
  const pharmacyEmail = getStringValue(tenantRecord ?? detailRecord, 'pharmacyEmail')
    ?? getStringValue(tenantRecord ?? detailRecord, 'email');

  return {
    pharmacyId,
    pharmacyName,
    pharmacyEmail,
    tenantLabel: pharmacyName ?? (pharmacyId != null ? `薬局 #${pharmacyId}` : pharmacyEmail),
  };
}

function extractStack(detail: unknown): string | null {
  const detailRecord = toUnknownRecord(detail);
  const direct = getStringValue(detailRecord, 'stack');
  if (direct) return direct;

  const errorRecord = getNestedRecord(detailRecord, 'error');
  return errorRecord ? getStringValue(errorRecord, 'stack') : null;
}

function extractSourceLocation(detail: unknown): string | null {
  const detailRecord = toUnknownRecord(detail);
  return getStringValue(detailRecord, 'sourceLocation');
}

function normalizeStackLocation(segment: string): string {
  const match = segment.match(/((?:server|client)\/src\/[^:\s)]+\.(?:ts|tsx|js|mjs)(?::\d+:\d+)?)/);
  if (match?.[1]) return match[1];
  return segment.trim();
}

function extractCodeLocationFromStack(stack: string | null): string | null {
  if (!stack) return null;
  const lines = stack.split('\n');
  for (const line of lines) {
    if (line.includes('/server/src/') || line.includes('/client/src/')) {
      return normalizeStackLocation(line);
    }
    if (line.includes('server/src/') || line.includes('client/src/')) {
      return normalizeStackLocation(line);
    }
  }
  return null;
}

function parseActionFromMessage(message: string): string | null {
  const match = message.match(/^\[([^\]]+)\]/);
  return match?.[1] ?? null;
}

function mapRequestPathToCodeLocation(path: string | null): string | null {
  if (!path) return null;
  if (path.startsWith('/api/account')) return 'server/src/routes/account.ts';
  if (path.startsWith('/api/auth')) return 'server/src/routes/auth.ts';
  if (path.startsWith('/api/admin/log-center')) return 'server/src/routes/admin-log-center.ts';
  if (path.startsWith('/api/admin/drug-master')) return 'server/src/routes/drug-master.ts';
  if (path.startsWith('/api/upload')) return 'server/src/routes/upload.ts';
  if (path.startsWith('/api/inventory')) return 'server/src/routes/inventory.ts';
  if (path.startsWith('/api/notifications')) return 'server/src/routes/notifications.ts';
  if (path.startsWith('/api/groups')) return 'server/src/routes/groups.ts';
  if (path.startsWith('/api/openclaw')) return 'server/src/routes/openclaw.ts';
  if (path.startsWith('/api/exchange')) return 'server/src/routes/exchange-proposals.ts';
  if (path.startsWith('/api/internal/vercel-deploy-events')) return 'server/src/routes/internal-vercel-deploy-events.ts';
  if (path.startsWith('/api/internal/')) return 'server/src/routes/internal-monitoring.ts';
  return null;
}

function mapActionToCodeLocation(action: string | null): string | null {
  switch (action) {
    case 'login':
    case 'login_failed':
    case 'admin_login':
    case 'register':
    case 'logout':
    case 'password_reset_request':
    case 'password_reset_complete':
    case 'password_reset_failed':
      return 'server/src/routes/auth.ts';
    case 'account_update':
    case 'account_deactivate':
      return 'server/src/routes/account.ts';
    case 'proposal_create':
    case 'proposal_accept':
    case 'proposal_reject':
    case 'proposal_complete':
      return 'server/src/routes/exchange-proposals.ts';
    case 'upload':
      return 'server/src/routes/upload.ts';
    case 'dead_stock_delete':
      return 'server/src/routes/inventory.ts';
    case 'drug_master_sync':
    case 'drug_master_package_upload':
    case 'drug_master_edit':
      return 'server/src/routes/drug-master.ts';
    case 'admin_verify_pharmacy':
    case 'admin_bulk_verify':
    case 'admin_bulk_reject':
    case 'admin_toggle_active':
      return 'server/src/routes/admin-pharmacies-actions.ts';
    default:
      return null;
  }
}

function inferCodeLocation(entry: Pick<NormalizedLogEntry, 'source' | 'category' | 'message' | 'detail'>): string | null {
  const directLocation = extractSourceLocation(entry.detail);
  if (directLocation) return directLocation;

  const stackLocation = extractCodeLocationFromStack(extractStack(entry.detail));
  if (stackLocation) return stackLocation;

  if (entry.source === 'system_events') {
    const detailRecord = toUnknownRecord(entry.detail);
    const path = getStringValue(detailRecord, 'path');
    return mapRequestPathToCodeLocation(path);
  }

  if (entry.source === 'activity_logs') {
    return mapActionToCodeLocation(parseActionFromMessage(entry.message));
  }

  if (entry.source === 'drug_master_sync_logs') {
    return 'server/src/routes/drug-master.ts';
  }

  return null;
}

function buildFallbackWhatHappened(entry: Pick<NormalizedLogEntry, 'source' | 'message' | 'detail'>): string {
  const detailRecord = toUnknownRecord(entry.detail);
  if (entry.source === 'system_events') {
    const path = getStringValue(detailRecord, 'path');
    const status = getNumberValue(detailRecord, 'status');
    if (path && status != null) {
      return `${path} で HTTP ${status} エラーが発生しました`;
    }
  }

  const normalizedMessage = entry.message.replace(/^\[[^\]]+\]\s*/, '').trim();
  if (normalizedMessage.startsWith('失敗|')) {
    return normalizedMessage.replace(/^失敗\|/, '').trim();
  }

  return normalizedMessage || entry.message;
}

function buildFallbackImprovementSuggestion(entry: Pick<NormalizedLogEntry, 'source' | 'message' | 'detail' | 'codeLocation'>): string | null {
  const detailRecord = toUnknownRecord(entry.detail);
  if (entry.source === 'system_events') {
    const status = getNumberValue(detailRecord, 'status');
    if (status != null && status >= 500) {
      return '再現条件を確認し、例外スタックと該当ルート/サービスで null 防御・入力検証・外部依存の失敗ハンドリングを補強してください。';
    }
  }

  const action = parseActionFromMessage(entry.message);
  if (action === 'login_failed' || action === 'password_reset_failed') {
    return '認証情報、アカウント状態、レート制限設定、トークン有効期限を確認してください。';
  }
  if (entry.codeLocation?.includes('drug-master')) {
    return '外部同期元の到達性、入力データ形式、同期ジョブの例外処理を確認してください。';
  }
  return '詳細ログと再現条件を確認し、推定発生コード周辺の防御処理を見直してください。';
}

function mergeTenantLabel(input: {
  pharmacyId: number | null;
  pharmacyName: string | null;
  pharmacyEmail: string | null;
}) {
  return input.pharmacyName ?? (input.pharmacyId != null ? `薬局 #${input.pharmacyId}` : input.pharmacyEmail);
}

function createDefaultOperatorState(): LogIssueState {
  return {
    status: 'new',
    note: null,
    updatedAt: null,
    updatedBy: null,
  };
}

export function buildLogIssueResourceId(source: LogSource, logId: number): string {
  return `${source}:${logId}`;
}

function parseLogIssueResourceId(resourceId: string | null | undefined): { source: LogSource; logId: number } | null {
  if (!resourceId) return null;
  const [source, logIdRaw] = resourceId.split(':');
  if (!LOG_SOURCES.includes(source as LogSource)) return null;
  const logId = Number(logIdRaw);
  if (!Number.isInteger(logId) || logId <= 0) return null;
  return { source: source as LogSource, logId };
}

function isWorkflowStatus(value: unknown): value is LogIssueWorkflowStatus {
  return typeof value === 'string' && (LOG_ISSUE_WORKFLOW_STATUSES as readonly string[]).includes(value);
}

export function isLogIssueAuditAction(action: unknown): boolean {
  return action === 'admin_log_status_update' || action === 'admin_log_auto_escalated';
}

export function extractStatusMetadata(detail: unknown): {
  status: LogIssueWorkflowStatus | null;
  note: string | null;
  reasonCodes: string[];
} {
  const record = toUnknownRecord(detail);
  const status = isWorkflowStatus(record.status) ? record.status : null;
  const note = getStringValue(record, 'note');
  const reasonCodesValue = record.reasonCodes;
  const reasonCodes = Array.isArray(reasonCodesValue)
    ? reasonCodesValue.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : [];
  return { status, note, reasonCodes };
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
  const metadata = parseJsonSafe(row.metadataJson);
  const tenant = extractTenantContext(metadata, row.pharmacyId != null ? Number(row.pharmacyId) : null);

  let level: NormalizedLogEntry['level'] = 'info';
  if (detail.startsWith('失敗|')) {
    level = 'error';
  } else if (FAILURE_ACTIONS.includes(action as (typeof FAILURE_ACTIONS)[number])) {
    level = 'warning';
  }

  const entry: NormalizedLogEntry = {
    id: Number(row.id),
    source: 'activity_logs',
    level,
    category: String(row.resourceType ?? action),
    errorCode,
    message: `[${action}] ${detail}`,
    detail: metadata,
    pharmacyId: tenant.pharmacyId,
    timestamp: String(row.createdAt ?? ''),
    whatHappened: '',
    codeLocation: null,
    improvementSuggestion: null,
    tenant,
    errorCodeMeta: null,
    operatorState: createDefaultOperatorState(),
  };

  entry.codeLocation = inferCodeLocation(entry);
  entry.whatHappened = buildFallbackWhatHappened(entry);
  entry.improvementSuggestion = buildFallbackImprovementSuggestion(entry);
  return entry;
}

const VALID_LEVELS = new Set<NormalizedLogEntry['level']>(['critical', 'error', 'warning', 'info']);

function normalizeSystemEvent(row: Record<string, unknown>): NormalizedLogEntry {
  const rawLevel = String(row.level ?? 'error');
  const level: NormalizedLogEntry['level'] = VALID_LEVELS.has(rawLevel as NormalizedLogEntry['level'])
    ? (rawLevel as NormalizedLogEntry['level'])
    : 'error';
  const errorCode = row.errorCode != null ? String(row.errorCode) : null;
  const detail = parseJsonSafe(row.detailJson);
  const tenant = extractTenantContext(detail, null);

  const entry: NormalizedLogEntry = {
    id: Number(row.id),
    source: 'system_events',
    level,
    category: String(row.eventType ?? ''),
    errorCode,
    message: String(row.message ?? ''),
    detail,
    pharmacyId: tenant.pharmacyId,
    timestamp: String(row.occurredAt ?? ''),
    whatHappened: '',
    codeLocation: null,
    improvementSuggestion: null,
    tenant,
    errorCodeMeta: null,
    operatorState: createDefaultOperatorState(),
  };

  entry.codeLocation = inferCodeLocation(entry);
  entry.whatHappened = buildFallbackWhatHappened(entry);
  entry.improvementSuggestion = buildFallbackImprovementSuggestion(entry);
  return entry;
}

function normalizeSyncLog(row: Record<string, unknown>): NormalizedLogEntry {
  const status = String(row.status ?? '');
  const syncType = String(row.syncType ?? '');
  const sourceDescription = String(row.sourceDescription ?? '');
  const tenant = extractTenantContext(null, row.triggeredBy != null ? Number(row.triggeredBy) : null);

  let level: NormalizedLogEntry['level'] = 'info';
  let errorCode: string | null = null;
  if (status === 'failed') {
    level = 'error';
    errorCode = 'SYNC_MASTER_FAILED';
  } else if (status === 'partial') {
    level = 'warning';
  }

  const entry: NormalizedLogEntry = {
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
    pharmacyId: tenant.pharmacyId,
    timestamp: String(row.startedAt ?? ''),
    whatHappened: '',
    codeLocation: null,
    improvementSuggestion: null,
    tenant,
    errorCodeMeta: null,
    operatorState: createDefaultOperatorState(),
  };

  entry.codeLocation = inferCodeLocation(entry);
  entry.whatHappened = buildFallbackWhatHappened(entry);
  entry.improvementSuggestion = buildFallbackImprovementSuggestion(entry);
  return entry;
}

export function parseJsonSafe(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function buildZeroCondition() {
  return sql`1 = 0`;
}

function buildActivityLevelCondition(level: NonNullable<LogCenterQuery['level']>) {
  if (level === 'critical') return buildZeroCondition();
  if (level === 'error') return sql`coalesce(${activityLogs.detail}, '') like '失敗|%'`;
  if (level === 'warning') {
    return sql`coalesce(${activityLogs.detail}, '') not like '失敗|%' and ${activityLogs.action} in ('login_failed', 'password_reset_failed')`;
  }
  if (level === 'info') {
    return sql`coalesce(${activityLogs.detail}, '') not like '失敗|%' and ${activityLogs.action} not in ('login_failed', 'password_reset_failed')`;
  }
  return buildZeroCondition();
}

function buildSyncLevelCondition(level: NonNullable<LogCenterQuery['level']>) {
  if (level === 'critical') return buildZeroCondition();
  if (level === 'error') return sql`${drugMasterSyncLogs.status} = 'failed'`;
  if (level === 'warning') return sql`${drugMasterSyncLogs.status} = 'partial'`;
  if (level === 'info') return sql`${drugMasterSyncLogs.status} not in ('failed', 'partial')`;
  return buildZeroCondition();
}

// ── ソーステーブル設定 ──────────────────────────────────

const SOURCE_TABLE_CONFIG = {
  activity_logs: {
    table: activityLogs,
    idCol: activityLogs.id,
    timestampCol: activityLogs.createdAt,
    pharmacyIdCol: activityLogs.pharmacyId as typeof activityLogs.pharmacyId | null,
    searchCols: [activityLogs.action, activityLogs.detail] as const,
    levelCol: null,
  },
  system_events: {
    table: systemEvents,
    idCol: systemEvents.id,
    timestampCol: systemEvents.occurredAt,
    pharmacyIdCol: null,
    searchCols: [systemEvents.message, systemEvents.eventType] as const,
    levelCol: systemEvents.level as typeof systemEvents.level | null,
  },
  drug_master_sync_logs: {
    table: drugMasterSyncLogs,
    idCol: drugMasterSyncLogs.id,
    timestampCol: drugMasterSyncLogs.startedAt,
    pharmacyIdCol: drugMasterSyncLogs.triggeredBy as typeof drugMasterSyncLogs.triggeredBy | null,
    searchCols: [drugMasterSyncLogs.syncType, drugMasterSyncLogs.sourceDescription] as const,
    levelCol: null,
  },
} satisfies Record<LogSource, {
  table: unknown;
  idCol: unknown;
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
  if (source === 'activity_logs') {
    conditions.push(sql`${activityLogs.action} not in ('admin_log_status_update', 'admin_log_auto_escalated')`);
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
    const condition = buildActivityLevelCondition(level);
    levelConditionCache.set(cacheKey, condition);
    return condition;
  }

  if (source === 'drug_master_sync_logs') {
    const condition = buildSyncLevelCondition(level);
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

async function querySourceEntryById(source: LogSource, id: number): Promise<NormalizedLogEntry | null> {
  const config = SOURCE_TABLE_CONFIG[source];
  const [row] = await db
    .select()
    .from(config.table)
    .where(eq(config.idCol, id))
    .limit(1);

  if (!row) return null;
  return normalizeLogEntry(source, toUnknownRecord(row));
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

type ErrorCodeRow = typeof errorCodes.$inferSelect;
type PharmacyRow = Pick<typeof pharmacies.$inferSelect, 'id' | 'name' | 'email'>;
export type ActivityLogRow = Pick<typeof activityLogs.$inferSelect, 'id' | 'pharmacyId' | 'action' | 'resourceId' | 'metadataJson' | 'createdAt'>;

async function loadErrorCodeMap(codes: string[]): Promise<Map<string, ErrorCodeRow>> {
  if (codes.length === 0) return new Map();
  const rows = await db
    .select()
    .from(errorCodes)
    .where(inArray(errorCodes.code, codes));
  return new Map(rows.map((row) => [row.code, row]));
}

export async function loadPharmacyMap(pharmacyIds: number[]): Promise<Map<number, PharmacyRow>> {
  if (pharmacyIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: pharmacies.id,
      name: pharmacies.name,
      email: pharmacies.email,
    })
    .from(pharmacies)
    .where(inArray(pharmacies.id, pharmacyIds));
  return new Map(rows.map((row) => [row.id, row]));
}

function enrichEntry(
  entry: NormalizedLogEntry,
  pharmacyMap: Map<number, PharmacyRow>,
  errorCodeMap: Map<string, ErrorCodeRow>,
  issueStateMap: Map<string, LogIssueState>,
): NormalizedLogEntry {
  const pharmacy = entry.pharmacyId != null ? pharmacyMap.get(entry.pharmacyId) : undefined;
  const errorCodeMeta = entry.errorCode ? errorCodeMap.get(entry.errorCode) ?? null : null;
  const tenant = {
    pharmacyId: entry.pharmacyId,
    pharmacyName: entry.tenant.pharmacyName ?? pharmacy?.name ?? null,
    pharmacyEmail: entry.tenant.pharmacyEmail ?? pharmacy?.email ?? null,
    tenantLabel: mergeTenantLabel({
      pharmacyId: entry.pharmacyId,
      pharmacyName: entry.tenant.pharmacyName ?? pharmacy?.name ?? null,
      pharmacyEmail: entry.tenant.pharmacyEmail ?? pharmacy?.email ?? null,
    }) ?? null,
  };

  const whatHappened = errorCodeMeta?.titleJa
    ? `${errorCodeMeta.titleJa}${errorCodeMeta.descriptionJa ? `: ${errorCodeMeta.descriptionJa}` : ''}`
    : entry.whatHappened;

  const improvementSuggestion = errorCodeMeta?.resolutionJa
    ?? entry.improvementSuggestion;

  return {
    ...entry,
    tenant,
    whatHappened,
    improvementSuggestion,
    errorCodeMeta: errorCodeMeta ? {
      titleJa: errorCodeMeta.titleJa,
      descriptionJa: errorCodeMeta.descriptionJa ?? null,
      resolutionJa: errorCodeMeta.resolutionJa ?? null,
      severity: errorCodeMeta.severity,
      category: errorCodeMeta.category,
    } : null,
    operatorState: issueStateMap.get(buildLogIssueResourceId(entry.source, entry.id)) ?? entry.operatorState,
  };
}

async function loadIssueStateMap(resourceIds: string[]): Promise<Map<string, LogIssueState>> {
  if (resourceIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: activityLogs.id,
      pharmacyId: activityLogs.pharmacyId,
      action: activityLogs.action,
      resourceId: activityLogs.resourceId,
      metadataJson: activityLogs.metadataJson,
      createdAt: activityLogs.createdAt,
    })
    .from(activityLogs)
    .where(and(
      eq(activityLogs.resourceType, 'log_center_issue'),
      eq(activityLogs.action, 'admin_log_status_update'),
      inArray(activityLogs.resourceId, resourceIds),
    ))
    .orderBy(desc(activityLogs.createdAt), desc(activityLogs.id));

  const actorIds = [...new Set(
    rows
      .map((row) => row.pharmacyId)
      .filter((value): value is number => value != null),
  )];
  const pharmacyMap = await loadPharmacyMap(actorIds);
  const stateMap = new Map<string, LogIssueState>();

  for (const row of rows) {
    const resourceId = row.resourceId ?? null;
    if (!resourceId || stateMap.has(resourceId)) continue;
    const metadata = extractStatusMetadata(parseJsonSafe(row.metadataJson));
    if (!metadata.status) continue;
    const actor = row.pharmacyId != null ? pharmacyMap.get(row.pharmacyId) : undefined;
    stateMap.set(resourceId, {
      status: metadata.status,
      note: metadata.note,
      updatedAt: row.createdAt ?? null,
      updatedBy: actor ? {
        pharmacyId: actor.id,
        pharmacyName: actor.name,
        pharmacyEmail: actor.email,
      } : row.pharmacyId != null ? {
        pharmacyId: row.pharmacyId,
        pharmacyName: null,
        pharmacyEmail: null,
      } : null,
    });
  }

  return stateMap;
}

function compareEntryTimestampDesc(left: NormalizedLogEntry, right: NormalizedLogEntry): number {
  if (left.timestamp > right.timestamp) return -1;
  if (left.timestamp < right.timestamp) return 1;
  return 0;
}

function buildInsightFingerprint(entry: NormalizedLogEntry): string {
  return [
    entry.errorCode ?? 'no-code',
    entry.category,
    entry.codeLocation ?? 'unknown-location',
    entry.source,
  ].join('|');
}

function toNumericCount(value: unknown): number {
  return Number(value ?? 0);
}

function buildLogSummaryResult(params: {
  activityRow: { total?: unknown; today?: unknown } | undefined;
  systemRow: { total?: unknown; today?: unknown; errors?: unknown; warnings?: unknown } | undefined;
  syncRow: { total?: unknown; today?: unknown; failed?: unknown; partial?: unknown } | undefined;
}): LogSummary {
  const activityTotal = toNumericCount(params.activityRow?.total);
  const systemTotal = toNumericCount(params.systemRow?.total);
  const syncTotal = toNumericCount(params.syncRow?.total);
  const total = activityTotal + systemTotal + syncTotal;
  const errors = toNumericCount(params.systemRow?.errors) + toNumericCount(params.syncRow?.failed);
  const warnings = toNumericCount(params.systemRow?.warnings) + toNumericCount(params.syncRow?.partial);
  const today = toNumericCount(params.activityRow?.today) + toNumericCount(params.systemRow?.today) + toNumericCount(params.syncRow?.today);

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
  const pharmacyIds = [...new Set(
    paginated
      .map((entry) => entry.pharmacyId)
      .filter((value): value is number => value != null),
  )];
  const codes = [...new Set(
    paginated
      .map((entry) => entry.errorCode)
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  )];
  const [pharmacyMap, errorCodeMap] = await Promise.all([
    loadPharmacyMap(pharmacyIds),
    loadErrorCodeMap(codes),
  ]);
  const issueStateMap = await loadIssueStateMap(
    paginated.map((entry) => buildLogIssueResourceId(entry.source, entry.id)),
  );
  const enriched = paginated.map((entry) => enrichEntry(entry, pharmacyMap, errorCodeMap, issueStateMap));

  return {
    entries: enriched,
    total,
    page,
    limit,
  };
}

export async function getLogEntryById(source: LogSource, id: number): Promise<NormalizedLogEntry | null> {
  const entry = await querySourceEntryById(source, id);
  if (!entry) return null;

  const pharmacyIds = entry.pharmacyId != null ? [entry.pharmacyId] : [];
  const codes = entry.errorCode ? [entry.errorCode] : [];
  const [pharmacyMap, errorCodeMap] = await Promise.all([
    loadPharmacyMap(pharmacyIds),
    loadErrorCodeMap(codes),
  ]);
  const issueStateMap = await loadIssueStateMap([buildLogIssueResourceId(entry.source, entry.id)]);
  return enrichEntry(entry, pharmacyMap, errorCodeMap, issueStateMap);
}

async function collectLogInsights(query: LogInsightsQuery = {}): Promise<{
  repeatedErrorCount: number;
  impactedTenantCount: number;
  topIssues: LogInsightItem[];
  insightMap: Map<string, LogInsightItem>;
}> {
  const { entries } = await queryLogs({
    ...query,
    page: 1,
    limit: Math.min(query.limit ?? 200, 500),
  });
  const relevantEntries = entries.filter((entry) => entry.level === 'error' || entry.level === 'critical');

  const grouped = new Map<string, {
    sample: NormalizedLogEntry;
    count: number;
    tenantIds: Set<number>;
    latestOccurredAt: string;
  }>();

  for (const entry of relevantEntries) {
    const fingerprint = buildInsightFingerprint(entry);
    const current = grouped.get(fingerprint);
    if (current) {
      current.count += 1;
      if (entry.tenant.pharmacyId != null) current.tenantIds.add(entry.tenant.pharmacyId);
      if (entry.timestamp > current.latestOccurredAt) current.latestOccurredAt = entry.timestamp;
      continue;
    }
    grouped.set(fingerprint, {
      sample: entry,
      count: 1,
      tenantIds: new Set(entry.tenant.pharmacyId != null ? [entry.tenant.pharmacyId] : []),
      latestOccurredAt: entry.timestamp,
    });
  }

  const minOccurrences = Math.max(1, query.minOccurrences ?? 1);
  const topLimit = Math.max(1, Math.min(query.topLimit ?? 10, 50));

  const allIssues = [...grouped.entries()]
    .map(([fingerprint, value]) => ({
      fingerprint,
      level: value.sample.level,
      title: value.sample.whatHappened,
      codeLocation: value.sample.codeLocation,
      errorCode: value.sample.errorCode,
      count: value.count,
      impactedTenantCount: value.tenantIds.size,
      latestOccurredAt: value.latestOccurredAt,
      sampleLogId: value.sample.id,
      source: value.sample.source,
    }))
    .sort((left, right) => {
      if (right.count !== left.count) return right.count - left.count;
      if (right.impactedTenantCount !== left.impactedTenantCount) return right.impactedTenantCount - left.impactedTenantCount;
      return right.latestOccurredAt.localeCompare(left.latestOccurredAt);
    })
    .filter((issue) => issue.count >= minOccurrences);

  const impactedTenantCount = new Set(
    relevantEntries
      .map((entry) => entry.tenant.pharmacyId)
      .filter((value): value is number => value != null),
  ).size;

  return {
    repeatedErrorCount: allIssues.filter((issue) => issue.count > 1).length,
    impactedTenantCount,
    topIssues: allIssues.slice(0, topLimit),
    insightMap: new Map(allIssues.map((issue) => [issue.fingerprint, issue])),
  };
}

export async function getLogInsights(query: LogInsightsQuery = {}): Promise<LogInsightsSummary> {
  const { repeatedErrorCount, impactedTenantCount, topIssues } = await collectLogInsights(query);

  return {
    repeatedErrorCount,
    impactedTenantCount,
    topIssues,
  };
}

export async function getLogInsightForEntry(
  entry: NormalizedLogEntry,
  query: LogInsightsQuery = {},
): Promise<LogInsightItem | null> {
  const { insightMap } = await collectLogInsights(query);
  return insightMap.get(buildInsightFingerprint(entry)) ?? null;
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

  return buildLogSummaryResult({
    activityRow,
    systemRow,
    syncRow,
  });
}
