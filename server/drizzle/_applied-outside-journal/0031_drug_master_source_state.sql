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
CREATE UNIQUE INDEX IF NOT EXISTS "idx_source_state_source_key" ON "drug_master_source_state" USING btree ("source_key");
