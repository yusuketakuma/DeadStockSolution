CREATE TABLE IF NOT EXISTS "user_request_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "request_id" integer NOT NULL,
  "author_type" varchar(32) NOT NULL,
  "author_pharmacy_id" integer,
  "message_type" varchar(32) DEFAULT 'message' NOT NULL,
  "body" text NOT NULL,
  "metadata_json" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_request_messages" ADD CONSTRAINT "user_request_messages_request_id_user_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."user_requests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_request_messages" ADD CONSTRAINT "user_request_messages_author_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("author_pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_user_request_messages_request_created" ON "user_request_messages" USING btree ("request_id","created_at");
