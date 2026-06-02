import { PGlite } from '@electric-sql/pglite';

async function main() {
  const pg = new PGlite();

  // LOCAL scope (true parameter)
  await pg.exec("SELECT set_config('app.tenant_id', '42', true)");
  const r = await pg.query("SELECT current_setting('app.tenant_id') AS val");
  console.log('LOCAL scope after set_config:', JSON.stringify(r.rows));

  await pg.exec("CREATE ROLE test_user WITH LOGIN");
  await pg.exec("SET ROLE test_user");
  const r2 = await pg.query("SELECT current_setting('app.tenant_id') AS val");
  console.log('LOCAL scope after SET ROLE:', JSON.stringify(r2.rows));

  await pg.exec("RESET ROLE");
  const r3 = await pg.query("SELECT current_setting('app.tenant_id') AS val");
  console.log('LOCAL scope after RESET ROLE:', JSON.stringify(r3.rows));

  await pg.close();
}

main().catch(e => {
  console.error('FAILED:', e);
  process.exit(1);
});
