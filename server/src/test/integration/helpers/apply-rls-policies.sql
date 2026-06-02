-- RLS Policy DDL for integration tests
-- Only covers tables used in the existing test suite
-- Uses standard PostgreSQL DDL without IF NOT EXISTS

-- Group A: Tenant-scoped tables
ALTER TABLE "pharmacy_business_hours" ADD COLUMN "tenant_id" INTEGER;
ALTER TABLE "pharmacy_business_hours" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "pharmacy_business_hours";
CREATE POLICY "tenant_isolation" ON "pharmacy_business_hours" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

ALTER TABLE "admin_messages" ADD COLUMN "tenant_id" INTEGER;
ALTER TABLE "admin_messages" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "admin_messages";
CREATE POLICY "tenant_isolation" ON "admin_messages" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

ALTER TABLE "upload_confirm_jobs" ADD COLUMN "tenant_id" INTEGER;
ALTER TABLE "upload_confirm_jobs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "upload_confirm_jobs";
CREATE POLICY "tenant_isolation" ON "upload_confirm_jobs" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

ALTER TABLE "dead_stock_items" ADD COLUMN "tenant_id" INTEGER;
ALTER TABLE "dead_stock_items" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "dead_stock_items";
CREATE POLICY "tenant_isolation" ON "dead_stock_items" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

-- Group B: Cross-tenant tables (visibility via IN clause)
ALTER TABLE "exchange_proposals" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "exchange_proposals";
CREATE POLICY "tenant_isolation" ON "exchange_proposals" FOR ALL TO "public"
  USING (current_setting('app.tenant_id')::int IN ("pharmacy_a_id", "pharmacy_b_id"))
  WITH CHECK (current_setting('app.tenant_id')::int IN ("pharmacy_a_id", "pharmacy_b_id"));
