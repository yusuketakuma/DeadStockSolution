CREATE TYPE "public"."admin_message_target_type_enum" AS ENUM('all', 'pharmacy');--> statement-breakpoint
CREATE TYPE "public"."exchange_status_enum" AS ENUM('proposed', 'accepted_a', 'accepted_b', 'confirmed', 'rejected', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."upload_type_enum" AS ENUM('dead_stock', 'used_medication');--> statement-breakpoint
CREATE TABLE "admin_message_reads" (
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" integer NOT NULL,
	"pharmacy_id" integer NOT NULL,
	"read_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "admin_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"sender_admin_id" integer NOT NULL,
	"target_type" "admin_message_target_type_enum" DEFAULT 'all' NOT NULL,
	"target_pharmacy_id" integer,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"action_path" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "column_mapping_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"pharmacy_id" integer NOT NULL,
	"upload_type" "upload_type_enum" NOT NULL,
	"header_hash" text NOT NULL,
	"mapping" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "dead_stock_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"pharmacy_id" integer NOT NULL,
	"upload_id" integer NOT NULL,
	"drug_code" text,
	"drug_name" text NOT NULL,
	"quantity" real NOT NULL,
	"unit" text,
	"yakka_unit_price" real,
	"yakka_total" real,
	"expiration_date" text,
	"lot_number" text,
	"is_available" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "exchange_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"proposal_id" integer NOT NULL,
	"pharmacy_a_id" integer NOT NULL,
	"pharmacy_b_id" integer NOT NULL,
	"total_value" real,
	"completed_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "exchange_proposal_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"proposal_id" integer NOT NULL,
	"dead_stock_item_id" integer NOT NULL,
	"from_pharmacy_id" integer NOT NULL,
	"to_pharmacy_id" integer NOT NULL,
	"quantity" real NOT NULL,
	"yakka_value" real
);
--> statement-breakpoint
CREATE TABLE "exchange_proposals" (
	"id" serial PRIMARY KEY NOT NULL,
	"pharmacy_a_id" integer NOT NULL,
	"pharmacy_b_id" integer NOT NULL,
	"status" "exchange_status_enum" DEFAULT 'proposed' NOT NULL,
	"total_value_a" real,
	"total_value_b" real,
	"value_difference" real,
	"proposed_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "pharmacies" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"postal_code" text NOT NULL,
	"address" text NOT NULL,
	"phone" text NOT NULL,
	"fax" text NOT NULL,
	"license_number" text NOT NULL,
	"prefecture" text NOT NULL,
	"latitude" real,
	"longitude" real,
	"is_admin" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "pharmacies_email_unique" UNIQUE("email"),
	CONSTRAINT "pharmacies_license_number_unique" UNIQUE("license_number")
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" serial PRIMARY KEY NOT NULL,
	"pharmacy_id" integer NOT NULL,
	"upload_type" "upload_type_enum" NOT NULL,
	"original_filename" text NOT NULL,
	"column_mapping" text,
	"row_count" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "used_medication_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"pharmacy_id" integer NOT NULL,
	"upload_id" integer NOT NULL,
	"drug_code" text,
	"drug_name" text NOT NULL,
	"monthly_usage" real,
	"unit" text,
	"yakka_unit_price" real,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "admin_message_reads" ADD CONSTRAINT "admin_message_reads_message_id_admin_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."admin_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_message_reads" ADD CONSTRAINT "admin_message_reads_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_messages" ADD CONSTRAINT "admin_messages_sender_admin_id_pharmacies_id_fk" FOREIGN KEY ("sender_admin_id") REFERENCES "public"."pharmacies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_messages" ADD CONSTRAINT "admin_messages_target_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("target_pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "column_mapping_templates" ADD CONSTRAINT "column_mapping_templates_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dead_stock_items" ADD CONSTRAINT "dead_stock_items_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dead_stock_items" ADD CONSTRAINT "dead_stock_items_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_history" ADD CONSTRAINT "exchange_history_proposal_id_exchange_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."exchange_proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_history" ADD CONSTRAINT "exchange_history_pharmacy_a_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_a_id") REFERENCES "public"."pharmacies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_history" ADD CONSTRAINT "exchange_history_pharmacy_b_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_b_id") REFERENCES "public"."pharmacies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_proposal_items" ADD CONSTRAINT "exchange_proposal_items_proposal_id_exchange_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."exchange_proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_proposal_items" ADD CONSTRAINT "exchange_proposal_items_dead_stock_item_id_dead_stock_items_id_fk" FOREIGN KEY ("dead_stock_item_id") REFERENCES "public"."dead_stock_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_proposal_items" ADD CONSTRAINT "exchange_proposal_items_from_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("from_pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_proposal_items" ADD CONSTRAINT "exchange_proposal_items_to_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("to_pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_proposals" ADD CONSTRAINT "exchange_proposals_pharmacy_a_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_a_id") REFERENCES "public"."pharmacies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exchange_proposals" ADD CONSTRAINT "exchange_proposals_pharmacy_b_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_b_id") REFERENCES "public"."pharmacies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "used_medication_items" ADD CONSTRAINT "used_medication_items_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "used_medication_items" ADD CONSTRAINT "used_medication_items_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_admin_message_reads_unique" ON "admin_message_reads" USING btree ("message_id","pharmacy_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_admin_messages_target" ON "admin_messages" USING btree ("target_type","target_pharmacy_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_mapping_templates_pharmacy_type_hash" ON "column_mapping_templates" USING btree ("pharmacy_id","upload_type","header_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dead_stock_pharmacy_available_created" ON "dead_stock_items" USING btree ("pharmacy_id","is_available","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dead_stock_available_name" ON "dead_stock_items" USING btree ("is_available","drug_name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_exchange_history_a_completed" ON "exchange_history" USING btree ("pharmacy_a_id","completed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_exchange_history_b_completed" ON "exchange_history" USING btree ("pharmacy_b_id","completed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_exchange_items_proposal" ON "exchange_proposal_items" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_exchange_proposals_a_proposed" ON "exchange_proposals" USING btree ("pharmacy_a_id","proposed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_exchange_proposals_b_proposed" ON "exchange_proposals" USING btree ("pharmacy_b_id","proposed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_exchange_proposals_status_proposed" ON "exchange_proposals" USING btree ("status","proposed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_uploads_pharmacy_type_created" ON "uploads" USING btree ("pharmacy_id","upload_type","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_used_medication_pharmacy_created" ON "used_medication_items" USING btree ("pharmacy_id","created_at");