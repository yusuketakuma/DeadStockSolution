/**
 * Debug: Test the generated SQL file against PGlite
 */
import { PGlite } from '@electric-sql/pglite';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import * as schema from '../../../db/schema';
import * as fs from 'node:fs';
import * as path from 'node:path';

async function main() {
  const pg = new PGlite();
  
  // Step 1: Apply Drizzle schema like test-db.ts does
  console.log('=== Step 1: Drizzle schema push ===');
  const currentSnapshot = generateDrizzleJson(schema as any);
  const ddlStatements = await generateMigration(generateDrizzleJson({}), currentSnapshot);
  let stmtCount = 0;
  for (const statement of ddlStatements) {
    await pg.exec(statement);
    stmtCount++;
  }
  console.log(`  Applied ${stmtCount} DDL statements from Drizzle schema`);
  
  // Step 2: Load our generated SQL file
  console.log('\n=== Step 2: Load RLS SQL ===');
  const sqlPath = path.join(__dirname, 'apply-rls-all-tables.sql');
  const migrationSql = fs.readFileSync(sqlPath, 'utf-8');
  const statements = migrationSql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));
  
  let okCount = 0, failCount = 0;
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    try {
      await pg.exec(stmt + ';');
      okCount++;
    } catch (err: any) {
      failCount++;
      if (failCount <= 3) {
        console.log(`  FAIL [${i}]: ${err.message?.substring(0, 150)}`);
        console.log(`    SQL: ${stmt.substring(0, 100)}...`);
      }
    }
  }
  console.log(`  SQL statements: ${okCount} OK, ${failCount} failed`);
  
  // Step 3: Check pharmacy_business_hours for tenant_id
  console.log('\n=== Step 3: Schema check ===');
  const r1 = await pg.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'pharmacy_business_hours' AND column_name = 'tenant_id'`);
  console.log(`  pharmacy_business_hours.tenant_id exists: ${r1.rows.length > 0}`);
  
  const r2 = await pg.query(`SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'pharmacy_business_hours'`);
  console.log(`  pharmacy_business_hours RLS enabled: ${r2.rows.length > 0 ? r2.rows[0].relrowsecurity : 'N/A'}`);
  
  // Check a few more tables
  for (const tbl of ['admin_messages', 'dead_stock_items', 'exchange_proposals']) {
    const rc = await pg.query(`SELECT column_name FROM information_schema.columns WHERE table_name = '${tbl}' AND column_name = 'tenant_id'`);
    const rr = await pg.query(`SELECT relrowsecurity FROM pg_class WHERE relname = '${tbl}'`);
    console.log(`  ${tbl}: tenant_id=${rc.rows.length > 0}, RLS=${rr.rows.length > 0 ? rr.rows[0].relrowsecurity : 'N/A'}`);
  }
  
  await pg.close();
  console.log('\nDONE');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
