ALTER TABLE "upload_confirm_jobs"
  ADD COLUMN IF NOT EXISTS "idempotency_key" text;
--> statement-breakpoint

ALTER TABLE "upload_confirm_jobs"
  ADD COLUMN IF NOT EXISTS "file_hash" text;
--> statement-breakpoint

UPDATE "upload_confirm_jobs"
SET "file_hash" = md5(COALESCE("file_base64", '') || ':' || "id"::text)
WHERE "file_hash" IS NULL;
--> statement-breakpoint

ALTER TABLE "upload_confirm_jobs"
  ALTER COLUMN "file_hash" SET NOT NULL;
--> statement-breakpoint

ALTER TABLE "upload_confirm_jobs"
  ADD COLUMN IF NOT EXISTS "deduplicated" boolean DEFAULT false NOT NULL;
--> statement-breakpoint

ALTER TABLE "upload_confirm_jobs"
  ADD COLUMN IF NOT EXISTS "cancel_requested_at" timestamp;
--> statement-breakpoint

ALTER TABLE "upload_confirm_jobs"
  ADD COLUMN IF NOT EXISTS "canceled_at" timestamp;
--> statement-breakpoint

ALTER TABLE "upload_confirm_jobs"
  ADD COLUMN IF NOT EXISTS "canceled_by" integer;
--> statement-breakpoint

DO $$
BEGIN
  ALTER TABLE "upload_confirm_jobs"
    ADD CONSTRAINT "fk_upload_confirm_jobs_canceled_by"
    FOREIGN KEY ("canceled_by") REFERENCES "pharmacies"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN null;
END
$$;
--> statement-breakpoint

ALTER TABLE "upload_confirm_jobs"
  DROP CONSTRAINT IF EXISTS "chk_upload_confirm_jobs_apply_mode";
--> statement-breakpoint

ALTER TABLE "upload_confirm_jobs"
  ADD CONSTRAINT "chk_upload_confirm_jobs_apply_mode"
  CHECK ("apply_mode" IN ('replace', 'diff', 'partial'));
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_upload_confirm_jobs_pharmacy_idempotency"
  ON "upload_confirm_jobs" ("pharmacy_id", "idempotency_key");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_upload_confirm_jobs_pharmacy_file_hash_created"
  ON "upload_confirm_jobs" ("pharmacy_id", "file_hash", "created_at");
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_upload_confirm_jobs_idempotency_active"
  ON "upload_confirm_jobs" ("pharmacy_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL
    AND "status" IN ('pending', 'processing');
