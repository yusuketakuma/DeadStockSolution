CREATE TYPE "public"."equivalence_type_enum" AS ENUM('brand_generic', 'generic_generic');--> statement-breakpoint
CREATE TABLE "drug_equivalences" (
	"id" serial PRIMARY KEY NOT NULL,
	"drug_name_a" text NOT NULL,
	"drug_name_b" text NOT NULL,
	"equivalence_type" "equivalence_type_enum" NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "admin_audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"admin_id" integer NOT NULL,
	"target_pharmacy_id" integer NOT NULL,
	"action" text NOT NULL,
	"previous_status" text,
	"new_status" text NOT NULL,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "chk_admin_audit_action" CHECK ("admin_audit_logs"."action" IN ('verify', 'reject', 're-review'))
);
--> statement-breakpoint
ALTER TABLE "exchange_history" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "match_notifications" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pharmacy_trust_scores" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "uploads" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "exchange_history" CASCADE;--> statement-breakpoint
DROP TABLE "match_notifications" CASCADE;--> statement-breakpoint
DROP TABLE "pharmacy_trust_scores" CASCADE;--> statement-breakpoint
DROP TABLE "uploads" CASCADE;--> statement-breakpoint
DROP INDEX "pharmacies_workos_user_id_unique";--> statement-breakpoint
ALTER TABLE "activity_logs" ALTER COLUMN "metadata_json" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "drug_master_source_state" ALTER COLUMN "metadata_json" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "match_candidate_snapshots" ALTER COLUMN "top_candidates_json" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "monthly_reports" ALTER COLUMN "report_json" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "openclaw_command_whitelist" ALTER COLUMN "parameters_schema" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "openclaw_commands" ALTER COLUMN "parameters" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "openclaw_commands" ALTER COLUMN "result" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "predictive_alerts" ALTER COLUMN "detail_json" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "system_events" ALTER COLUMN "detail_json" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "upload_confirm_jobs" ALTER COLUMN "mapping_json" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "upload_confirm_jobs" ALTER COLUMN "result_json" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "upload_row_issues" ALTER COLUMN "row_data_json" SET DATA TYPE jsonb;--> statement-breakpoint
ALTER TABLE "exchange_proposals" ADD COLUMN "completed_total_value" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "matching_rule_profiles" ADD COLUMN "near_expiry_decay_curve" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "matching_rule_profiles" ADD COLUMN "success_rate_bonus" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "matching_rule_profiles" ADD COLUMN "max_candidates" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "detail_json" jsonb;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "source_pharmacy_id" integer;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "pharmacies" ADD COLUMN "trust_score" numeric(5, 2) DEFAULT '60.00';--> statement-breakpoint
ALTER TABLE "pharmacies" ADD COLUMN "rating_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "pharmacies" ADD COLUMN "positive_rate" numeric(5, 2) DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_admin_id_pharmacies_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."pharmacies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_target_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("target_pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_drug_equivalences_drug_name_a" ON "drug_equivalences" USING btree ("drug_name_a");--> statement-breakpoint
CREATE INDEX "idx_drug_equivalences_drug_name_b" ON "drug_equivalences" USING btree ("drug_name_b");--> statement-breakpoint
CREATE INDEX "idx_drug_equivalences_type" ON "drug_equivalences" USING btree ("equivalence_type");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_drug_equivalences_unique_pair" ON "drug_equivalences" USING btree ("drug_name_a","drug_name_b");--> statement-breakpoint
CREATE INDEX "idx_admin_audit_logs_admin_created" ON "admin_audit_logs" USING btree ("admin_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_admin_audit_logs_target_created" ON "admin_audit_logs" USING btree ("target_pharmacy_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_admin_audit_logs_action_created" ON "admin_audit_logs" USING btree ("action","created_at");--> statement-breakpoint
ALTER TABLE "dead_stock_items" ADD CONSTRAINT "dead_stock_items_upload_id_upload_confirm_jobs_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."upload_confirm_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_source_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("source_pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "used_medication_items" ADD CONSTRAINT "used_medication_items_upload_id_upload_confirm_jobs_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."upload_confirm_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_dead_stock_pharmacy_drug_master_available" ON "dead_stock_items" USING btree ("pharmacy_id","drug_master_id") WHERE "dead_stock_items"."is_available" = true;--> statement-breakpoint
CREATE INDEX "idx_exchange_proposals_completed_a" ON "exchange_proposals" USING btree ("pharmacy_a_id","completed_at") WHERE "exchange_proposals"."status" = 'completed';--> statement-breakpoint
CREATE INDEX "idx_exchange_proposals_completed_b" ON "exchange_proposals" USING btree ("pharmacy_b_id","completed_at") WHERE "exchange_proposals"."status" = 'completed';--> statement-breakpoint
CREATE INDEX "idx_notifications_type_created" ON "notifications" USING btree ("type","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_notifications_reference_lookup" ON "notifications" USING btree ("reference_type","reference_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_pharmacy_dedupe_key_idx" ON "notifications" USING btree ("pharmacy_id","dedupe_key") WHERE dedupe_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_pharmacies_is_active" ON "pharmacies" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_pharmacies_verification_status" ON "pharmacies" USING btree ("verification_status");--> statement-breakpoint
CREATE INDEX "idx_pharmacies_is_admin" ON "pharmacies" USING btree ("is_admin");--> statement-breakpoint
ALTER TABLE "pharmacies" ADD CONSTRAINT "pharmacies_workos_user_id_unique" UNIQUE("workos_user_id");--> statement-breakpoint
ALTER TABLE "matching_rule_profiles" ADD CONSTRAINT "chk_matching_rule_near_expiry_decay_curve" CHECK ("matching_rule_profiles"."near_expiry_decay_curve" >= 0 AND "matching_rule_profiles"."near_expiry_decay_curve" <= 10);--> statement-breakpoint
ALTER TABLE "matching_rule_profiles" ADD CONSTRAINT "chk_matching_rule_success_rate_bonus" CHECK ("matching_rule_profiles"."success_rate_bonus" >= 0 AND "matching_rule_profiles"."success_rate_bonus" <= 50);--> statement-breakpoint
ALTER TABLE "matching_rule_profiles" ADD CONSTRAINT "chk_matching_rule_max_candidates" CHECK ("matching_rule_profiles"."max_candidates" >= 1 AND "matching_rule_profiles"."max_candidates" <= 200);
