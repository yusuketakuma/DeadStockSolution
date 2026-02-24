import { db } from '../config/database';
import { activityLogs } from '../db/schema';

export type LogAction =
  | 'login'
  | 'login_failed'
  | 'admin_login'
  | 'test_login'
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
  | 'drug_master_edit';

export async function writeLog(
  action: LogAction,
  options: {
    pharmacyId?: number | null;
    detail?: string;
    ipAddress?: string;
  } = {},
): Promise<void> {
  try {
    await db.insert(activityLogs).values({
      pharmacyId: options.pharmacyId ?? null,
      action,
      detail: options.detail ?? null,
      ipAddress: options.ipAddress ?? null,
    });
  } catch (err) {
    // Logging should never break the main flow
    console.error('Failed to write activity log:', err);
  }
}

export function getClientIp(req: { ip?: string; headers: Record<string, string | string[] | undefined> }): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.ip ?? 'unknown';
}
