CREATE TYPE "public"."drug_master_revision_type_enum" AS ENUM('price_revision', 'new_listing', 'delisting', 'transition');--> statement-breakpoint
CREATE TYPE "public"."drug_master_sync_status_enum" AS ENUM('running', 'success', 'failed', 'partial');--> statement-breakpoint
CREATE TABLE "activity_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"pharmacy_id" integer,
	"action" text NOT NULL,
	"detail" text,
	"ip_address" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "drug_master" (
	"id" serial PRIMARY KEY NOT NULL,
	"yj_code" text NOT NULL,
	"drug_name" text NOT NULL,
	"generic_name" text,
	"specification" text,
	"unit" text,
	"yakka_price" real NOT NULL,
	"manufacturer" text,
	"category" text,
	"therapeutic_category" text,
	"is_listed" boolean DEFAULT true,
	"listed_date" text,
	"transition_deadline" text,
	"deleted_date" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "drug_master_yj_code_unique" UNIQUE("yj_code"),
	CONSTRAINT "chk_drug_master_yakka_price" CHECK ("drug_master"."yakka_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "drug_master_packages" (
	"id" serial PRIMARY KEY NOT NULL,
	"drug_master_id" integer NOT NULL,
	"gs1_code" text,
	"jan_code" text,
	"hot_code" text,
	"package_description" text,
	"package_quantity" real,
	"package_unit" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "drug_master_price_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"yj_code" text NOT NULL,
	"previous_price" real,
	"new_price" real,
	"revision_date" text NOT NULL,
	"revision_type" "drug_master_revision_type_enum" NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "drug_master_sync_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"sync_type" text NOT NULL,
	"source_description" text,
	"status" "drug_master_sync_status_enum" NOT NULL,
	"items_processed" integer DEFAULT 0,
	"items_added" integer DEFAULT 0,
	"items_updated" integer DEFAULT 0,
	"items_deleted" integer DEFAULT 0,
	"error_message" text,
	"started_at" timestamp DEFAULT now(),
	"completed_at" timestamp,
	"triggered_by" integer
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"pharmacy_id" integer NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pharmacy_business_hours" (
	"id" serial PRIMARY KEY NOT NULL,
	"pharmacy_id" integer NOT NULL,
	"day_of_week" integer NOT NULL,
	"open_time" text,
	"close_time" text,
	"is_closed" boolean DEFAULT false,
	"is_24_hours" boolean DEFAULT false,
	CONSTRAINT "chk_day_of_week" CHECK ("pharmacy_business_hours"."day_of_week" >= 0 AND "pharmacy_business_hours"."day_of_week" <= 6)
);
--> statement-breakpoint
ALTER TABLE "admin_message_reads" DROP CONSTRAINT "admin_message_reads_message_id_admin_messages_id_fk";
--> statement-breakpoint
ALTER TABLE "admin_message_reads" DROP CONSTRAINT "admin_message_reads_pharmacy_id_pharmacies_id_fk";
--> statement-breakpoint
ALTER TABLE "column_mapping_templates" DROP CONSTRAINT "column_mapping_templates_pharmacy_id_pharmacies_id_fk";
--> statement-breakpoint
ALTER TABLE "dead_stock_items" DROP CONSTRAINT "dead_stock_items_pharmacy_id_pharmacies_id_fk";
--> statement-breakpoint
ALTER TABLE "dead_stock_items" DROP CONSTRAINT "dead_stock_items_upload_id_uploads_id_fk";
--> statement-breakpoint
ALTER TABLE "exchange_proposal_items" DROP CONSTRAINT "exchange_proposal_items_proposal_id_exchange_proposals_id_fk";
--> statement-breakpoint
ALTER TABLE "uploads" DROP CONSTRAINT "uploads_pharmacy_id_pharmacies_id_fk";
--> statement-breakpoint
ALTER TABLE "used_medication_items" DROP CONSTRAINT "used_medication_items_pharmacy_id_pharmacies_id_fk";
--> statement-breakpoint
ALTER TABLE "used_medication_items" DROP CONSTRAINT "used_medication_items_upload_id_uploads_id_fk";
--> statement-breakpoint
ALTER TABLE "dead_stock_items" ADD COLUMN "drug_master_id" integer;--> statement-breakpoint
ALTER TABLE "used_medication_items" ADD COLUMN "drug_master_id" integer;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drug_master_packages" ADD CONSTRAINT "drug_master_packages_drug_master_id_drug_master_id_fk" FOREIGN KEY ("drug_master_id") REFERENCES "public"."drug_master"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drug_master_sync_logs" ADD CONSTRAINT "drug_master_sync_logs_triggered_by_pharmacies_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."pharmacies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_business_hours" ADD CONSTRAINT "pharmacy_business_hours_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_activity_logs_created_at" ON "activity_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_activity_logs_pharmacy_created" ON "activity_logs" USING btree ("pharmacy_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_activity_logs_action" ON "activity_logs" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_drug_master_name" ON "drug_master" USING btree ("drug_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_drug_master_generic_name" ON "drug_master" USING btree ("generic_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_drug_master_listed_name" ON "drug_master" USING btree ("is_listed","drug_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_drug_packages_drug_master_id" ON "drug_master_packages" USING btree ("drug_master_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_drug_packages_gs1" ON "drug_master_packages" USING btree ("gs1_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_drug_packages_jan" ON "drug_master_packages" USING btree ("jan_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_drug_packages_hot" ON "drug_master_packages" USING btree ("hot_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_price_history_yj_code" ON "drug_master_price_history" USING btree ("yj_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_price_history_date" ON "drug_master_price_history" USING btree ("revision_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sync_logs_started_at" ON "drug_master_sync_logs" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_password_reset_token" ON "password_reset_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_password_reset_pharmacy" ON "password_reset_tokens" USING btree ("pharmacy_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_business_hours_pharmacy" ON "pharmacy_business_hours" USING btree ("pharmacy_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_business_hours_pharmacy_day" ON "pharmacy_business_hours" USING btree ("pharmacy_id","day_of_week");--> statement-breakpoint
ALTER TABLE "admin_message_reads" ADD CONSTRAINT "admin_message_reads_message_id_admin_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."admin_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_message_reads" ADD CONSTRAINT "admin_message_reads_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "column_mapping_templates" ADD CONSTRAINT "column_mapping_templates_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dead_stock_items" ADD CONSTRAINT "dead_stock_items_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dead_stock_items" ADD CONSTRAINT "dead_stock_items_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_proposal_items" ADD CONSTRAINT "exchange_proposal_items_proposal_id_exchange_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."exchange_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "used_medication_items" ADD CONSTRAINT "used_medication_items_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "used_medication_items" ADD CONSTRAINT "used_medication_items_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dead_stock_drug_master_id" ON "dead_stock_items" USING btree ("drug_master_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_exchange_history_proposal" ON "exchange_history" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_used_med_drug_master_id" ON "used_medication_items" USING btree ("drug_master_id");--> statement-breakpoint
ALTER TABLE "dead_stock_items" ADD CONSTRAINT "chk_dead_stock_quantity" CHECK ("dead_stock_items"."quantity" > 0);--> statement-breakpoint
ALTER TABLE "dead_stock_items" ADD CONSTRAINT "chk_dead_stock_yakka_price" CHECK ("dead_stock_items"."yakka_unit_price" IS NULL OR "dead_stock_items"."yakka_unit_price" >= 0);--> statement-breakpoint
ALTER TABLE "exchange_proposal_items" ADD CONSTRAINT "chk_exchange_item_quantity" CHECK ("exchange_proposal_items"."quantity" > 0);--> statement-breakpoint
ALTER TABLE "pharmacies" ADD CONSTRAINT "chk_latitude" CHECK ("pharmacies"."latitude" IS NULL OR ("pharmacies"."latitude" >= -90 AND "pharmacies"."latitude" <= 90));--> statement-breakpoint
ALTER TABLE "pharmacies" ADD CONSTRAINT "chk_longitude" CHECK ("pharmacies"."longitude" IS NULL OR ("pharmacies"."longitude" >= -180 AND "pharmacies"."longitude" <= 180));--> statement-breakpoint
ALTER TABLE "used_medication_items" ADD CONSTRAINT "chk_used_med_yakka_price" CHECK ("used_medication_items"."yakka_unit_price" IS NULL OR "used_medication_items"."yakka_unit_price" >= 0);