CREATE TYPE "public"."upload_job_status_enum" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "matching_rule_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"profile_name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"name_match_threshold" real DEFAULT 0.7 NOT NULL,
	"value_score_max" real DEFAULT 55 NOT NULL,
	"value_score_divisor" real DEFAULT 2500 NOT NULL,
	"balance_score_max" real DEFAULT 20 NOT NULL,
	"balance_score_diff_factor" real DEFAULT 1.5 NOT NULL,
	"distance_score_max" real DEFAULT 15 NOT NULL,
	"distance_score_divisor" real DEFAULT 8 NOT NULL,
	"distance_score_fallback" real DEFAULT 2 NOT NULL,
	"near_expiry_score_max" real DEFAULT 10 NOT NULL,
	"near_expiry_item_factor" real DEFAULT 1.5 NOT NULL,
	"near_expiry_days" integer DEFAULT 120 NOT NULL,
	"diversity_score_max" real DEFAULT 10 NOT NULL,
	"diversity_item_factor" real DEFAULT 1.5 NOT NULL,
	"favorite_bonus" real DEFAULT 15 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "chk_matching_rule_name_threshold" CHECK ("matching_rule_profiles"."name_match_threshold" >= 0 AND "matching_rule_profiles"."name_match_threshold" <= 1),
	CONSTRAINT "chk_matching_rule_value_score_max" CHECK ("matching_rule_profiles"."value_score_max" >= 0),
	CONSTRAINT "chk_matching_rule_value_score_divisor" CHECK ("matching_rule_profiles"."value_score_divisor" > 0),
	CONSTRAINT "chk_matching_rule_balance_score_max" CHECK ("matching_rule_profiles"."balance_score_max" >= 0),
	CONSTRAINT "chk_matching_rule_balance_diff_factor" CHECK ("matching_rule_profiles"."balance_score_diff_factor" >= 0),
	CONSTRAINT "chk_matching_rule_distance_score_max" CHECK ("matching_rule_profiles"."distance_score_max" >= 0),
	CONSTRAINT "chk_matching_rule_distance_score_divisor" CHECK ("matching_rule_profiles"."distance_score_divisor" > 0),
	CONSTRAINT "chk_matching_rule_distance_fallback" CHECK ("matching_rule_profiles"."distance_score_fallback" >= 0),
	CONSTRAINT "chk_matching_rule_near_expiry_score_max" CHECK ("matching_rule_profiles"."near_expiry_score_max" >= 0),
	CONSTRAINT "chk_matching_rule_near_expiry_item_factor" CHECK ("matching_rule_profiles"."near_expiry_item_factor" >= 0),
	CONSTRAINT "chk_matching_rule_near_expiry_days" CHECK ("matching_rule_profiles"."near_expiry_days" >= 1 AND "matching_rule_profiles"."near_expiry_days" <= 365),
	CONSTRAINT "chk_matching_rule_diversity_score_max" CHECK ("matching_rule_profiles"."diversity_score_max" >= 0),
	CONSTRAINT "chk_matching_rule_diversity_item_factor" CHECK ("matching_rule_profiles"."diversity_item_factor" >= 0),
	CONSTRAINT "chk_matching_rule_favorite_bonus" CHECK ("matching_rule_profiles"."favorite_bonus" >= 0),
	CONSTRAINT "chk_matching_rule_version" CHECK ("matching_rule_profiles"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "pharmacy_registration_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"pharmacy_name" text NOT NULL,
	"postal_code" text NOT NULL,
	"prefecture" text NOT NULL,
	"address" text NOT NULL,
	"phone" text NOT NULL,
	"fax" text NOT NULL,
	"license_number" text NOT NULL,
	"permit_license_number" text NOT NULL,
	"permit_pharmacy_name" text NOT NULL,
	"permit_address" text NOT NULL,
	"verdict" text NOT NULL,
	"screening_score" integer DEFAULT 0 NOT NULL,
	"screening_reasons" text NOT NULL,
	"mismatch_details_json" text,
	"created_pharmacy_id" integer,
	"registration_ip" text,
	"submitted_at" timestamp DEFAULT now(),
	"reviewed_at" timestamp DEFAULT now(),
	CONSTRAINT "chk_registration_reviews_verdict" CHECK ("pharmacy_registration_reviews"."verdict" IN ('approved', 'rejected')),
	CONSTRAINT "chk_registration_reviews_score" CHECK ("pharmacy_registration_reviews"."screening_score" >= 0 AND "pharmacy_registration_reviews"."screening_score" <= 100)
);
--> statement-breakpoint
CREATE TABLE "predictive_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"pharmacy_id" integer NOT NULL,
	"alert_type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"detail_json" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"notification_id" integer,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "chk_predictive_alerts_type" CHECK ("predictive_alerts"."alert_type" IN ('near_expiry', 'excess_stock'))
);
--> statement-breakpoint
CREATE TABLE "system_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"level" text DEFAULT 'error' NOT NULL,
	"event_type" text NOT NULL,
	"message" text NOT NULL,
	"detail_json" text,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "chk_system_events_source" CHECK ("system_events"."source" IN ('runtime_error', 'unhandled_rejection', 'uncaught_exception', 'vercel_deploy')),
	CONSTRAINT "chk_system_events_level" CHECK ("system_events"."level" IN ('info', 'warning', 'error'))
);
--> statement-breakpoint
CREATE TABLE "upload_confirm_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"pharmacy_id" integer NOT NULL,
	"upload_type" "upload_type_enum" NOT NULL,
	"original_filename" text NOT NULL,
	"idempotency_key" text,
	"file_hash" text NOT NULL,
	"header_row_index" integer NOT NULL,
	"mapping_json" text NOT NULL,
	"apply_mode" text DEFAULT 'replace' NOT NULL,
	"delete_missing" boolean DEFAULT false NOT NULL,
	"deduplicated" boolean DEFAULT false NOT NULL,
	"file_base64" text NOT NULL,
	"status" "upload_job_status_enum" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"result_json" text,
	"cancel_requested_at" timestamp,
	"canceled_at" timestamp,
	"canceled_by" integer,
	"processing_started_at" timestamp,
	"next_retry_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "chk_upload_confirm_jobs_apply_mode" CHECK ("upload_confirm_jobs"."apply_mode" IN ('replace', 'diff', 'partial')),
	CONSTRAINT "chk_upload_confirm_jobs_attempts_non_negative" CHECK ("upload_confirm_jobs"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "upload_row_issues" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" integer NOT NULL,
	"pharmacy_id" integer NOT NULL,
	"upload_type" "upload_type_enum" NOT NULL,
	"row_number" integer NOT NULL,
	"issue_code" text NOT NULL,
	"issue_message" text NOT NULL,
	"row_data_json" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "chk_upload_row_issues_row_number" CHECK ("upload_row_issues"."row_number" > 0)
);
--> statement-breakpoint
ALTER TABLE "activity_logs" ADD COLUMN "resource_type" text;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD COLUMN "resource_id" text;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD COLUMN "metadata_json" text;--> statement-breakpoint
ALTER TABLE "pharmacies" ADD COLUMN "last_timeline_viewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "requested_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "pharmacy_registration_reviews" ADD CONSTRAINT "pharmacy_registration_reviews_created_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("created_pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictive_alerts" ADD CONSTRAINT "predictive_alerts_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "predictive_alerts" ADD CONSTRAINT "predictive_alerts_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_confirm_jobs" ADD CONSTRAINT "upload_confirm_jobs_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_confirm_jobs" ADD CONSTRAINT "upload_confirm_jobs_canceled_by_pharmacies_id_fk" FOREIGN KEY ("canceled_by") REFERENCES "public"."pharmacies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_row_issues" ADD CONSTRAINT "upload_row_issues_job_id_upload_confirm_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."upload_confirm_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_row_issues" ADD CONSTRAINT "upload_row_issues_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_matching_rule_profiles_name_unique" ON "matching_rule_profiles" USING btree ("profile_name");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_matching_rule_profiles_active_unique" ON "matching_rule_profiles" USING btree ("is_active") WHERE "matching_rule_profiles"."is_active" = true;--> statement-breakpoint
CREATE INDEX "idx_matching_rule_profiles_updated_at" ON "matching_rule_profiles" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "idx_registration_reviews_submitted" ON "pharmacy_registration_reviews" USING btree ("submitted_at");--> statement-breakpoint
CREATE INDEX "idx_registration_reviews_verdict_submitted" ON "pharmacy_registration_reviews" USING btree ("verdict","submitted_at");--> statement-breakpoint
CREATE INDEX "idx_registration_reviews_created_pharmacy" ON "pharmacy_registration_reviews" USING btree ("created_pharmacy_id");--> statement-breakpoint
CREATE INDEX "idx_predictive_alerts_pharmacy_created" ON "predictive_alerts" USING btree ("pharmacy_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_predictive_alerts_unresolved" ON "predictive_alerts" USING btree ("pharmacy_id","resolved_at","created_at");--> statement-breakpoint
CREATE INDEX "idx_predictive_alerts_type_detected" ON "predictive_alerts" USING btree ("alert_type","detected_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_predictive_alerts_dedupe_unique" ON "predictive_alerts" USING btree ("pharmacy_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "idx_system_events_occurred_at" ON "system_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "idx_system_events_source_occurred_at" ON "system_events" USING btree ("source","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_system_events_level_occurred_at" ON "system_events" USING btree ("level","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_system_events_type_occurred_at" ON "system_events" USING btree ("event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_upload_confirm_jobs_pharmacy_created" ON "upload_confirm_jobs" USING btree ("pharmacy_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_upload_confirm_jobs_pharmacy_idempotency" ON "upload_confirm_jobs" USING btree ("pharmacy_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_upload_confirm_jobs_idempotency_active" ON "upload_confirm_jobs" USING btree ("pharmacy_id","idempotency_key") WHERE "upload_confirm_jobs"."idempotency_key" IS NOT NULL AND "upload_confirm_jobs"."status" IN ('pending', 'processing');--> statement-breakpoint
CREATE INDEX "idx_upload_confirm_jobs_pharmacy_file_hash_created" ON "upload_confirm_jobs" USING btree ("pharmacy_id","file_hash","created_at");--> statement-breakpoint
CREATE INDEX "idx_upload_confirm_jobs_ready" ON "upload_confirm_jobs" USING btree ("status","attempts","next_retry_at","processing_started_at","created_at");--> statement-breakpoint
CREATE INDEX "idx_upload_row_issues_job_row" ON "upload_row_issues" USING btree ("job_id","row_number","id");--> statement-breakpoint
CREATE INDEX "idx_upload_row_issues_pharmacy_created" ON "upload_row_issues" USING btree ("pharmacy_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_activity_logs_resource" ON "activity_logs" USING btree ("resource_type","resource_id","created_at");