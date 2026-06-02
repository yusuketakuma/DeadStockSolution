import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { getTestDb, resetTestDb, closeTestDb, type TestDb } from './helpers/test-db';
import { resetFactorySeq } from './helpers/factories';
import { createTenantRole, dropTenantRole, setTenantContext, resetTenantContext } from './helpers/rls-helper';
import * as schema from '../../db/schema';

let db: TestDb;

// ── Tenant context helpers ──────────────────────────────────────────────

async function asTenant<T>(tenantId: number, fn: () => Promise<T>): Promise<T> {
  await setTenantContext(db, tenantId);
  try { return await fn(); }
  finally { await resetTenantContext(db); }
}

// ── Post-insert tenant_id backfill ──────────────────────────────────────
// tenantId is not in the Drizzle schema (added via raw SQL migration),
// so Drizzle ORM silently drops it from INSERTs. We backfill via raw SQL.

async function backfillTenantId(table: string, rowId: number, tenantId: number): Promise<void> {
  await db.execute(sql.raw(
    `UPDATE "${table}" SET "tenant_id" = ${tenantId} WHERE "id" = ${rowId}`
  ));
}

// ── Seed helpers ────────────────────────────────────────────────────────

async function seedTenants(): Promise<{ t1: typeof schema.tenants.$inferSelect; t2: typeof schema.tenants.$inferSelect }> {
  const [t1] = await db.insert(schema.tenants).values({ name: 'Tenant 1', slug: 'tenant-1' }).returning();
  const [t2] = await db.insert(schema.tenants).values({ name: 'Tenant 2', slug: 'tenant-2' }).returning();
  return { t1, t2 };
}

async function seedPharmacies(tenant1Id: number, tenant2Id: number) {
  const [p1] = await db.insert(schema.pharmacies).values({
    email: 'p1@test.com',
    name: 'Pharmacy 1',
    postalCode: '1000001',
    address: 'Tokyo 1',
    phone: '03-1111-1111',
    fax: '03-1111-1112',
    licenseNumber: 'L000001',
    prefecture: 'Tokyo',
    verificationStatus: 'verified',
    tenantId: tenant1Id,
  }).returning();
  const [p2] = await db.insert(schema.pharmacies).values({
    email: 'p2@test.com',
    name: 'Pharmacy 2',
    postalCode: '1000002',
    address: 'Osaka 1',
    phone: '06-2222-2221',
    fax: '06-2222-2222',
    licenseNumber: 'L000002',
    prefecture: 'Osaka',
    verificationStatus: 'verified',
    tenantId: tenant2Id,
  }).returning();
  return { p1, p2 };
}

async function seedDeadStock(pharmacy1Id: number, pharmacy2Id: number, tenant1Id: number, tenant2Id: number) {
  const [u1] = await db.insert(schema.uploadJobs).values({
    pharmacyId: pharmacy1Id,
    uploadType: 'dead_stock',
    originalFilename: 't1.csv',
    fileHash: 'h1',
    headerRowIndex: 0,
    mappingJson: {},
    fileBase64: '',
    status: 'completed',
    tenantId: tenant1Id,
  }).returning();
  const [u2] = await db.insert(schema.uploadJobs).values({
    pharmacyId: pharmacy2Id,
    uploadType: 'dead_stock',
    originalFilename: 't2.csv',
    fileHash: 'h2',
    headerRowIndex: 0,
    mappingJson: {},
    fileBase64: '',
    status: 'completed',
    tenantId: tenant2Id,
  }).returning();
  const [ds1] = await db.insert(schema.deadStockItems).values({
    pharmacyId: pharmacy1Id,
    uploadId: u1.id,
    drugCode: 'DS-T1-001',
    drugName: 'Tenant1 Drug A',
    quantity: 100,
  }).returning();
  await backfillTenantId('dead_stock_items', ds1.id, tenant1Id);
  const [ds2] = await db.insert(schema.deadStockItems).values({
    pharmacyId: pharmacy2Id,
    uploadId: u2.id,
    drugCode: 'DS-T2-001',
    drugName: 'Tenant2 Drug B',
    quantity: 200,
  }).returning();
  await backfillTenantId('dead_stock_items', ds2.id, tenant2Id);
  return { u1, u2, ds1, ds2 };
}

async function seedBusinessHours(pharmacy1Id: number, pharmacy2Id: number, tenant1Id: number, tenant2Id: number) {
  await db.insert(schema.pharmacyBusinessHours).values([
    { pharmacyId: pharmacy1Id, dayOfWeek: 1, openTime: '09:00', closeTime: '18:00' },
    { pharmacyId: pharmacy2Id, dayOfWeek: 1, openTime: '10:00', closeTime: '19:00' },
  ]);
  await db.execute(sql.raw(
    `UPDATE "pharmacy_business_hours" SET "tenant_id" = ${tenant1Id} WHERE "pharmacy_id" = ${pharmacy1Id}`
  ));
  await db.execute(sql.raw(
    `UPDATE "pharmacy_business_hours" SET "tenant_id" = ${tenant2Id} WHERE "pharmacy_id" = ${pharmacy2Id}`
  ));
}

async function seedAdminMessages(pharmacy1Id: number, pharmacy2Id: number, tenant1Id: number, tenant2Id: number) {
  await db.insert(schema.adminMessages).values([
    { senderAdminId: pharmacy1Id, targetType: 'all', title: 'Msg T1', body: 'Body T1' },
    { senderAdminId: pharmacy2Id, targetType: 'all', title: 'Msg T2', body: 'Body T2' },
  ]);
  await db.execute(sql.raw(
    `UPDATE "admin_messages" SET "tenant_id" = ${tenant1Id} WHERE "sender_admin_id" = ${pharmacy1Id}`
  ));
  await db.execute(sql.raw(
    `UPDATE "admin_messages" SET "tenant_id" = ${tenant2Id} WHERE "sender_admin_id" = ${pharmacy2Id}`
  ));
}

async function seedExchangeProposal(
  pharmacy1Id: number, pharmacy2Id: number,
) {
  const [proposal] = await db.insert(schema.exchangeProposals).values({
    pharmacyAId: pharmacy1Id,
    pharmacyBId: pharmacy2Id,
    status: 'proposed',
  }).returning();
  return { proposal };
}

async function seedDrugMaster() {
  const [dm] = await db.insert(schema.drugMaster).values({
    yjCode: '999999999',
    drugName: 'Test Drug (Global)',
    yakkaPrice: '500.00',
  }).returning();
  return { dm };
}

// ── Global setup ────────────────────────────────────────────────────────

beforeAll(async () => {
  db = await getTestDb();
  // Create the non-superuser role needed for RLS enforcement
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

async function getTenantId<T extends { id: number }>(table: string, row: T): Promise<number | null> {
  const rows = await db.execute<{ tenant_id: number | null }>(
    sql.raw(`SELECT "tenant_id" FROM "${table}" WHERE "id" = ${row.id}`)
  );
  const result = rows.rows ?? rows;
  return result[0]?.tenant_id ?? null;
}

// ── Tests ───────────────────────────────────────────────────────────────

describe('RLS isolation tests', () => {
  it('read isolation — Tenant A cannot see Tenant B data on Group A tables', async () => {
    const { t1, t2 } = await seedTenants();
    const { p1, p2 } = await seedPharmacies(t1.id, t2.id);
    await seedDeadStock(p1.id, p2.id, t1.id, t2.id);
    await seedBusinessHours(p1.id, p2.id, t1.id, t2.id);
    await seedAdminMessages(p1.id, p2.id, t1.id, t2.id);

    // As tenant 1
    const itemsT1 = await asTenant(t1.id, async () =>
      db.select().from(schema.deadStockItems)
    );
    const hoursT1 = await asTenant(t1.id, async () =>
      db.select().from(schema.pharmacyBusinessHours)
    );
    const msgsT1 = await asTenant(t1.id, async () =>
      db.select().from(schema.adminMessages)
    );

    // As tenant 2
    const itemsT2 = await asTenant(t2.id, async () =>
      db.select().from(schema.deadStockItems)
    );
    const hoursT2 = await asTenant(t2.id, async () =>
      db.select().from(schema.pharmacyBusinessHours)
    );
    const msgsT2 = await asTenant(t2.id, async () =>
      db.select().from(schema.adminMessages)
    );

    // Tenant 1 sees only their data
    expect(itemsT1).toHaveLength(1);
    expect(itemsT1[0].drugName).toBe('Tenant1 Drug A');

    // Tenant 2 sees only their data
    expect(itemsT2).toHaveLength(1);
    expect(itemsT2[0].drugName).toBe('Tenant2 Drug B');

    // Verify tenant_id via raw SQL (the column is in the DB but not in Drizzle schema)
    const tid1 = await getTenantId('dead_stock_items', itemsT1[0]);
    expect(tid1).toBe(t1.id);
    const tid2 = await getTenantId('dead_stock_items', itemsT2[0]);
    expect(tid2).toBe(t2.id);

    // No cross-tenant leakage — verified by row count + drug name
    expect(itemsT1[0].drugName).not.toBe(itemsT2[0].drugName);

    // Business hours isolation
    expect(hoursT1).toHaveLength(1);
    expect(hoursT1[0].pharmacyId).toBe(p1.id);
    expect(hoursT2).toHaveLength(1);
    expect(hoursT2[0].pharmacyId).toBe(p2.id);

    // Admin message isolation
    expect(msgsT1).toHaveLength(1);
    expect(msgsT1[0].title).toBe('Msg T1');
    expect(msgsT2).toHaveLength(1);
    expect(msgsT2[0].title).toBe('Msg T2');
  });

  it('write isolation — cannot INSERT with another tenant\'s tenant_id', async () => {
    const { t1, t2 } = await seedTenants();
    const { p1, p2 } = await seedPharmacies(t1.id, t2.id);
    const { u1 } = await seedDeadStock(p1.id, p2.id, t1.id, t2.id);

    // As tenant 1, try to insert a row with tenant_id = 2 (tenant 2's scope)
    await expect(
      asTenant(t1.id, async () =>
        db.insert(schema.deadStockItems).values({
          pharmacyId: p1.id,
          uploadId: u1.id,
          drugCode: 'ILLEGAL',
          drugName: 'Cross-tenant Insert',
          quantity: 99,
          tenantId: t2.id,  // <-- belongs to tenant 2, violates WITH CHECK
        }).returning()
      )
    ).rejects.toThrow();
  });

  it('cross-tenant visibility — Tenant A sees own exchange proposals (Group B)', async () => {
    const { t1, t2 } = await seedTenants();
    const { p1, p2 } = await seedPharmacies(t1.id, t2.id);

    // Create a proposal between pharmacy1 (tenant 1) and pharmacy2 (tenant 2)
    await seedExchangeProposal(p1.id, p2.id, t1.id, t2.id);

    // Tenant 1 should see the proposal (they're pharmacy_a)
    const proposalsT1 = await asTenant(t1.id, async () =>
      db.select().from(schema.exchangeProposals)
    );
    expect(proposalsT1).toHaveLength(1);
    expect(proposalsT1[0].pharmacyAId).toBe(p1.id);

    // Tenant 2 should also see the proposal (they're pharmacy_b)
    const proposalsT2 = await asTenant(t2.id, async () =>
      db.select().from(schema.exchangeProposals)
    );
    expect(proposalsT2).toHaveLength(1);
    expect(proposalsT2[0].pharmacyBId).toBe(p2.id);
  });

  it('shared tables — all tenants can access Group C tables', async () => {
    const { t1, t2 } = await seedTenants();
    await seedDrugMaster();

    // Both tenants can read drug_master (no tenant_id, no RLS)
    const dmT1 = await asTenant(t1.id, async () =>
      db.select().from(schema.drugMaster)
    );
    const dmT2 = await asTenant(t2.id, async () =>
      db.select().from(schema.drugMaster)
    );

    expect(dmT1).toHaveLength(1);
    expect(dmT2).toHaveLength(1);
    expect(dmT1[0].id).toBe(dmT2[0].id);
  });

  it('admin bypass — superuser sees all data regardless of tenant context', async () => {
    const { t1, t2 } = await seedTenants();
    const { p1, p2 } = await seedPharmacies(t1.id, t2.id);
    await seedDeadStock(p1.id, p2.id, t1.id, t2.id);

    // As superuser (no SET ROLE), query directly with tenant context set to 1
    // Superuser should bypass RLS and see ALL rows
    await db.execute(sql`SELECT set_config('app.tenant_id', '1', false)`);
    const allItems = await db.select().from(schema.deadStockItems);
    expect(allItems).toHaveLength(2);  // sees both tenants' data

    // Even with tenant_id set to a different value, superuser sees all
    await db.execute(sql`SELECT set_config('app.tenant_id', '99', false)`);
    const allItems2 = await db.select().from(schema.deadStockItems);
    expect(allItems2).toHaveLength(2);
  });

  it('SET context missing — non-superuser cannot read with wrong tenant_id', async () => {
    const { t1, t2 } = await seedTenants();
    const { p1, p2 } = await seedPharmacies(t1.id, t2.id);
    await seedDeadStock(p1.id, p2.id, t1.id, t2.id);

    // Set to a non-existent tenant ID as tenant context
    const items = await asTenant(999, async () =>
      db.select().from(schema.deadStockItems)
    );

    // No rows should match because no tenant has id=999
    expect(items).toHaveLength(0);
  });

  it('read isolation — covers multiple Group A tables', async () => {
    const { t1, t2 } = await seedTenants();
    const { p1, p2 } = await seedPharmacies(t1.id, t2.id);
    await seedDeadStock(p1.id, p2.id, t1.id, t2.id);
    await seedBusinessHours(p1.id, p2.id, t1.id, t2.id);
    await seedAdminMessages(p1.id, p2.id, t1.id, t2.id);

    // Verify all Group A tables are isolated
    const results = await Promise.all([
      asTenant(t1.id, () => db.select().from(schema.deadStockItems)),
      asTenant(t1.id, () => db.select().from(schema.pharmacyBusinessHours)),
      asTenant(t1.id, () => db.select().from(schema.adminMessages)),
      asTenant(t2.id, () => db.select().from(schema.deadStockItems)),
      asTenant(t2.id, () => db.select().from(schema.pharmacyBusinessHours)),
      asTenant(t2.id, () => db.select().from(schema.adminMessages)),
    ]);

    // Each tenant sees exactly 1 row per table
    expect(results[0]).toHaveLength(1);
    expect(results[1]).toHaveLength(1);
    expect(results[2]).toHaveLength(1);
    expect(results[3]).toHaveLength(1);
    expect(results[4]).toHaveLength(1);
    expect(results[5]).toHaveLength(1);
  });
});
