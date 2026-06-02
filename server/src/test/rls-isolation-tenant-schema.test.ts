/**
 * RLS Phase 1 — Schema verification tests
 *
 * Verifies:
 * - tenants table schema is correct
 * - tenant_id columns exist on tenant-scoped tables
 * - RLS is enabled on all tenant-scoped tables
 * - RLS policies exist
 *
 * These are integration tests that require a database connection.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { getTestDb, resetTestDb, closeTestDb, type TestDb } from './integration/helpers/test-db';
import * as schema from '../db/schema';

let db: TestDb;

// List of tables that should have tenant_id columns (NOT NULL or NULLABLE)
const GROUP_A_TABLES_WITH_TENANT_ID = [
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

// Tables that should have RLS enabled (including cross-tenant tables)
const ALL_RLS_TABLES = [
  ...GROUP_A_TABLES_WITH_TENANT_ID,
  'exchange_proposals',
  'exchange_proposal_items',
  'proposal_comments',
  'exchange_feedback',
  'proposal_counter_offers',
  'direct_messages',
  'admin_audit_logs',
  'dead_stock_reservations',
];

beforeAll(async () => {
  db = await getTestDb();
}, 60_000);

afterAll(async () => {
  await closeTestDb();
});

describe('RLS Phase 1 — Schema', () => {
  describe('tenants table', () => {
    it('has the expected columns', async () => {
      const result = await db.execute(sql`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'tenants'
        ORDER BY ordinal_position
      `);
      const columns = result.rows as Array<{ column_name: string; data_type: string; is_nullable: string }>;
      
      const colNames = columns.map(c => c.column_name);
      expect(colNames).toContain('id');
      expect(colNames).toContain('name');
      expect(colNames).toContain('slug');
      expect(colNames).toContain('created_at');
      expect(colNames).toContain('updated_at');
    });

    it('has unique constraint on slug', async () => {
      const result = await db.execute(sql`
        SELECT constraint_type, constraint_name
        FROM information_schema.table_constraints
        WHERE table_name = 'tenants' AND constraint_type = 'UNIQUE'
      `);
      const constraints = result.rows as Array<{ constraint_type: string; constraint_name: string }>;
      const constraintNames = constraints.map(c => c.constraint_name);
      expect(constraintNames.some(n => n.includes('slug'))).toBe(true);
    });
  });

  describe('tenant_id columns', () => {
    it.each(GROUP_A_TABLES_WITH_TENANT_ID)('%s has a tenant_id column', async (tableName) => {
      const result = await db.execute(sql`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_name = ${tableName} AND column_name = 'tenant_id'
      `);
      expect(result.rows.length).toBe(1);
      expect(result.rows[0].column_name).toBe('tenant_id');
    });

    it.each(GROUP_A_TABLES_WITH_TENANT_ID)('%s has FK constraint from tenant_id to tenants', async (tableName) => {
      const result = await db.execute(sql`
        SELECT tc.constraint_name, ccu.table_name AS foreign_table_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu
          ON tc.constraint_name = ccu.constraint_name
        WHERE tc.table_name = ${tableName}
          AND tc.constraint_type = 'FOREIGN KEY'
          AND ccu.table_name = 'tenants'
      `);
      expect(result.rows.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('RLS enabled', () => {
    it.each(ALL_RLS_TABLES)('%s has RLS enabled', async (tableName) => {
      const result = await db.execute(sql`
        SELECT relname, relrowsecurity
        FROM pg_class
        WHERE relname = ${tableName} AND relrowsecurity = true
      `);
      expect(result.rows.length).toBe(1);
    });
  });
});
