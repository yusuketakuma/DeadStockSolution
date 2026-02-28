DO $$
BEGIN
  CREATE TYPE "upload_job_status_enum" AS ENUM ('pending', 'processing', 'completed', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END
$$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "upload_confirm_jobs" (
  "id" serial PRIMARY KEY NOT NULL,
  "pharmacy_id" integer NOT NULL REFERENCES "pharmacies"("id") ON DELETE CASCADE,
  "upload_type" "upload_type_enum" NOT NULL,
  "original_filename" text NOT NULL,
  "header_row_index" integer NOT NULL,
  "mapping_json" text NOT NULL,
  "apply_mode" text DEFAULT 'replace' NOT NULL CHECK ("apply_mode" IN ('replace', 'diff')),
  "delete_missing" boolean DEFAULT false NOT NULL,
  "file_base64" text NOT NULL,
  "status" "upload_job_status_enum" DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL CHECK ("attempts" >= 0),
  "last_error" text,
  "result_json" text,
  "processing_started_at" timestamp,
  "next_retry_at" timestamp,
  "completed_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_upload_confirm_jobs_pharmacy_created"
  ON "upload_confirm_jobs" ("pharmacy_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_upload_confirm_jobs_ready"
  ON "upload_confirm_jobs" ("status", "attempts", "next_retry_at", "processing_started_at", "created_at");
