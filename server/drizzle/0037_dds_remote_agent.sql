CREATE TABLE IF NOT EXISTS "dds_bootstrap_tokens" (
  "id" serial PRIMARY KEY NOT NULL,
  "environment" varchar(32) NOT NULL,
  "token_hash" varchar(128) NOT NULL,
  "requested_by_admin_id" integer,
  "expires_at" timestamp NOT NULL,
  "consumed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dds_agent_connections" (
  "id" serial PRIMARY KEY NOT NULL,
  "agent_id" varchar(128) NOT NULL,
  "agent_name" varchar(128),
  "device_label" varchar(128),
  "environment" varchar(32) NOT NULL,
  "control_token_hash" varchar(128) NOT NULL,
  "status" varchar(24) DEFAULT 'active' NOT NULL,
  "metadata_json" jsonb,
  "last_heartbeat_at" timestamp,
  "last_seen_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "registered_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dds_work_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "request_id" integer,
  "pharmacy_id" integer NOT NULL,
  "type" varchar(32) DEFAULT 'product_update' NOT NULL,
  "work_item_type" varchar(32) DEFAULT 'product_update' NOT NULL,
  "workflow_status" varchar(32) DEFAULT 'queued' NOT NULL,
  "request_text" text,
  "latest_summary" text,
  "result_summary" text,
  "last_question" text,
  "branch_name" text,
  "pr_url" text,
  "pr_number" integer,
  "last_error" text,
  "metadata_json" text,
  "context_json" jsonb,
  "source" varchar(64),
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "dds_agent_jobs" (
  "id" serial PRIMARY KEY NOT NULL,
  "agent_id" varchar(128),
  "environment" varchar(32) NOT NULL,
  "work_item_id" integer,
  "job_type" varchar(64) NOT NULL,
  "payload" jsonb,
  "payload_json" jsonb,
  "status" varchar(24) DEFAULT 'pending' NOT NULL,
  "result" jsonb,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "lease_token_hash" varchar(128),
  "lease_expires_at" timestamp,
  "leased_at" timestamp,
  "completed_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dds_bootstrap_tokens" ADD CONSTRAINT "dds_bootstrap_tokens_requested_by_admin_id_pharmacies_id_fk" FOREIGN KEY ("requested_by_admin_id") REFERENCES "public"."pharmacies"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dds_agent_connections" ADD CONSTRAINT "uq_dds_agent_connections_agent_env" UNIQUE ("agent_id","environment");
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dds_work_items" ADD CONSTRAINT "dds_work_items_request_id_user_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."user_requests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dds_work_items" ADD CONSTRAINT "dds_work_items_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "dds_agent_jobs" ADD CONSTRAINT "dds_agent_jobs_work_item_id_dds_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."dds_work_items"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_dds_work_items_request_id" ON "dds_work_items" USING btree ("request_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dds_work_items_pharmacy_status" ON "dds_work_items" USING btree ("pharmacy_id","workflow_status","updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dds_agent_jobs_agent_status" ON "dds_agent_jobs" USING btree ("agent_id","status","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dds_agent_jobs_work_item" ON "dds_agent_jobs" USING btree ("work_item_id");
