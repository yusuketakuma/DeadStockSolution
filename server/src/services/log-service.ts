import { db } from '../config/database';
import { events } from '../db/schema';
import { logger } from './logger';
import { dispatchLogAlert } from './openclaw-log-push-service';
import { getLogEntryById, getLogInsightForEntry } from './log-center-service';
import { recordLogIssueAutoEscalation } from './log-center-issue-service';

export type LogAction =
  | 'login'
  | 'login_failed'
  | 'admin_login'
  | 'register'
  | 'logout'
  | 'upload'
  | 'proposal_create'
  | 'proposal_accept'
  | 'proposal_reject'
  | 'proposal_complete'
  | 'account_update'
  | 'account_deactivate'
  | 'admin_toggle_active'
  | 'admin_send_message'
  | 'dead_stock_delete'
  | 'password_reset_request'
  | 'password_reset_complete'
  | 'password_reset_failed'
  | 'drug_master_sync'
  | 'drug_master_package_upload'
  | 'drug_master_edit'
  | 'admin_verify_pharmacy'
  | 'admin_bulk_verify'
  | 'admin_bulk_reject'
  | 'admin_bulk_activate'
  | 'admin_bulk_deactivate'
  | 'admin_csv_export'
  | 'proposal_expired'
  | 'proposal_expiry_reminder';

export async function writeLog(
  action: LogAction,
  options: {
    pharmacyId?: number | null;
    detail?: string;
    resourceType?: string;
    resourceId?: string | number;
    metadataJson?: string | Record<string, unknown> | null;
    ipAddress?: string;
    errorCode?: string;
  } = {},
): Promise<void> {
  try {
    const metadataJson = (() => {
      if (options.metadataJson === undefined || options.metadataJson === null) {
        return null;
      }
      if (typeof options.metadataJson === 'string') {
        try {
          return JSON.parse(options.metadataJson) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
      // Validate serializable (catch circular refs)
      try {
        JSON.stringify(options.metadataJson);
        return options.metadataJson;
      } catch {
        return null;
      }
    })();

    const occurredAt = new Date().toISOString();
    const [inserted] = await db.insert(events).values({
      pharmacyId: options.pharmacyId ?? null,
      action,
      detail: options.detail ?? null,
      resourceType: options.resourceType ?? null,
      resourceId: options.resourceId !== undefined && options.resourceId !== null
        ? String(options.resourceId)
        : null,
      metadataJson,
      ipAddress: options.ipAddress ?? null,
      errorCode: options.errorCode ?? null,
      createdAt: occurredAt,
    }).returning({ id: events.id });

    // Forward failures to OpenClaw
    const isFailure = options.detail?.startsWith('失敗|') ?? false;
    const isFailedAction = action === 'login_failed' || action === 'password_reset_failed';
    if (isFailure || isFailedAction) {
      try {
        const entry = inserted?.id ? await getLogEntryById('activity_logs', inserted.id) : null;
        const insight = entry ? await getLogInsightForEntry(entry) : null;
        const result = await dispatchLogAlert({
          source: 'activity_logs',
          severity: isFailure ? 'error' : 'warning',
          errorCode: entry?.errorCode ?? options.errorCode ?? null,
          message: entry?.message ?? `[${action}] ${options.detail ?? ''}`.trim(),
          logId: inserted?.id ?? 0,
          occurredAt: entry?.timestamp ?? occurredAt,
          detail: entry?.detail ?? metadataJson,
          codeLocation: entry?.codeLocation ?? null,
          tenant: entry ? {
            pharmacyId: entry.tenant.pharmacyId,
            pharmacyName: entry.tenant.pharmacyName,
            pharmacyEmail: entry.tenant.pharmacyEmail,
          } : undefined,
          whatHappened: entry?.whatHappened ?? null,
          improvementSuggestion: entry?.improvementSuggestion ?? null,
          recurrenceCount: insight?.count,
          impactedTenantCount: insight?.impactedTenantCount,
        });
        if (result.mode === 'auto_escalated' && inserted?.id) {
          await recordLogIssueAutoEscalation({
            source: 'activity_logs',
            logId: inserted.id,
            actorPharmacyId: options.pharmacyId ?? null,
            reasonCodes: result.reasonCodes,
            note: 'activity log auto escalation',
          });
        }
      } catch {
        // Log push should never break the main flow
      }
    }
  } catch (err) {
    // Logging should never break the main flow
    logger.error('Failed to write activity log', {
      action,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function getClientIp(req: { ip?: string }): string {
  // Rely on Express trust proxy setting for correct client IP via req.ip
  return req.ip ?? 'unknown';
}
