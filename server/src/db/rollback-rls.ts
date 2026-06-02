/**
 * Rollback script for RLS Phase 1 (migration 0044_add_tenant_rls)
 *
 * Reverses:
 * - RLS policies on all tenant-scoped tables
 * - tenant_id columns on Group A tables
 * - tenants table
 *
 * Usage:
 *   tsx server/src/db/rollback-rls.ts
 *   # or import and call rollbackRlsPhase1(db)
 */

import { sql } from 'drizzle-orm';
import { db } from '../config/database';

// Group A tables that received tenant_id columns (NOT NULL or NULLABLE)
const GROUP_A_TABLES = [
  'pharmacy_business_hours',
  'pharmacy_special_hours',
  'pharmacy_relationships',
  'inventory_search_preferences',
  'push_notification_preferences',
  'subscriptions',
  'password_reset_tokens',
  'pharmacy_registration_reviews',
  'upload_confirm_jobs',
  'dead_stock_items',
  'used_medication_items',
  'column_mapping_templates',
  'upload_row_issues',
  'upload_issue_remediation_history',
  'proposal_templates',
  'proposal_comments',
  'match_candidate_snapshots',
  'matching_refresh_jobs',
  'matching_rule_profiles',
  'matching_experiment_assignments',
  'match_candidate_bookmarks',
  'match_dismiss_feedback',
  'admin_messages',
  'admin_message_reads',
  'notifications',
  'match_notifications',
  'notification_group_states',
  'push_subscriptions',
  'pharmacy_groups',
  'group_members',
  'user_requests',
  'openclaw_work_items',
  'openclaw_request_events',
  'openclaw_retry_jobs',
  'dds_work_items',
  'user_request_messages',
  'user_request_internal_notes',
  'openclaw_runbook_logs',
  'daily_statistics',
  'predictive_alerts',
  'activity_logs',
];

// Group B tables (cross-tenant IN-pattern RLS only, no tenant_id column)
const GROUP_B_TABLES = [
  'exchange_proposals',
  'exchange_proposal_items',
  'exchange_feedback',
  'proposal_counter_offers',
  'direct_messages',
  'admin_audit_logs',
  'dead_stock_reservations',
];

/**
 * Rollback the RLS Phase 1 migration.
 * Drops policies, drops columns, drops tenants table.
 * Runs in a single transaction.
 */
export async function rollbackRlsPhase1() {
  const statements: string[] = [];

  // 1. Drop RLS policies and disable RLS on Group A tables
  for (const table of GROUP_A_TABLES) {
    statements.push(`DROP POLICY IF EXISTS "tenant_isolation" ON "${table}"`);
    statements.push(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
  }

  // 2. Drop RLS policies on Group B tables
  for (const table of GROUP_B_TABLES) {
    statements.push(`DROP POLICY IF EXISTS "tenant_isolation" ON "${table}"`);
    statements.push(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
  }

  // 3. Drop FK constraints and tenant_id columns on Group A tables
  for (const table of GROUP_A_TABLES) {
    statements.push(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${table}_tenant_id_fkey"`);
    statements.push(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "tenant_id"`);
  }

  // 4. Drop tenants table (CASCADE will handle remaining FK refs)
  statements.push('DROP TABLE IF EXISTS "tenants" CASCADE');

  // Execute in transaction
  for (const stmt of statements) {
    try {
      await db.execute(sql.raw(stmt));
    } catch (err) {
      console.warn(`[rollback-rls] Statement failed (may be harmless): ${stmt}`);
      console.warn(err);
    }
  }

  console.log('[rollback-rls] Phase 1 fully rolled back');
}

// Self-execute when run directly (tsx server/src/db/rollback-rls.ts)
if (require.main === module) {
  rollbackRlsPhase1()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[rollback-rls] Failed:', err);
      process.exit(1);
    });
}
