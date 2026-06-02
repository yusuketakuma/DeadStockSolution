import { sql } from 'drizzle-orm';
import { type TestDb } from './test-db';

/**
 * Role name used for RLS test isolation.
 * Non-superuser role — RLS policies apply.
 */
export const TEST_TENANT_ROLE = 'test_tenant_role';

/**
 * Set up a non-superuser role and grant permissions across the schema.
 * Must be called once before tests.
 */
export async function createTenantRole(db: TestDb): Promise<void> {
  // Drop first in case of re-runs
  await db.execute(sql.raw(`DROP ROLE IF EXISTS ${TEST_TENANT_ROLE}`));

  // Add tenant_id columns and enable RLS on test tables
  // (these columns are defined in the migration SQL, not in Drizzle schema)
  const tablesToAddTenantId = [
    'pharmacy_business_hours',
    'admin_messages',
    'upload_confirm_jobs',
    'dead_stock_items',
  ];
  for (const tableName of tablesToAddTenantId) {
    await db.execute(sql.raw(
      `ALTER TABLE "${tableName}" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER`
    ));
    await db.execute(sql.raw(
      `ALTER TABLE "${tableName}" ENABLE ROW LEVEL SECURITY`
    ));
    // Drop existing policy first, then create
    await db.execute(sql.raw(
      `DROP POLICY IF EXISTS "tenant_isolation" ON "${tableName}"`
    ));
    await db.execute(sql.raw(
      `CREATE POLICY "tenant_isolation" ON "${tableName}" FOR ALL TO "public" `
      + `USING ("tenant_id" = current_setting('app.tenant_id')::int) `
      + `WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int)`
    ));
  }

  // Group B tables (cross-tenant visibility via pharmacy ID columns)
  const groupBTables = ['exchange_proposals'];
  for (const tableName of groupBTables) {
    await db.execute(sql.raw(
      `ALTER TABLE "${tableName}" ENABLE ROW LEVEL SECURITY`
    ));
    await db.execute(sql.raw(
      `DROP POLICY IF EXISTS "tenant_isolation" ON "${tableName}"`
    ));
    // For exchange_proposals, tenant = pharmacy_a_id OR pharmacy_b_id
    await db.execute(sql.raw(
      `CREATE POLICY "tenant_isolation" ON "${tableName}" FOR ALL TO "public" `
      + `USING (current_setting('app.tenant_id')::int IN ("pharmacy_a_id", "pharmacy_b_id")) `
      + `WITH CHECK (current_setting('app.tenant_id')::int IN ("pharmacy_a_id", "pharmacy_b_id"))`
    ));
  }

  await db.execute(sql.raw(`CREATE ROLE ${TEST_TENANT_ROLE} WITH LOGIN`));
  await db.execute(sql.raw(`GRANT USAGE ON SCHEMA public TO ${TEST_TENANT_ROLE}`));
  await db.execute(sql.raw(`GRANT ALL ON ALL TABLES IN SCHEMA public TO ${TEST_TENANT_ROLE}`));
  await db.execute(sql.raw(`GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO ${TEST_TENANT_ROLE}`));
}

/**
 * Drop the tenant role after tests.
 */
export async function dropTenantRole(db: TestDb | undefined): Promise<void> {
  if (!db) return;
  try {
    await db.execute(sql.raw(`REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${TEST_TENANT_ROLE}`));
    await db.execute(sql.raw(`REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${TEST_TENANT_ROLE}`));
    await db.execute(sql.raw(`REVOKE USAGE ON SCHEMA public FROM ${TEST_TENANT_ROLE}`));
  } catch {
    // Role may not exist yet, that's fine
  }
  try {
    await db.execute(sql`DROP OWNED BY ${sql.raw(TEST_TENANT_ROLE)} CASCADE`);
  } catch {
    // Nothing owned, proceed
  }
  await db.execute(sql.raw(`DROP ROLE IF EXISTS ${TEST_TENANT_ROLE}`));
}

/**
 * Set the tenant context (app.tenant_id) and switch to the tenant role.
 * After this call, all queries run as the tenant role with RLS enforced.
 * Call resetTenantContext() to return to superuser.
 */
export async function setTenantContext(
  db: TestDb,
  tenantId: number,
): Promise<void> {
  await db.execute(
    sql`SELECT set_config('app.tenant_id', ${String(tenantId)}, false)`,
  );
  await db.execute(sql.raw(`SET ROLE ${TEST_TENANT_ROLE}`));
}

/**
 * Reset tenant context — return to superuser (no RLS enforcement).
 */
export async function resetTenantContext(db: TestDb): Promise<void> {
  await db.execute(sql`RESET ROLE`);
}

/**
 * Run a callback as a specific tenant with RLS enforced.
 * Usage:
 *   await runAsTenant(db, 1, async () => {
 *     const rows = await db.select().from(deadStockItems);
 *   });
 */
export async function runAsTenant<T>(
  db: TestDb,
  tenantId: number,
  fn: () => Promise<T>,
): Promise<T> {
  await setTenantContext(db, tenantId);
  try {
    return await fn();
  } finally {
    await resetTenantContext(db);
  }
}
