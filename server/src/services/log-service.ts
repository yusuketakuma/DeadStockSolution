import { db } from '../config/database';
import { activityLogs } from '../db/schema';
import { logger } from './logger';

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
  | 'admin_verify_pharmacy';

export async function writeLog(
  action: LogAction,
  options: {
    pharmacyId?: number | null;
    detail?: string;
    resourceType?: string;
    resourceId?: string | number;
    metadataJson?: string | Record<string, unknown> | null;
    ipAddress?: string;
  } = {},
): Promise<void> {
  try {
    const metadataJson = (() => {
      if (options.metadataJson === undefined || options.metadataJson === null) {
        return null;
      }
      if (typeof options.metadataJson === 'string') {
        return options.metadataJson;
      }
      try {
        return JSON.stringify(options.metadataJson);
      } catch {
        return null;
      }
    })();

    await db.insert(activityLogs).values({
      pharmacyId: options.pharmacyId ?? null,
      action,
      detail: options.detail ?? null,
      resourceType: options.resourceType ?? null,
      resourceId: options.resourceId !== undefined && options.resourceId !== null
        ? String(options.resourceId)
        : null,
      metadataJson,
      ipAddress: options.ipAddress ?? null,
    });
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
