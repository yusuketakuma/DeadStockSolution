ALTER TABLE "user_requests"
  ADD COLUMN IF NOT EXISTS "category" varchar(32) DEFAULT 'improvement' NOT NULL,
  ADD COLUMN IF NOT EXISTS "priority" varchar(16) DEFAULT 'normal' NOT NULL,
  ADD COLUMN IF NOT EXISTS "close_reason" varchar(32),
  ADD COLUMN IF NOT EXISTS "assigned_admin_id" integer,
  ADD COLUMN IF NOT EXISTS "requester_last_viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN IF NOT EXISTS "admin_last_viewed_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "latest_user_message_at" timestamp with time zone DEFAULT now() NOT NULL,
  ADD COLUMN IF NOT EXISTS "latest_staff_message_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "closed_at" timestamp with time zone;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_requests" ADD CONSTRAINT "user_requests_assigned_admin_id_pharmacies_id_fk" FOREIGN KEY ("assigned_admin_id") REFERENCES "public"."pharmacies"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
UPDATE "user_requests"
SET
  "requester_last_viewed_at" = COALESCE("requester_last_viewed_at", "updated_at", "created_at", now()),
  "latest_user_message_at" = COALESCE("latest_user_message_at", "updated_at", "created_at", now())
WHERE true;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_requests_category_created" ON "user_requests" USING btree ("category","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_requests_priority_created" ON "user_requests" USING btree ("priority","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_requests_assigned_admin_created" ON "user_requests" USING btree ("assigned_admin_id","created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "request_message_attachments" (
  "id" serial PRIMARY KEY NOT NULL,
  "message_id" integer NOT NULL,
  "file_name" varchar(255) NOT NULL,
  "mime_type" varchar(128) NOT NULL,
  "file_size" integer NOT NULL,
  "content_base64" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "request_message_attachments" ADD CONSTRAINT "request_message_attachments_message_id_openclaw_request_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."openclaw_request_messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_request_message_attachments_message_created" ON "request_message_attachments" USING btree ("message_id","created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_request_internal_notes" (
  "id" serial PRIMARY KEY NOT NULL,
  "request_id" integer NOT NULL,
  "author_admin_id" integer,
  "body" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_request_internal_notes" ADD CONSTRAINT "user_request_internal_notes_request_id_user_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."user_requests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_request_internal_notes" ADD CONSTRAINT "user_request_internal_notes_author_admin_id_pharmacies_id_fk" FOREIGN KEY ("author_admin_id") REFERENCES "public"."pharmacies"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_request_internal_notes_request_created" ON "user_request_internal_notes" USING btree ("request_id","created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "direct_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "from_pharmacy_id" integer NOT NULL,
  "to_pharmacy_id" integer NOT NULL,
  "body" text NOT NULL,
  "is_read" boolean DEFAULT false NOT NULL,
  "read_at" timestamp with time zone,
  "is_deleted" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_from_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("from_pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_to_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("to_pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dm_to_pharmacy" ON "direct_messages" USING btree ("to_pharmacy_id","is_read");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dm_from_pharmacy" ON "direct_messages" USING btree ("from_pharmacy_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "direct_message_attachments" (
  "id" serial PRIMARY KEY NOT NULL,
  "message_id" integer NOT NULL,
  "file_name" varchar(255) NOT NULL,
  "mime_type" varchar(128) NOT NULL,
  "file_size" integer NOT NULL,
  "content_base64" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "direct_message_attachments" ADD CONSTRAINT "direct_message_attachments_message_id_direct_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."direct_messages"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_direct_message_attachments_message_created" ON "direct_message_attachments" USING btree ("message_id","created_at");
