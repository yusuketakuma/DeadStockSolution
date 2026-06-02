/**
 * Debug: Test if generated RLS SQL works in PGlite
 */
import { PGlite } from '@electric-sql/pglite';
import * as fs from 'node:fs';
import * as path from 'node:path';

async function main() {
  const pg = new PGlite();
  
  // First create a simple table like Drizzle would
  await pg.exec(`CREATE TABLE IF NOT EXISTS "pharmacy_business_hours" ("id" SERIAL PRIMARY KEY, "pharmacy_id" INTEGER, "name" TEXT)`);
  
  // Then try the ALTER TABLE from our generated file
  const sql1 = `ALTER TABLE "pharmacy_business_hours" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER`;
  console.log('Executing:', sql1);
  try {
    await pg.exec(sql1);
    console.log('  OK - ADD COLUMN succeeded');
  } catch (e: any) {
    console.log('  FAIL:', e.message?.substring(0, 200));
  }
  
  // Check if column exists
  const r1 = await pg.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'pharmacy_business_hours' AND column_name = 'tenant_id'`);
  console.log(`  Column exists: ${r1.rows.length > 0}`);
  
  // Try FK constraint
  const sql2 = `ALTER TABLE "pharmacy_business_hours" ADD CONSTRAINT "ph_biz_hours_tid_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")`;
  console.log('Executing:', sql2);
  try {
    await pg.exec(sql2);
    console.log('  OK - FK constraint succeeded');
  } catch (e: any) {
    console.log('  FAIL:', e.message?.substring(0, 200));
  }
  
  // Try ENABLE ROW LEVEL SECURITY
  const sql3 = `ALTER TABLE "pharmacy_business_hours" ENABLE ROW LEVEL SECURITY`;
  console.log('Executing:', sql3);
  try {
    await pg.exec(sql3);
    console.log('  OK - ENABLE RLS succeeded');
  } catch (e: any) {
    console.log('  FAIL:', e.message?.substring(0, 200));
  }
  
  // Try CREATE POLICY
  const sql4 = `CREATE POLICY "tenant_isolation" ON "pharmacy_business_hours" FOR ALL TO "public" USING ("tenant_id" = current_setting('app.tenant_id')::int) WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int)`;
  console.log('Executing:', sql4);
  try {
    await pg.exec(sql4);
    console.log('  OK - CREATE POLICY succeeded');
  } catch (e: any) {
    console.log('  FAIL:', e.message?.substring(0, 200));
  }
  
  // Check RLS enabled
  const r2 = await pg.query(`SELECT relname, relrowsecurity FROM pg_class WHERE relname = 'pharmacy_business_hours'`);
  console.log(`  RLS enabled: ${r2.rows.length > 0 ? r2.rows[0].relrowsecurity : 'table not found'}`);
  
  await pg.close();
  console.log('\nDONE');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
