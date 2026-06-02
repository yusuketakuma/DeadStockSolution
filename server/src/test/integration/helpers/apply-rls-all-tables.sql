-- RLS DDL for PGlite test environment (all tables, nullable tenant_id)
-- Auto-generated from drizzle/0044_add_tenant_rls.sql — do not edit directly
-- Differences: tenant_id nullable, no data ops, no DROP DEFAULT

-- RLS Phase 1: Add tenant_id columns and RLS policies
-- Generated for DeadStockSolution
-- Apply: psql -f 0044_add_tenant_rls.sql

-- 1. Create tenants table
CREATE TABLE IF NOT EXISTS "tenants" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "created_at" TIMESTAMP DEFAULT NOW(),
  "updated_at" TIMESTAMP DEFAULT NOW()
);

-- 2. Seed tenants from existing pharmacies
-- INSERT INTO "tenants" ("id", "name", "slug")
-- SELECT "id", "name", 'pharmacy-' || "id" FROM "pharmacies"
-- ON CONFLICT ("id") DO NOTHING;

-- pharmacy_business_hours
ALTER TABLE "pharmacy_business_hours" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "pharmacy_business_hours" ADD CONSTRAINT "pharmacy_business_hours_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
-- UPDATE "pharmacy_business_hours" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL OR "tenant_id" = 0;
-- ALTER TABLE "pharmacy_business_hours" ALTER COLUMN "tenant_id" DROP DEFAULT;
ALTER TABLE "pharmacy_business_hours" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "pharmacy_business_hours";
CREATE POLICY "tenant_isolation" ON "pharmacy_business_hours" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

-- pharmacy_special_hours
ALTER TABLE "pharmacy_special_hours" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "pharmacy_special_hours" ADD CONSTRAINT "pharmacy_special_hours_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
-- UPDATE "pharmacy_special_hours" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL OR "tenant_id" = 0;
-- ALTER TABLE "pharmacy_special_hours" ALTER COLUMN "tenant_id" DROP DEFAULT;
ALTER TABLE "pharmacy_special_hours" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "pharmacy_special_hours";
CREATE POLICY "tenant_isolation" ON "pharmacy_special_hours" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

-- pharmacy_relationships
ALTER TABLE "pharmacy_relationships" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "pharmacy_relationships" ADD CONSTRAINT "pharmacy_relationships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
-- UPDATE "pharmacy_relationships" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL OR "tenant_id" = 0;
-- ALTER TABLE "pharmacy_relationships" ALTER COLUMN "tenant_id" DROP DEFAULT;
ALTER TABLE "pharmacy_relationships" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "pharmacy_relationships";
CREATE POLICY "tenant_isolation" ON "pharmacy_relationships" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

-- inventory_search_preferences
ALTER TABLE "inventory_search_preferences" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "inventory_search_preferences" ADD CONSTRAINT "inventory_search_preferences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
-- UPDATE "inventory_search_preferences" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL OR "tenant_id" = 0;
-- ALTER TABLE "inventory_search_preferences" ALTER COLUMN "tenant_id" DROP DEFAULT;
ALTER TABLE "inventory_search_preferences" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "inventory_search_preferences";
CREATE POLICY "tenant_isolation" ON "inventory_search_preferences" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

-- push_notification_preferences
ALTER TABLE "push_notification_preferences" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "push_notification_preferences" ADD CONSTRAINT "push_notification_preferences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
-- UPDATE "push_notification_preferences" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL OR "tenant_id" = 0;
-- ALTER TABLE "push_notification_preferences" ALTER COLUMN "tenant_id" DROP DEFAULT;
ALTER TABLE "push_notification_preferences" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "push_notification_preferences";
CREATE POLICY "tenant_isolation" ON "push_notification_preferences" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

-- subscriptions
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
-- UPDATE "subscriptions" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL OR "tenant_id" = 0;
-- ALTER TABLE "subscriptions" ALTER COLUMN "tenant_id" DROP DEFAULT;
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "subscriptions";
CREATE POLICY "tenant_isolation" ON "subscriptions" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

-- password_reset_tokens
ALTER TABLE "password_reset_tokens" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
-- UPDATE "password_reset_tokens" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL OR "tenant_id" = 0;
-- ALTER TABLE "password_reset_tokens" ALTER COLUMN "tenant_id" DROP DEFAULT;
ALTER TABLE "password_reset_tokens" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "password_reset_tokens";
CREATE POLICY "tenant_isolation" ON "password_reset_tokens" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

-- pharmacy_registration_reviews
ALTER TABLE "pharmacy_registration_reviews" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "pharmacy_registration_reviews" ADD CONSTRAINT "pharmacy_registration_reviews_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
ALTER TABLE "pharmacy_registration_reviews" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "pharmacy_registration_reviews";
CREATE POLICY "tenant_isolation" ON "pharmacy_registration_reviews" FOR ALL TO "public"
  USING (("tenant_id" = current_setting('app.tenant_id')::int OR "tenant_id" IS NULL))
  WITH CHECK (("tenant_id" = current_setting('app.tenant_id')::int OR "tenant_id" IS NULL));

-- upload_confirm_jobs
ALTER TABLE "upload_confirm_jobs" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "upload_confirm_jobs" ADD CONSTRAINT "upload_confirm_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
-- UPDATE "upload_confirm_jobs" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL OR "tenant_id" = 0;
-- ALTER TABLE "upload_confirm_jobs" ALTER COLUMN "tenant_id" DROP DEFAULT;
ALTER TABLE "upload_confirm_jobs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "upload_confirm_jobs";
CREATE POLICY "tenant_isolation" ON "upload_confirm_jobs" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

-- dead_stock_items
ALTER TABLE "dead_stock_items" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "dead_stock_items" ADD CONSTRAINT "dead_stock_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
-- UPDATE "dead_stock_items" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL OR "tenant_id" = 0;
-- ALTER TABLE "dead_stock_items" ALTER COLUMN "tenant_id" DROP DEFAULT;
ALTER TABLE "dead_stock_items" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "dead_stock_items";
CREATE POLICY "tenant_isolation" ON "dead_stock_items" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

-- used_medication_items
ALTER TABLE "used_medication_items" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "used_medication_items" ADD CONSTRAINT "used_medication_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
-- UPDATE "used_medication_items" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL OR "tenant_id" = 0;
-- ALTER TABLE "used_medication_items" ALTER COLUMN "tenant_id" DROP DEFAULT;
ALTER TABLE "used_medication_items" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "used_medication_items";
CREATE POLICY "tenant_isolation" ON "used_medication_items" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

-- column_mapping_templates
ALTER TABLE "column_mapping_templates" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "column_mapping_templates" ADD CONSTRAINT "column_mapping_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
-- UPDATE "column_mapping_templates" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL OR "tenant_id" = 0;
-- ALTER TABLE "column_mapping_templates" ALTER COLUMN "tenant_id" DROP DEFAULT;
ALTER TABLE "column_mapping_templates" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "column_mapping_templates";
CREATE POLICY "tenant_isolation" ON "column_mapping_templates" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

-- upload_row_issues
ALTER TABLE "upload_row_issues" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "upload_row_issues" ADD CONSTRAINT "upload_row_issues_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
-- UPDATE "upload_row_issues" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL OR "tenant_id" = 0;
-- ALTER TABLE "upload_row_issues" ALTER COLUMN "tenant_id" DROP DEFAULT;
ALTER TABLE "upload_row_issues" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "upload_row_issues";
CREATE POLICY "tenant_isolation" ON "upload_row_issues" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

-- upload_issue_remediation_history
ALTER TABLE "upload_issue_remediation_history" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "upload_issue_remediation_history" ADD CONSTRAINT "upload_issue_remediation_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
ALTER TABLE "upload_issue_remediation_history" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "upload_issue_remediation_history";
CREATE POLICY "tenant_isolation" ON "upload_issue_remediation_history" FOR ALL TO "public"
  USING (("tenant_id" = current_setting('app.tenant_id')::int OR "tenant_id" IS NULL))
  WITH CHECK (("tenant_id" = current_setting('app.tenant_id')::int OR "tenant_id" IS NULL));

-- proposal_templates
ALTER TABLE "proposal_templates" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "proposal_templates" ADD CONSTRAINT "proposal_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
-- UPDATE "proposal_templates" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL OR "tenant_id" = 0;
-- ALTER TABLE "proposal_templates" ALTER COLUMN "tenant_id" DROP DEFAULT;
ALTER TABLE "proposal_templates" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "proposal_templates";
CREATE POLICY "tenant_isolation" ON "proposal_templates" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

-- proposal_comments are shared by both pharmacies in the parent proposal.
ALTER TABLE "proposal_comments" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "proposal_comments";
DROP POLICY IF EXISTS "proposal_comments_select_participants" ON "proposal_comments";
DROP POLICY IF EXISTS "proposal_comments_insert_author" ON "proposal_comments";
DROP POLICY IF EXISTS "proposal_comments_update_author" ON "proposal_comments";
DROP POLICY IF EXISTS "proposal_comments_update_recipient_read" ON "proposal_comments";
CREATE POLICY "proposal_comments_select_participants" ON "proposal_comments" FOR SELECT TO "public"
  USING (EXISTS (
    SELECT 1
    FROM "exchange_proposals" ep
    WHERE ep."id" = "proposal_comments"."proposal_id"
      AND current_setting('app.tenant_id')::int IN (ep."pharmacy_a_id", ep."pharmacy_b_id")
  ));
CREATE POLICY "proposal_comments_insert_author" ON "proposal_comments" FOR INSERT TO "public"
  WITH CHECK (
    "author_pharmacy_id" = current_setting('app.tenant_id')::int
    AND EXISTS (
      SELECT 1
      FROM "exchange_proposals" ep
      WHERE ep."id" = "proposal_comments"."proposal_id"
        AND current_setting('app.tenant_id')::int IN (ep."pharmacy_a_id", ep."pharmacy_b_id")
    )
  );
CREATE POLICY "proposal_comments_update_author" ON "proposal_comments" FOR UPDATE TO "public"
  USING ("author_pharmacy_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("author_pharmacy_id" = current_setting('app.tenant_id')::int);
CREATE POLICY "proposal_comments_update_recipient_read" ON "proposal_comments" FOR UPDATE TO "public"
  USING (
    "author_pharmacy_id" <> current_setting('app.tenant_id')::int
    AND EXISTS (
      SELECT 1
      FROM "exchange_proposals" ep
      WHERE ep."id" = "proposal_comments"."proposal_id"
        AND current_setting('app.tenant_id')::int IN (ep."pharmacy_a_id", ep."pharmacy_b_id")
    )
  )
  WITH CHECK (
    "author_pharmacy_id" <> current_setting('app.tenant_id')::int
    AND EXISTS (
      SELECT 1
      FROM "exchange_proposals" ep
      WHERE ep."id" = "proposal_comments"."proposal_id"
        AND current_setting('app.tenant_id')::int IN (ep."pharmacy_a_id", ep."pharmacy_b_id")
    )
  );
CREATE OR REPLACE FUNCTION "proposal_comments_restrict_recipient_update"()
RETURNS trigger AS $$
BEGIN
  IF current_setting('app.tenant_id', true) <> ''
     AND current_setting('app.tenant_id')::int <> OLD."author_pharmacy_id"
     AND (
       NEW."proposal_id" IS DISTINCT FROM OLD."proposal_id"
       OR NEW."author_pharmacy_id" IS DISTINCT FROM OLD."author_pharmacy_id"
       OR NEW."body" IS DISTINCT FROM OLD."body"
       OR NEW."is_deleted" IS DISTINCT FROM OLD."is_deleted"
     ) THEN
    RAISE EXCEPTION 'recipient can only update proposal comment read state';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "proposal_comments_restrict_recipient_update" ON "proposal_comments";
CREATE TRIGGER "proposal_comments_restrict_recipient_update"
BEFORE UPDATE ON "proposal_comments"
FOR EACH ROW
EXECUTE FUNCTION "proposal_comments_restrict_recipient_update"();

-- match_candidate_snapshots
ALTER TABLE "match_candidate_snapshots" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "match_candidate_snapshots" ADD CONSTRAINT "match_candidate_snapshots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
-- UPDATE "match_candidate_snapshots" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL OR "tenant_id" = 0;
-- ALTER TABLE "match_candidate_snapshots" ALTER COLUMN "tenant_id" DROP DEFAULT;
ALTER TABLE "match_candidate_snapshots" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "match_candidate_snapshots";
CREATE POLICY "tenant_isolation" ON "match_candidate_snapshots" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

-- matching_refresh_jobs
ALTER TABLE "matching_refresh_jobs" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "matching_refresh_jobs" ADD CONSTRAINT "matching_refresh_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
-- UPDATE "matching_refresh_jobs" SET "tenant_id" = "trigger_pharmacy_id" WHERE "tenant_id" IS NULL OR "tenant_id" = 0;
-- ALTER TABLE "matching_refresh_jobs" ALTER COLUMN "tenant_id" DROP DEFAULT;
ALTER TABLE "matching_refresh_jobs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "matching_refresh_jobs";
CREATE POLICY "tenant_isolation" ON "matching_refresh_jobs" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

-- matching_rule_profiles
ALTER TABLE "matching_rule_profiles" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "matching_rule_profiles" ADD CONSTRAINT "matching_rule_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
ALTER TABLE "matching_rule_profiles" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "matching_rule_profiles";
CREATE POLICY "tenant_isolation" ON "matching_rule_profiles" FOR ALL TO "public"
  USING (("tenant_id" = current_setting('app.tenant_id')::int OR "tenant_id" IS NULL))
  WITH CHECK (("tenant_id" = current_setting('app.tenant_id')::int OR "tenant_id" IS NULL));

-- matching_experiment_assignments
ALTER TABLE "matching_experiment_assignments" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "matching_experiment_assignments" ADD CONSTRAINT "matching_experiment_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
-- UPDATE "matching_experiment_assignments" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL OR "tenant_id" = 0;
-- ALTER TABLE "matching_experiment_assignments" ALTER COLUMN "tenant_id" DROP DEFAULT;
ALTER TABLE "matching_experiment_assignments" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "matching_experiment_assignments";
CREATE POLICY "tenant_isolation" ON "matching_experiment_assignments" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

-- match_candidate_bookmarks
ALTER TABLE "match_candidate_bookmarks" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "match_candidate_bookmarks" ADD CONSTRAINT "match_candidate_bookmarks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
-- UPDATE "match_candidate_bookmarks" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL OR "tenant_id" = 0;
-- ALTER TABLE "match_candidate_bookmarks" ALTER COLUMN "tenant_id" DROP DEFAULT;
ALTER TABLE "match_candidate_bookmarks" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "match_candidate_bookmarks";
CREATE POLICY "tenant_isolation" ON "match_candidate_bookmarks" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

-- match_dismiss_feedback
ALTER TABLE "match_dismiss_feedback" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "match_dismiss_feedback" ADD CONSTRAINT "match_dismiss_feedback_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
-- UPDATE "match_dismiss_feedback" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL OR "tenant_id" = 0;
-- ALTER TABLE "match_dismiss_feedback" ALTER COLUMN "tenant_id" DROP DEFAULT;
ALTER TABLE "match_dismiss_feedback" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "match_dismiss_feedback";
CREATE POLICY "tenant_isolation" ON "match_dismiss_feedback" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

-- admin_messages
ALTER TABLE "admin_messages" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "admin_messages" ADD CONSTRAINT "admin_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
ALTER TABLE "admin_messages" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "admin_messages";
CREATE POLICY "tenant_isolation" ON "admin_messages" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

-- admin_message_reads
ALTER TABLE "admin_message_reads" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "admin_message_reads" ADD CONSTRAINT "admin_message_reads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
-- UPDATE "admin_message_reads" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL OR "tenant_id" = 0;
-- ALTER TABLE "admin_message_reads" ALTER COLUMN "tenant_id" DROP DEFAULT;
ALTER TABLE "admin_message_reads" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "admin_message_reads";
CREATE POLICY "tenant_isolation" ON "admin_message_reads" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

-- notifications
ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
-- UPDATE "notifications" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL OR "tenant_id" = 0;
-- ALTER TABLE "notifications" ALTER COLUMN "tenant_id" DROP DEFAULT;
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "notifications";
CREATE POLICY "tenant_isolation" ON "notifications" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

-- match_notifications
ALTER TABLE "match_notifications" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "match_notifications" ADD CONSTRAINT "match_notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
-- UPDATE "match_notifications" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL OR "tenant_id" = 0;
-- ALTER TABLE "match_notifications" ALTER COLUMN "tenant_id" DROP DEFAULT;
ALTER TABLE "match_notifications" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "match_notifications";
CREATE POLICY "tenant_isolation" ON "match_notifications" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

-- notification_group_states
ALTER TABLE "notification_group_states" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "notification_group_states" ADD CONSTRAINT "notification_group_states_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
-- UPDATE "notification_group_states" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL OR "tenant_id" = 0;
-- ALTER TABLE "notification_group_states" ALTER COLUMN "tenant_id" DROP DEFAULT;
ALTER TABLE "notification_group_states" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "notification_group_states";
CREATE POLICY "tenant_isolation" ON "notification_group_states" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

-- push_subscriptions
ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
-- UPDATE "push_subscriptions" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL OR "tenant_id" = 0;
-- ALTER TABLE "push_subscriptions" ALTER COLUMN "tenant_id" DROP DEFAULT;
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "push_subscriptions";
CREATE POLICY "tenant_isolation" ON "push_subscriptions" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

-- pharmacy_groups
ALTER TABLE "pharmacy_groups" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "pharmacy_groups" ADD CONSTRAINT "pharmacy_groups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
-- UPDATE "pharmacy_groups" SET "tenant_id" = "owner_pharmacy_id" WHERE "tenant_id" IS NULL OR "tenant_id" = 0;
-- ALTER TABLE "pharmacy_groups" ALTER COLUMN "tenant_id" DROP DEFAULT;
ALTER TABLE "pharmacy_groups" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "pharmacy_groups";
CREATE POLICY "tenant_isolation" ON "pharmacy_groups" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

-- group_members
ALTER TABLE "group_members" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
-- UPDATE "group_members" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL OR "tenant_id" = 0;
-- ALTER TABLE "group_members" ALTER COLUMN "tenant_id" DROP DEFAULT;
ALTER TABLE "group_members" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "group_members";
CREATE POLICY "tenant_isolation" ON "group_members" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

-- user_requests
ALTER TABLE "user_requests" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "user_requests" ADD CONSTRAINT "user_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
-- UPDATE "user_requests" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL OR "tenant_id" = 0;
-- ALTER TABLE "user_requests" ALTER COLUMN "tenant_id" DROP DEFAULT;
ALTER TABLE "user_requests" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "user_requests";
CREATE POLICY "tenant_isolation" ON "user_requests" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

-- openclaw_work_items
ALTER TABLE "openclaw_work_items" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "openclaw_work_items" ADD CONSTRAINT "openclaw_work_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
-- UPDATE "openclaw_work_items" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL OR "tenant_id" = 0;
-- ALTER TABLE "openclaw_work_items" ALTER COLUMN "tenant_id" DROP DEFAULT;
ALTER TABLE "openclaw_work_items" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "openclaw_work_items";
CREATE POLICY "tenant_isolation" ON "openclaw_work_items" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

-- openclaw_request_events
ALTER TABLE "openclaw_request_events" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "openclaw_request_events" ADD CONSTRAINT "openclaw_request_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
-- UPDATE "openclaw_request_events" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL OR "tenant_id" = 0;
-- ALTER TABLE "openclaw_request_events" ALTER COLUMN "tenant_id" DROP DEFAULT;
ALTER TABLE "openclaw_request_events" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "openclaw_request_events";
CREATE POLICY "tenant_isolation" ON "openclaw_request_events" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

-- openclaw_retry_jobs
ALTER TABLE "openclaw_retry_jobs" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "openclaw_retry_jobs" ADD CONSTRAINT "openclaw_retry_jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
-- UPDATE "openclaw_retry_jobs" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL OR "tenant_id" = 0;
-- ALTER TABLE "openclaw_retry_jobs" ALTER COLUMN "tenant_id" DROP DEFAULT;
ALTER TABLE "openclaw_retry_jobs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "openclaw_retry_jobs";
CREATE POLICY "tenant_isolation" ON "openclaw_retry_jobs" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

-- dds_work_items
ALTER TABLE "dds_work_items" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "dds_work_items" ADD CONSTRAINT "dds_work_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
-- UPDATE "dds_work_items" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL OR "tenant_id" = 0;
-- ALTER TABLE "dds_work_items" ALTER COLUMN "tenant_id" DROP DEFAULT;
ALTER TABLE "dds_work_items" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "dds_work_items";
CREATE POLICY "tenant_isolation" ON "dds_work_items" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

-- user_request_messages
ALTER TABLE "user_request_messages" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "user_request_messages" ADD CONSTRAINT "user_request_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
ALTER TABLE "user_request_messages" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "user_request_messages";
CREATE POLICY "tenant_isolation" ON "user_request_messages" FOR ALL TO "public"
  USING (("tenant_id" = current_setting('app.tenant_id')::int OR "tenant_id" IS NULL))
  WITH CHECK (("tenant_id" = current_setting('app.tenant_id')::int OR "tenant_id" IS NULL));

-- user_request_internal_notes
ALTER TABLE "user_request_internal_notes" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "user_request_internal_notes" ADD CONSTRAINT "user_request_internal_notes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
ALTER TABLE "user_request_internal_notes" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "user_request_internal_notes";
CREATE POLICY "tenant_isolation" ON "user_request_internal_notes" FOR ALL TO "public"
  USING (("tenant_id" = current_setting('app.tenant_id')::int OR "tenant_id" IS NULL))
  WITH CHECK (("tenant_id" = current_setting('app.tenant_id')::int OR "tenant_id" IS NULL));

-- openclaw_runbook_logs
ALTER TABLE "openclaw_runbook_logs" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "openclaw_runbook_logs" ADD CONSTRAINT "openclaw_runbook_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
ALTER TABLE "openclaw_runbook_logs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "openclaw_runbook_logs";
CREATE POLICY "tenant_isolation" ON "openclaw_runbook_logs" FOR ALL TO "public"
  USING (("tenant_id" = current_setting('app.tenant_id')::int OR "tenant_id" IS NULL))
  WITH CHECK (("tenant_id" = current_setting('app.tenant_id')::int OR "tenant_id" IS NULL));

-- daily_statistics
ALTER TABLE "daily_statistics" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "daily_statistics" ADD CONSTRAINT "daily_statistics_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
-- UPDATE "daily_statistics" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL OR "tenant_id" = 0;
-- ALTER TABLE "daily_statistics" ALTER COLUMN "tenant_id" DROP DEFAULT;
ALTER TABLE "daily_statistics" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "daily_statistics";
CREATE POLICY "tenant_isolation" ON "daily_statistics" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

-- predictive_alerts
ALTER TABLE "predictive_alerts" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "predictive_alerts" ADD CONSTRAINT "predictive_alerts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
-- UPDATE "predictive_alerts" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL OR "tenant_id" = 0;
-- ALTER TABLE "predictive_alerts" ALTER COLUMN "tenant_id" DROP DEFAULT;
ALTER TABLE "predictive_alerts" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "predictive_alerts";
CREATE POLICY "tenant_isolation" ON "predictive_alerts" FOR ALL TO "public"
  USING ("tenant_id" = current_setting('app.tenant_id')::int)
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::int);

-- activity_logs
ALTER TABLE "activity_logs" ADD COLUMN IF NOT EXISTS "tenant_id" INTEGER;
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id");
ALTER TABLE "activity_logs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "activity_logs";
CREATE POLICY "tenant_isolation" ON "activity_logs" FOR ALL TO "public"
  USING (("tenant_id" = current_setting('app.tenant_id')::int OR "tenant_id" IS NULL))
  WITH CHECK (("tenant_id" = current_setting('app.tenant_id')::int OR "tenant_id" IS NULL));

-- Group B: Cross-tenant RLS policies
ALTER TABLE "exchange_proposals" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "exchange_proposals";
CREATE POLICY "tenant_isolation" ON "exchange_proposals" FOR ALL TO "public"
  USING (current_setting('app.tenant_id')::int IN ("pharmacy_a_id", "pharmacy_b_id"))
  WITH CHECK (current_setting('app.tenant_id')::int IN ("pharmacy_a_id", "pharmacy_b_id"));

ALTER TABLE "exchange_proposal_items" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "exchange_proposal_items";
CREATE POLICY "tenant_isolation" ON "exchange_proposal_items" FOR ALL TO "public"
  USING (current_setting('app.tenant_id')::int IN ("from_pharmacy_id", "to_pharmacy_id"))
  WITH CHECK (current_setting('app.tenant_id')::int IN ("from_pharmacy_id", "to_pharmacy_id"));

ALTER TABLE "exchange_feedback" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "exchange_feedback";
CREATE POLICY "tenant_isolation" ON "exchange_feedback" FOR ALL TO "public"
  USING (current_setting('app.tenant_id')::int IN ("from_pharmacy_id", "to_pharmacy_id"))
  WITH CHECK (current_setting('app.tenant_id')::int IN ("from_pharmacy_id", "to_pharmacy_id"));

ALTER TABLE "proposal_counter_offers" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "proposal_counter_offers";
CREATE POLICY "tenant_isolation" ON "proposal_counter_offers" FOR ALL TO "public"
  USING (current_setting('app.tenant_id')::int IN ("proposer_pharmacy_id", "responder_pharmacy_id"))
  WITH CHECK (current_setting('app.tenant_id')::int IN ("proposer_pharmacy_id", "responder_pharmacy_id"));

ALTER TABLE "direct_messages" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "direct_messages";
CREATE POLICY "tenant_isolation" ON "direct_messages" FOR ALL TO "public"
  USING (current_setting('app.tenant_id')::int IN ("from_pharmacy_id", "to_pharmacy_id"))
  WITH CHECK (current_setting('app.tenant_id')::int IN ("from_pharmacy_id", "to_pharmacy_id"));

ALTER TABLE "admin_audit_logs" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "admin_audit_logs";
CREATE POLICY "tenant_isolation" ON "admin_audit_logs" FOR ALL TO "public"
  USING (current_setting('app.tenant_id')::int IN ("admin_id", "target_pharmacy_id"))
  WITH CHECK (current_setting('app.tenant_id')::int IN ("admin_id", "target_pharmacy_id"));

-- dead_stock_reservations (subquery via dead_stock_items)
ALTER TABLE "dead_stock_reservations" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation" ON "dead_stock_reservations";
CREATE POLICY "tenant_isolation" ON "dead_stock_reservations" FOR ALL TO "public"
  USING (EXISTS (
    SELECT 1
    FROM "exchange_proposals" ep
    JOIN "exchange_proposal_items" epi
      ON epi."proposal_id" = ep."id"
      AND epi."dead_stock_item_id" = "dead_stock_reservations"."dead_stock_item_id"
    JOIN "dead_stock_items" dsi
      ON dsi."id" = "dead_stock_reservations"."dead_stock_item_id"
      AND dsi."pharmacy_id" = epi."from_pharmacy_id"
    WHERE ep."id" = "dead_stock_reservations"."proposal_id"
      AND epi."from_pharmacy_id" IN (ep."pharmacy_a_id", ep."pharmacy_b_id")
      AND epi."to_pharmacy_id" IN (ep."pharmacy_a_id", ep."pharmacy_b_id")
      AND current_setting('app.tenant_id')::int IN (ep."pharmacy_a_id", ep."pharmacy_b_id")
  ))
  WITH CHECK (EXISTS (
    SELECT 1
    FROM "exchange_proposals" ep
    JOIN "exchange_proposal_items" epi
      ON epi."proposal_id" = ep."id"
      AND epi."dead_stock_item_id" = "dead_stock_reservations"."dead_stock_item_id"
    JOIN "dead_stock_items" dsi
      ON dsi."id" = "dead_stock_reservations"."dead_stock_item_id"
      AND dsi."pharmacy_id" = epi."from_pharmacy_id"
    WHERE ep."id" = "dead_stock_reservations"."proposal_id"
      AND epi."from_pharmacy_id" IN (ep."pharmacy_a_id", ep."pharmacy_b_id")
      AND epi."to_pharmacy_id" IN (ep."pharmacy_a_id", ep."pharmacy_b_id")
      AND current_setting('app.tenant_id')::int IN (ep."pharmacy_a_id", ep."pharmacy_b_id")
  ));
