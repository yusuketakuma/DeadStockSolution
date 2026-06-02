import { PGlite } from '@electric-sql/pglite';

async function main() {
  const pg = new PGlite();

  // Test 1: set_config + current_setting
  await pg.exec("SELECT set_config('app.tenant_id', '42', false)");
  const r = await pg.query("SELECT current_setting('app.tenant_id') AS val");
  console.log('Test 1 — set_config + current_setting:', JSON.stringify(r.rows));

  // Test 2: with SET ROLE
  await pg.exec("CREATE ROLE test_user WITH LOGIN");
  await pg.exec("SET ROLE test_user");
  const r2 = await pg.query("SELECT current_setting('app.tenant_id') AS val");
  console.log('Test 2 — After SET ROLE:', JSON.stringify(r2.rows));

  // Test 3: RESET ROLE and check again
  await pg.exec("RESET ROLE");
  const r3 = await pg.query("SELECT current_setting('app.tenant_id') AS val");
  console.log('Test 3 — After RESET ROLE:', JSON.stringify(r3.rows));

  await pg.close();
  console.log('ALL TESTS PASSED');
}

main().catch(e => {
  console.error('FAILED:', e);
  process.exit(1);
});
