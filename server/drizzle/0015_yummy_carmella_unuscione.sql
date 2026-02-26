CREATE TYPE "public"."monthly_report_status_enum" AS ENUM('success', 'failed');--> statement-breakpoint
CREATE TABLE "dead_stock_reservations" (
	"id" serial PRIMARY KEY NOT NULL,
	"dead_stock_item_id" integer NOT NULL,
	"proposal_id" integer NOT NULL,
	"reserved_quantity" real NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "chk_dead_stock_reservation_qty" CHECK ("dead_stock_reservations"."reserved_quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "exchange_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"proposal_id" integer NOT NULL,
	"from_pharmacy_id" integer NOT NULL,
	"to_pharmacy_id" integer NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "chk_exchange_feedback_rating" CHECK ("exchange_feedback"."rating" >= 1 AND "exchange_feedback"."rating" <= 5)
);
--> statement-breakpoint
CREATE TABLE "match_candidate_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"pharmacy_id" integer NOT NULL,
	"candidate_hash" text NOT NULL,
	"candidate_count" integer DEFAULT 0 NOT NULL,
	"top_candidates_json" text NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "match_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"pharmacy_id" integer NOT NULL,
	"trigger_pharmacy_id" integer NOT NULL,
	"trigger_upload_type" "upload_type_enum" NOT NULL,
	"candidate_count_before" integer DEFAULT 0 NOT NULL,
	"candidate_count_after" integer DEFAULT 0 NOT NULL,
	"diff_json" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "matching_refresh_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"trigger_pharmacy_id" integer NOT NULL,
	"upload_type" "upload_type_enum" NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"processing_started_at" timestamp,
	"next_retry_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "monthly_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"status" "monthly_report_status_enum" DEFAULT 'success' NOT NULL,
	"report_json" text NOT NULL,
	"generated_by" integer,
	"generated_at" timestamp DEFAULT now(),
	CONSTRAINT "chk_monthly_reports_month_range" CHECK ("monthly_reports"."month" >= 1 AND "monthly_reports"."month" <= 12)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"pharmacy_id" integer NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"reference_type" text,
	"reference_id" integer,
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pharmacy_trust_scores" (
	"pharmacy_id" integer PRIMARY KEY NOT NULL,
	"trust_score" numeric(5, 2) DEFAULT '60.00' NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"positive_rate" numeric(5, 2) DEFAULT '0.00' NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "proposal_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"proposal_id" integer NOT NULL,
	"author_pharmacy_id" integer NOT NULL,
	"body" text NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"read_by_recipient" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dead_stock_items" ADD COLUMN "expiration_date_iso" date;--> statement-breakpoint
ALTER TABLE "pharmacies" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pharmacy_business_hours" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "pharmacy_special_hours" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "dead_stock_reservations" ADD CONSTRAINT "dead_stock_reservations_dead_stock_item_id_dead_stock_items_id_fk" FOREIGN KEY ("dead_stock_item_id") REFERENCES "public"."dead_stock_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dead_stock_reservations" ADD CONSTRAINT "dead_stock_reservations_proposal_id_exchange_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."exchange_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_feedback" ADD CONSTRAINT "exchange_feedback_proposal_id_exchange_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."exchange_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_feedback" ADD CONSTRAINT "exchange_feedback_from_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("from_pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_feedback" ADD CONSTRAINT "exchange_feedback_to_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("to_pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_candidate_snapshots" ADD CONSTRAINT "match_candidate_snapshots_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_notifications" ADD CONSTRAINT "match_notifications_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_notifications" ADD CONSTRAINT "match_notifications_trigger_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("trigger_pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matching_refresh_jobs" ADD CONSTRAINT "matching_refresh_jobs_trigger_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("trigger_pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_reports" ADD CONSTRAINT "monthly_reports_generated_by_pharmacies_id_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."pharmacies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_trust_scores" ADD CONSTRAINT "pharmacy_trust_scores_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_comments" ADD CONSTRAINT "proposal_comments_proposal_id_exchange_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."exchange_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_comments" ADD CONSTRAINT "proposal_comments_author_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("author_pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_dead_stock_reservations_item" ON "dead_stock_reservations" USING btree ("dead_stock_item_id");--> statement-breakpoint
CREATE INDEX "idx_dead_stock_reservations_proposal" ON "dead_stock_reservations" USING btree ("proposal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_dead_stock_reservations_unique" ON "dead_stock_reservations" USING btree ("proposal_id","dead_stock_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_exchange_feedback_proposal_from_unique" ON "exchange_feedback" USING btree ("proposal_id","from_pharmacy_id");--> statement-breakpoint
CREATE INDEX "idx_exchange_feedback_target" ON "exchange_feedback" USING btree ("to_pharmacy_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_match_snapshots_pharmacy_unique" ON "match_candidate_snapshots" USING btree ("pharmacy_id");--> statement-breakpoint
CREATE INDEX "idx_match_notifications_pharmacy_created" ON "match_notifications" USING btree ("pharmacy_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_match_notifications_unread" ON "match_notifications" USING btree ("pharmacy_id","is_read","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_match_notifications_dedupe" ON "match_notifications" USING btree ("pharmacy_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "idx_matching_refresh_jobs_created" ON "matching_refresh_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_matching_refresh_jobs_trigger" ON "matching_refresh_jobs" USING btree ("trigger_pharmacy_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_matching_refresh_jobs_ready" ON "matching_refresh_jobs" USING btree ("attempts","next_retry_at","processing_started_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_monthly_reports_year_month_unique" ON "monthly_reports" USING btree ("year","month");--> statement-breakpoint
CREATE INDEX "idx_monthly_reports_generated_at" ON "monthly_reports" USING btree ("generated_at");--> statement-breakpoint
CREATE INDEX "idx_notifications_pharmacy_unread" ON "notifications" USING btree ("pharmacy_id","is_read","created_at");--> statement-breakpoint
CREATE INDEX "idx_trust_scores_updated_at" ON "pharmacy_trust_scores" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "idx_proposal_comments_proposal_created" ON "proposal_comments" USING btree ("proposal_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_proposal_comments_author" ON "proposal_comments" USING btree ("author_pharmacy_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_dead_stock_expiry_risk" ON "dead_stock_items" USING btree ("pharmacy_id","is_available","expiration_date_iso");