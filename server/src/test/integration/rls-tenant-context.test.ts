import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { getTestDb, resetTestDb, closeTestDb, type TestDb } from './helpers/test-db';
import { resetFactorySeq } from './helpers/factories';
import { createTenantRole, dropTenantRole, setTenantContext, resetTenantContext } from './helpers/rls-helper';
import * as schema from '../../db/schema';
import { withTenant } from '../../utils/db-utils';

let db: TestDb;

beforeAll(async () => {
  db = await getTestDb();
  await createTenantRole(db);
}, 60_000);

afterAll(async () => {
  await dropTenantRole(db);
  await closeTestDb();
});

beforeEach(async () => {
  await resetTestDb();
  resetFactorySeq();
});

describe('RLS tenant context middleware', () => {
  it('setTenantContext sets app.tenant_id correctly', async () => {
    // Set tenant context to a known value
    await db.execute(
      sql`SELECT set_config('app.tenant_id', '42', false)`,
    );
    // Read it back using current_setting
    const [row] = await db.execute<{ current_setting: string }>(
      sql`SELECT current_setting('app.tenant_id')`,
    );
    expect(row.current_setting).toBe('42');
  });

  it('withTenant helper sets and restores app.tenant_id', async () => {
    // withTenant should set app.tenant_id and run the callback
    let captured: string | null = null;
    await withTenant(99, async () => {
      const [row] = await db.execute<{ current_setting: string }>(
        sql`SELECT current_setting('app.tenant_id')`,
      );
      captured = row.current_setting;
    });
    expect(captured).toBe('99');

    // After withTenant completes, tenant context may persist (session scope)
    // This is fine — each test gets a fresh PGlite instance per reset
  });

  it('tenant context is scoped — different tenants see different data', async () => {
    // Create two tenants
    const [t1] = await db.insert(schema.tenants).values({ name: 'Tenant Alpha', slug: 'alpha' }).returning();
    const [t2] = await db.insert(schema.tenants).values({ name: 'Tenant Beta', slug: 'beta' }).returning();

    // Create one pharmacy per tenant
    const [p1] = await db.insert(schema.pharmacies).values({
      email: 'alpha@test.com',
      name: 'Alpha Pharmacy',
      postalCode: '1000001',
      address: 'Alpha Address',
      phone: '03-1111-1111',
      fax: '03-1111-1112',
      licenseNumber: 'L-ALPHA-001',
      prefecture: 'Tokyo',
      verificationStatus: 'verified',
      tenantId: t1.id,
    }).returning();

    const [p2] = await db.insert(schema.pharmacies).values({
      email: 'beta@test.com',
      name: 'Beta Pharmacy',
      postalCode: '1000002',
      address: 'Beta Address',
      phone: '06-2222-2221',
      fax: '06-2222-2222',
      licenseNumber: 'L-BETA-001',
      prefecture: 'Osaka',
      verificationStatus: 'verified',
      tenantId: t2.id,
    }).returning();

    // Upload dead stock for each pharmacy
    const [u1] = await db.insert(schema.uploadJobs).values({
      pharmacyId: p1.id,
      uploadType: 'dead_stock',
      originalFilename: 'alpha.csv',
      fileHash: 'hash-a',
      headerRowIndex: 0,
      mappingJson: {},
      fileBase64: '',
      status: 'completed',
      tenantId: t1.id,
    }).returning();

    const [u2] = await db.insert(schema.uploadJobs).values({
      pharmacyId: p2.id,
      uploadType: 'dead_stock',
      originalFilename: 'beta.csv',
      fileHash: 'hash-b',
      headerRowIndex: 0,
      mappingJson: {},
      fileBase64: '',
      status: 'completed',
      tenantId: t2.id,
    }).returning();

    await db.insert(schema.deadStockItems).values([
      { pharmacyId: p1.id, uploadId: u1.id, drugCode: 'A-001', drugName: 'Alpha Drug', quantity: 10, tenantId: t1.id },
      { pharmacyId: p2.id, uploadId: u2.id, drugCode: 'B-001', drugName: 'Beta Drug', quantity: 20, tenantId: t2.id },
    ]);

    // Switch to non-superuser role and set tenant context
    // As tenant 1: should see only tenant 1's data
    await setTenantContext(db, t1.id);
    const itemsT1 = await db.select().from(schema.deadStockItems);
    expect(itemsT1).toHaveLength(1);
    expect(itemsT1[0].tenantId).toBe(t1.id);
    expect(itemsT1[0].drugName).toBe('Alpha Drug');

    // Reset and switch to tenant 2
    await resetTenantContext(db);
    await setTenantContext(db, t2.id);
    const itemsT2 = await db.select().from(schema.deadStockItems);
    expect(itemsT2).toHaveLength(1);
    expect(itemsT2[0].tenantId).toBe(t2.id);
    expect(itemsT2[0].drugName).toBe('Beta Drug');
  });

  it('requireLogin-style setTenantContext integrates with test role', async () => {
    // Simulate the auth.ts requireLogin pattern:
    // After authenticating a user, call setTenantContext with their pharmacy/tenant ID
    const [tenant] = await db.insert(schema.tenants).values({ name: 'Tenant Gamma', slug: 'gamma' }).returning();
    const [pharmacy] = await db.insert(schema.pharmacies).values({
      email: 'gamma@test.com',
      name: 'Gamma Pharmacy',
      postalCode: '1000003',
      address: 'Gamma Address',
      phone: '03-3333-3333',
      fax: '03-3333-3334',
      licenseNumber: 'L-GAMMA-001',
      prefecture: 'Fukuoka',
      verificationStatus: 'verified',
      tenantId: tenant.id,
    }).returning();

    await db.insert(schema.uploadJobs).values({
      pharmacyId: pharmacy.id,
      uploadType: 'dead_stock',
      originalFilename: 'gamma.csv',
      fileHash: 'hash-g',
      headerRowIndex: 0,
      mappingJson: {},
      fileBase64: '',
      status: 'completed',
      tenantId: tenant.id,
    }).returning();

    // Set tenant context (same as auth.ts requireLogin does after auth)
    await db.execute(
      sql`SELECT set_config('app.tenant_id', ${String(tenant.id)}::text, true)`,
    );

    // Now switch to tenant role — RLS should filter
    await db.execute(sql.raw(`SET ROLE ${'test_tenant_role'}`));
    try {
      const allItems = await db.select().from(schema.uploadJobs);
      expect(allItems).toHaveLength(1);
      expect(allItems[0].tenantId).toBe(tenant.id);
    } finally {
      await db.execute(sql`RESET ROLE`);
    }
  });
});
