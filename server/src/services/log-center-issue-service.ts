import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { activityLogs } from '../db/schema';
import type { LogSource, LogIssueWorkflowStatus, LogIssueState, LogIssueHistoryEntry } from './log-center-service';
import {
  buildLogIssueResourceId,
  isLogIssueAuditAction,
  extractStatusMetadata,
  parseJsonSafe,
  loadPharmacyMap,
  type ActivityLogRow,
} from './log-center-service';

export async function updateLogIssueState(params: {
  source: LogSource;
  logId: number;
  status: LogIssueWorkflowStatus;
  note?: string | null;
  actorPharmacyId: number;
  actorEmail: string;
}): Promise<LogIssueState> {
  const note = params.note?.trim() ? params.note.trim() : null;
  await db.insert(activityLogs).values({
    pharmacyId: params.actorPharmacyId,
    action: 'admin_log_status_update',
    detail: note ? `status=${params.status} ${note}` : `status=${params.status}`,
    resourceType: 'log_center_issue',
    resourceId: buildLogIssueResourceId(params.source, params.logId),
    metadataJson: JSON.stringify({
      source: params.source,
      logId: params.logId,
      status: params.status,
      note,
      actorEmail: params.actorEmail,
    }),
  });

  return {
    status: params.status,
    note,
    updatedAt: new Date().toISOString(),
    updatedBy: {
      pharmacyId: params.actorPharmacyId,
      pharmacyName: null,
      pharmacyEmail: params.actorEmail,
    },
  };
}

export async function recordLogIssueAutoEscalation(params: {
  source: LogSource;
  logId: number;
  actorPharmacyId?: number | null;
  note?: string | null;
  reasonCodes: string[];
}): Promise<void> {
  await db.insert(activityLogs).values({
    pharmacyId: params.actorPharmacyId ?? null,
    action: 'admin_log_auto_escalated',
    detail: params.note?.trim() || 'auto escalation',
    resourceType: 'log_center_issue',
    resourceId: buildLogIssueResourceId(params.source, params.logId),
    metadataJson: JSON.stringify({
      source: params.source,
      logId: params.logId,
      note: params.note?.trim() || null,
      reasonCodes: params.reasonCodes,
    }),
  });
}

export async function getLogIssueHistory(source: LogSource, logId: number): Promise<LogIssueHistoryEntry[]> {
  const resourceId = buildLogIssueResourceId(source, logId);
  const rows: ActivityLogRow[] = await db
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
      eq(activityLogs.resourceId, resourceId),
      sql`${activityLogs.action} in ('admin_log_status_update', 'admin_log_auto_escalated')`,
    ))
    .orderBy(desc(activityLogs.createdAt), desc(activityLogs.id));

  const actorIds = [...new Set(
    rows
      .map((row) => row.pharmacyId)
      .filter((value): value is number => value != null),
  )];
  const pharmacyMap = await loadPharmacyMap(actorIds);

  return rows
    .filter((row) => isLogIssueAuditAction(row.action))
    .map((row) => {
      const metadata = extractStatusMetadata(parseJsonSafe(row.metadataJson));
      const actor = row.pharmacyId != null ? pharmacyMap.get(row.pharmacyId) : undefined;
      return {
        id: row.id,
        kind: row.action === 'admin_log_auto_escalated' ? 'auto_escalation' : 'status_update',
        source,
        logId,
        status: metadata.status,
        note: metadata.note,
        reasonCodes: metadata.reasonCodes,
        createdAt: row.createdAt ?? '',
        actor: actor ? {
          pharmacyId: actor.id,
          pharmacyName: actor.name,
          pharmacyEmail: actor.email,
        } : row.pharmacyId != null ? {
          pharmacyId: row.pharmacyId,
          pharmacyName: null,
          pharmacyEmail: null,
        } : null,
      };
    });
}
