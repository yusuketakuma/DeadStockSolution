ALTER TABLE "activity_logs"
  ADD COLUMN IF NOT EXISTS "resource_type" text;
--> statement-breakpoint

ALTER TABLE "activity_logs"
  ADD COLUMN IF NOT EXISTS "resource_id" text;
--> statement-breakpoint

ALTER TABLE "activity_logs"
  ADD COLUMN IF NOT EXISTS "metadata_json" text;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_activity_logs_resource"
  ON "activity_logs" ("resource_type", "resource_id", "created_at");
