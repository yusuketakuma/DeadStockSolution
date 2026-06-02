import { PGlite } from '@electric-sql/pglite';

async function main() {
  const pg = new PGlite();

  await pg.exec('CREATE TABLE test_table (id SERIAL PRIMARY KEY, tenant_id INT, data TEXT)');
  await pg.exec("INSERT INTO test_table (tenant_id, data) VALUES (1, 't1-data'), (2, 't2-data')");

  // Apply RLS
  await pg.exec('ALTER TABLE test_table ENABLE ROW LEVEL SECURITY');
  await pg.exec('ALTER TABLE test_table FORCE ROW LEVEL SECURITY');

  // Check if policy was created
  const policies = await pg.query("SELECT * FROM pg_policies WHERE tablename = 'test_table'");
  console.log('Policies before create:', JSON.stringify(policies.rows));

  await pg.exec(
    "CREATE POLICY tenant_isolation ON test_table " +
    "USING (tenant_id = current_setting('app.tenant_id')::int) " +
    "WITH CHECK (tenant_id = current_setting('app.tenant_id')::int)"
  );

  const policies2 = await pg.query("SELECT * FROM pg_policies WHERE tablename = 'test_table'");
  console.log('Policies after create:', JSON.stringify(policies2.rows));

  // Check RLS enabled
  const rlsStatus = await pg.query(
    "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'test_table'"
  );
  console.log('RLS status:', JSON.stringify(rlsStatus.rows));

  // Check current role
  const role = await pg.query("SELECT current_user, session_user");
  console.log('Current user:', JSON.stringify(role.rows));

  await pg.close();
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
