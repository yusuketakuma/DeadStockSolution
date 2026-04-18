CREATE TABLE IF NOT EXISTS "upload_row_issues" (
  "id" serial PRIMARY KEY NOT NULL,
  "job_id" integer NOT NULL REFERENCES "upload_confirm_jobs"("id") ON DELETE CASCADE,
  "pharmacy_id" integer NOT NULL REFERENCES "pharmacies"("id") ON DELETE CASCADE,
  "upload_type" "upload_type_enum" NOT NULL,
  "row_number" integer NOT NULL,
  "issue_code" text NOT NULL,
  "issue_message" text NOT NULL,
  "row_data_json" text,
  "created_at" timestamp DEFAULT now(),
  CONSTRAINT "chk_upload_row_issues_row_number" CHECK ("row_number" > 0)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_upload_row_issues_job_row"
  ON "upload_row_issues" ("job_id", "row_number", "id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_upload_row_issues_pharmacy_created"
  ON "upload_row_issues" ("pharmacy_id", "created_at");
