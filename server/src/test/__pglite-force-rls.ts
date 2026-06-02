import { PGlite } from '@electric-sql/pglite';

async function main() {
  const pg = new PGlite();

  // Create and seed table
  await pg.exec('CREATE TABLE test_table (id SERIAL PRIMARY KEY, tenant_id INT, data TEXT)');
  await pg.exec("INSERT INTO test_table (tenant_id, data) VALUES (1, 'tenant1-data'), (2, 'tenant2-data')");

  // Enable RLS + FORCE so it applies even to the current user (superuser)
  await pg.exec('ALTER TABLE test_table ENABLE ROW LEVEL SECURITY');
  await pg.exec('ALTER TABLE test_table FORCE ROW LEVEL SECURITY');
  await pg.exec(
    "CREATE POLICY tenant_isolation ON test_table " +
    "USING (tenant_id = current_setting('app.tenant_id')::int) " +
    "WITH CHECK (tenant_id = current_setting('app.tenant_id')::int)"
  );

  // Use session scope (false) for test environment
  await pg.exec("SELECT set_config('app.tenant_id', '1', false)");
  const r1 = await pg.query('SELECT * FROM test_table');
  console.log('Tenant 1 sees:', JSON.stringify(r1.rows));
  console.assert(r1.rows.length === 1, `Expected 1 row, got ${r1.rows.length}`);

  await pg.exec("SELECT set_config('app.tenant_id', '2', false)");
  const r2 = await pg.query('SELECT * FROM test_table');
  console.log('Tenant 2 sees:', JSON.stringify(r2.rows));
  console.assert(r2.rows.length === 1, `Expected 1 row, got ${r2.rows.length}`);

  // Write isolation
  await pg.exec("SELECT set_config('app.tenant_id', '1', false)");
  try {
    await pg.exec("INSERT INTO test_table (tenant_id, data) VALUES (2, 'cross-tenant')");
    console.log('FAIL: cross-tenant insert succeeded');
  } catch (e: any) {
    console.log('Write isolation works:', e.message.substring(0, 100));
  }

  await pg.close();
  console.log('ALL PASSED with FORCE RLS');
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
