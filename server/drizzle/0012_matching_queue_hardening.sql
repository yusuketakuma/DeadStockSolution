ALTER TABLE "matching_refresh_jobs"
  ADD COLUMN IF NOT EXISTS "processing_started_at" timestamp;
--> statement-breakpoint
ALTER TABLE "matching_refresh_jobs"
  ADD COLUMN IF NOT EXISTS "next_retry_at" timestamp;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_matching_refresh_jobs_ready"
  ON "matching_refresh_jobs" ("attempts", "next_retry_at", "processing_started_at", "created_at");
--> statement-breakpoint

ALTER TABLE "match_notifications"
  ADD COLUMN IF NOT EXISTS "dedupe_key" text;
--> statement-breakpoint
UPDATE "match_notifications"
SET "dedupe_key" = md5(concat_ws(
  ':',
  "trigger_pharmacy_id"::text,
  "trigger_upload_type"::text,
  "candidate_count_after"::text,
  "diff_json"
))
WHERE "dedupe_key" IS NULL;
--> statement-breakpoint
DELETE FROM "match_notifications" AS "older"
USING "match_notifications" AS "newer"
WHERE
  "older"."pharmacy_id" = "newer"."pharmacy_id"
  AND "older"."dedupe_key" = "newer"."dedupe_key"
  AND "older"."id" < "newer"."id";
--> statement-breakpoint
ALTER TABLE "match_notifications"
  ALTER COLUMN "dedupe_key" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_match_notifications_dedupe"
  ON "match_notifications" ("pharmacy_id", "dedupe_key");
