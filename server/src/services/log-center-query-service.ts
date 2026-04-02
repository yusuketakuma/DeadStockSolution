import { db } from '../config/database';
import { events, drugMasterSyncLogs, errorCodes, systemEvents } from '../db/schema';
import { count, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  type LogCenterQuery,
  type LogInsightItem,
  type LogInsightsQuery,
  type LogInsightsSummary,
  type LogSource,
  type LogSummary,
  type NormalizedLogEntry,
  buildInsightFingerprint,
  buildLogSummaryResult,
  buildSourceConditions,
  mergeEntriesForPage,
  mergeTenantLabel,
  normalizeLogEntry,
  toUnknownRecord,
} from './log-center-filter-service';
import {
  buildLogIssueResourceId,
  loadIssueStateMap,
  loadPharmacyMap,
} from './log-center-issue-workflow-service';

type ErrorCodeRow = typeof errorCodes.$inferSelect;

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
  const { config } = buildSourceConditions(source, {});
  const [row] = await db
    .select()
    .from(config.table)
    .where(eq(config.idCol, id))
    .limit(1);

  if (!row) return null;
  return normalizeLogEntry(source, toUnknownRecord(row));
}

async function countSourceTable(source: LogSource, query: LogCenterQuery): Promise<number> {
  const { config, where } = buildSourceConditions(source, query);
  const [row] = await db
    .select({ cnt: count() })
    .from(config.table)
    .where(where);
  return Number(row?.cnt ?? 0);
}

async function loadErrorCodeMap(codes: string[]): Promise<Map<string, ErrorCodeRow>> {
  if (codes.length === 0) return new Map();
  const rows = await db
    .select()
    .from(errorCodes)
    .where(inArray(errorCodes.code, codes));
  return new Map(rows.map((row) => [row.code, row]));
}

function enrichEntry(
  entry: NormalizedLogEntry,
  pharmacyMap: Map<number, { id: number; name: string; email: string }>,
  errorCodeMap: Map<string, ErrorCodeRow>,
  issueStateMap: Map<string, import('./log-center-filter-service').LogIssueState>,
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

export async function queryLogs(query: LogCenterQuery): Promise<{
  entries: NormalizedLogEntry[];
  total: number;
  page: number;
  limit: number;
}> {
  const sources = query.sources ?? ['activity_logs', 'system_events', 'drug_master_sync_logs'];
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.max(1, query.limit ?? 50);
  const offset = (page - 1) * limit;
  const requiredRows = offset + limit;

  const countPromises = sources.map((source) => countSourceTable(source, query));
  const counts = await Promise.all(countPromises);
  const total = counts.reduce((sum, c) => sum + c, 0);

  const dataPromises = sources.map((source, index) => {
    const fetchLimit = Math.min(counts[index], requiredRows);
    if (fetchLimit <= 0) return Promise.resolve([] as NormalizedLogEntry[]);
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

export async function getLogSummary(): Promise<LogSummary> {
  // JST (Asia/Tokyo) の深夜0時を基準にする（サーバーTZに依存しない）
  const now = new Date();
  const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const jstDateStr = jstNow.toISOString().split('T')[0]; // YYYY-MM-DD in JST
  const todayStr = new Date(jstDateStr + 'T00:00:00+09:00').toISOString();

  const [activityRow, systemRow, syncRow] = await Promise.all([
    db.select({
      total: count(),
      today: sql<number>`count(*) filter (where ${events.createdAt} >= ${todayStr})`,
    }).from(events).then((r) => r[0]),
    db.select({
      total: count(),
      today: sql<number>`count(*) filter (where ${systemEvents.occurredAt} >= ${todayStr})`,
      errors: sql<number>`count(*) filter (where ${systemEvents.level} = 'error')`,
      warnings: sql<number>`count(*) filter (where ${systemEvents.level} = 'warning')`,
    }).from(systemEvents).then((r) => r[0]),
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
