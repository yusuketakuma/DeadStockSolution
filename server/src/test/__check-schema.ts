import { getTestDb, closeTestDb } from './integration/helpers/test-db';
import * as schema from '../db/schema';
import { sql } from 'drizzle-orm';

async function main() {
  const db = await getTestDb();

  // Check if tenants table was created
  const tables = await db.execute(sql`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
  `);
  console.log('Tables created:', tables.rows.map((r: any) => r.tablename).join(', '));

  // Insert tenants
  const [tenant1] = await db.insert(schema.tenants).values({ name: 'Tenant 1', slug: 'tenant-1' }).returning();
  const [tenant2] = await db.insert(schema.tenants).values({ name: 'Tenant 2', slug: 'tenant-2' }).returning();
  console.log('Tenants:', { tenant1, tenant2 });

  // Check RLS status on dead_stock_items
  const rlsStatus = await db.execute(sql`
    SELECT relname, relrowsecurity, relforcerowsecurity
    FROM pg_class
    WHERE relname IN ('dead_stock_items', 'pharmacy_business_hours', 'exchange_proposals')
    ORDER BY relname
  `);
  console.log('RLS status:', JSON.stringify(rlsStatus.rows));

  // Check policies
  const policies = await db.execute(sql`
    SELECT tablename, policyname, roles, cmd, qual
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname
  `);
  console.log('Policies:', JSON.stringify(policies.rows));

  // Test with non-superuser role
  await db.execute(sql`CREATE ROLE test_tenant WITH LOGIN`);
  // Grant permissions on all tables in the schema
  const allTables = await db.execute(sql`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `);
  for (const row of allTables.rows as any[]) {
    await db.execute(sql.raw(`GRANT ALL ON "${row.tablename}" TO test_tenant`));
    // Also grant sequence usage
    await db.execute(sql.raw(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO test_tenant`));
  }
  // Grant schema usage
  await db.execute(sql`GRANT USAGE ON SCHEMA public TO test_tenant`);

  // Now test RLS with SET ROLE
  // First, seed some data
  const [pharmacy1] = await db.insert(schema.pharmacies).values({
    email: 'p1@test.com', name: 'Pharmacy 1', postalCode: '100-0001',
    address: 'Test 1', phone: '03-1111-1111', fax: '03-1111-1112',
    licenseNumber: 'L000001', prefecture: 'Tokyo', verificationStatus: 'verified',
    tenantId: tenant1.id,
  }).returning();

  const [pharmacy2] = await db.insert(schema.pharmacies).values({
    email: 'p2@test.com', name: 'Pharmacy 2', postalCode: '100-0002',
    address: 'Test 2', phone: '03-2222-2221', fax: '03-2222-2222',
    licenseNumber: 'L000002', prefecture: 'Osaka', verificationStatus: 'verified',
    tenantId: tenant2.id,
  }).returning();

  // Insert dead stock for both pharmacies
  const seqRes = await db.execute(sql`SELECT nextval('dead_stock_items_id_seq'::regclass) AS id`);
  await db.insert(schema.uploadJobs).values({
    pharmacyId: pharmacy1.id, uploadType: 'dead_stock', originalFilename: 't1.csv',
    fileHash: 'h1', headerRowIndex: 0, mappingJson: {}, fileBase64: '', status: 'completed',
    tenantId: tenant1.id,
  }).returning();
  // actually let me just use raw SQL for dead stock
  // ... this is getting complex

  await closeTestDb();
  console.log('Schema verification done');
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
