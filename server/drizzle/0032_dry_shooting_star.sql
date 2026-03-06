CREATE TABLE IF NOT EXISTS "drug_master_source_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_key" text NOT NULL,
	"url" text NOT NULL,
	"etag" text,
	"last_modified" text,
	"content_hash" text,
	"last_checked_at" timestamp,
	"last_changed_at" timestamp,
	"metadata_json" text,
	CONSTRAINT "drug_master_source_state_source_key_unique" UNIQUE("source_key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "error_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(64) NOT NULL,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"title_ja" varchar(128) NOT NULL,
	"description_ja" text,
	"resolution_ja" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "error_codes_code_unique" UNIQUE("code"),
	CONSTRAINT "chk_error_codes_category" CHECK ("error_codes"."category" IN ('upload', 'auth', 'sync', 'system', 'openclaw')),
	CONSTRAINT "chk_error_codes_severity" CHECK ("error_codes"."severity" IN ('critical', 'error', 'warning', 'info'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "openclaw_command_whitelist" (
	"id" serial PRIMARY KEY NOT NULL,
	"command_name" varchar(64) NOT NULL,
	"category" varchar(16) NOT NULL,
	"description_ja" varchar(255),
	"is_enabled" boolean DEFAULT true NOT NULL,
	"parameters_schema" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "openclaw_command_whitelist_command_name_unique" UNIQUE("command_name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "openclaw_commands" (
	"id" serial PRIMARY KEY NOT NULL,
	"command_name" varchar(64) NOT NULL,
	"parameters" text,
	"status" varchar(16) NOT NULL,
	"result" text,
	"error_message" text,
	"openclaw_thread_id" varchar(255),
	"signature" varchar(255) NOT NULL,
	"received_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "activity_logs" ADD COLUMN IF NOT EXISTS "error_code" varchar(64);--> statement-breakpoint
ALTER TABLE "system_events" ADD COLUMN IF NOT EXISTS "error_code" varchar(64);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_source_state_source_key" ON "drug_master_source_state" USING btree ("source_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_error_codes_category" ON "error_codes" USING btree ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_error_codes_severity" ON "error_codes" USING btree ("severity");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_openclaw_commands_received_at" ON "openclaw_commands" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_openclaw_commands_status" ON "openclaw_commands" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_openclaw_commands_name" ON "openclaw_commands" USING btree ("command_name");
