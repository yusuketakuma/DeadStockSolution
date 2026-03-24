CREATE TABLE IF NOT EXISTS "openclaw_work_items" (
  "id" serial PRIMARY KEY NOT NULL,
  "request_id" integer NOT NULL,
  "pharmacy_id" integer NOT NULL,
  "work_item_type" varchar(32) DEFAULT 'user_report' NOT NULL,
  "workflow_status" varchar(32) DEFAULT 'queued' NOT NULL,
  "latest_summary" text,
  "last_question" text,
  "branch_name" text,
  "pr_url" text,
  "pr_number" integer,
  "last_error" text,
  "metadata_json" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "openclaw_request_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "request_id" integer NOT NULL,
  "pharmacy_id" integer NOT NULL,
  "event_type" varchar(64) NOT NULL,
  "from_status" varchar(32),
  "to_status" varchar(32),
  "thread_id" text,
  "summary" text,
  "note" text,
  "metadata_json" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "openclaw_retry_jobs" (
  "id" serial PRIMARY KEY NOT NULL,
  "request_id" integer NOT NULL,
  "pharmacy_id" integer NOT NULL,
  "status" varchar(24) DEFAULT 'pending' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "max_attempts" integer DEFAULT 3 NOT NULL,
  "next_retry_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_attempt_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "last_error" text,
  "trigger_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "openclaw_request_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "request_id" integer NOT NULL,
  "author_type" varchar(32) NOT NULL,
  "message_type" varchar(32) DEFAULT 'message' NOT NULL,
  "body" text NOT NULL,
  "metadata_json" text,
  "created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "openclaw_work_items" ADD CONSTRAINT "openclaw_work_items_request_id_user_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."user_requests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "openclaw_work_items" ADD CONSTRAINT "openclaw_work_items_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "openclaw_request_events" ADD CONSTRAINT "openclaw_request_events_request_id_user_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."user_requests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "openclaw_request_events" ADD CONSTRAINT "openclaw_request_events_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "openclaw_retry_jobs" ADD CONSTRAINT "openclaw_retry_jobs_request_id_user_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."user_requests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "openclaw_retry_jobs" ADD CONSTRAINT "openclaw_retry_jobs_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "openclaw_request_messages" ADD CONSTRAINT "openclaw_request_messages_request_id_user_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."user_requests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_openclaw_work_items_request_unique" ON "openclaw_work_items" USING btree ("request_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_openclaw_work_items_pharmacy_status" ON "openclaw_work_items" USING btree ("pharmacy_id","workflow_status","updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_openclaw_work_items_status_updated" ON "openclaw_work_items" USING btree ("workflow_status","updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_openclaw_request_events_request_created" ON "openclaw_request_events" USING btree ("request_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_openclaw_request_events_pharmacy_created" ON "openclaw_request_events" USING btree ("pharmacy_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_openclaw_request_events_type_created" ON "openclaw_request_events" USING btree ("event_type","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_openclaw_retry_jobs_request_id" ON "openclaw_retry_jobs" USING btree ("request_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_openclaw_retry_jobs_status_next_retry" ON "openclaw_retry_jobs" USING btree ("status","next_retry_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_openclaw_retry_jobs_pharmacy_created" ON "openclaw_retry_jobs" USING btree ("pharmacy_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_openclaw_request_messages_request_created" ON "openclaw_request_messages" USING btree ("request_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_openclaw_request_messages_request_author" ON "openclaw_request_messages" USING btree ("request_id","author_type","created_at");
