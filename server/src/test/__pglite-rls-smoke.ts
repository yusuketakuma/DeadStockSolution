import { PGlite } from '@electric-sql/pglite';

async function main() {
  const pg = new PGlite();

  // Create table
  await pg.exec('CREATE TABLE test_table (id SERIAL PRIMARY KEY, tenant_id INT, data TEXT)');
  await pg.exec("INSERT INTO test_table (tenant_id, data) VALUES (1, 'tenant1-data'), (2, 'tenant2-data')");

  // Create role + grant
  await pg.exec("CREATE ROLE test_user WITH LOGIN");
  await pg.exec("GRANT ALL ON test_table TO test_user");
  await pg.exec("GRANT USAGE ON SCHEMA public TO test_user");

  // Enable RLS + policy targeting test_user
  await pg.exec('ALTER TABLE test_table ENABLE ROW LEVEL SECURITY');
  await pg.exec(
    "CREATE POLICY tenant_isolation ON test_table " +
    "FOR ALL " +
    "TO test_user " +
    "USING (tenant_id = current_setting('app.tenant_id')::int) " +
    "WITH CHECK (tenant_id = current_setting('app.tenant_id')::int)"
  );

  // Set context BEFORE switching role
  await pg.exec("SELECT set_config('app.tenant_id', '1', true)");
  await pg.exec("SET ROLE test_user");
  const r1 = await pg.query('SELECT * FROM test_table');
  console.log('Tenant 1 sees:', JSON.stringify(r1.rows));
  console.assert(r1.rows.length === 1, `Expected 1 row, got ${r1.rows.length}`);
  console.assert(r1.rows[0].tenant_id === 1, 'Wrong tenant');

  // Switch context
  await pg.exec("RESET ROLE");
  await pg.exec("SELECT set_config('app.tenant_id', '2', true)");
  await pg.exec("SET ROLE test_user");
  const r2 = await pg.query('SELECT * FROM test_table');
  console.log('Tenant 2 sees:', JSON.stringify(r2.rows));
  console.assert(r2.rows.length === 1, `Expected 1 row, got ${r2.rows.length}`);
  console.assert(r2.rows[0].tenant_id === 2, 'Wrong tenant');

  await pg.close();
  console.log('BASIC RLS WORKS');
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
