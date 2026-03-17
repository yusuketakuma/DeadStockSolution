import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../config/database';
import { events, pharmacies } from '../db/schema';
import {
  LOG_ISSUE_WORKFLOW_STATUSES,
  LOG_SOURCES,
  type LogIssueState,
  type LogIssueWorkflowStatus,
  type LogSource,
  parseJsonSafe,
} from './log-center-filter-service';

type PharmacyRow = Pick<typeof pharmacies.$inferSelect, 'id' | 'name' | 'email'>;
export type ActivityLogRow = Pick<typeof events.$inferSelect, 'id' | 'pharmacyId' | 'action' | 'resourceId' | 'metadataJson' | 'createdAt'>;

export function buildLogIssueResourceId(source: LogSource, logId: number): string {
  return `${source}:${logId}`;
}

export function parseLogIssueResourceId(resourceId: string | null | undefined): { source: LogSource; logId: number } | null {
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
  const record = typeof detail === 'object' && detail !== null
    ? (detail as Record<string, unknown>)
    : {};
  const status = isWorkflowStatus(record.status) ? record.status : null;
  const note = typeof record.note === 'string' && record.note.trim().length > 0
    ? record.note
    : null;
  const reasonCodesValue = record.reasonCodes;
  const reasonCodes = Array.isArray(reasonCodesValue)
    ? reasonCodesValue.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : [];
  return { status, note, reasonCodes };
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

export async function loadIssueStateMap(resourceIds: string[]): Promise<Map<string, LogIssueState>> {
  if (resourceIds.length === 0) return new Map();
  const rows = await db
    .select({
      id: events.id,
      pharmacyId: events.pharmacyId,
      action: events.action,
      resourceId: events.resourceId,
      metadataJson: events.metadataJson,
      createdAt: events.createdAt,
    })
    .from(events)
    .where(and(
      eq(events.resourceType, 'log_center_issue'),
      eq(events.action, 'admin_log_status_update'),
      inArray(events.resourceId, resourceIds),
    ))
    .orderBy(desc(events.createdAt), desc(events.id));

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
