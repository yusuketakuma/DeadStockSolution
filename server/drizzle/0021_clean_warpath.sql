CREATE TYPE "public"."upload_job_status_enum" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "upload_confirm_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"pharmacy_id" integer NOT NULL,
	"upload_type" "upload_type_enum" NOT NULL,
	"original_filename" text NOT NULL,
	"header_row_index" integer NOT NULL,
	"mapping_json" text NOT NULL,
	"apply_mode" text DEFAULT 'replace' NOT NULL,
	"delete_missing" boolean DEFAULT false NOT NULL,
	"file_base64" text NOT NULL,
	"status" "upload_job_status_enum" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"result_json" text,
	"processing_started_at" timestamp,
	"next_retry_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "chk_upload_confirm_jobs_apply_mode" CHECK ("upload_confirm_jobs"."apply_mode" IN ('replace', 'diff')),
	CONSTRAINT "chk_upload_confirm_jobs_attempts_non_negative" CHECK ("upload_confirm_jobs"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "pharmacies" ADD COLUMN "last_timeline_viewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "requested_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "upload_confirm_jobs" ADD CONSTRAINT "upload_confirm_jobs_pharmacy_id_pharmacies_id_fk" FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_upload_confirm_jobs_pharmacy_created" ON "upload_confirm_jobs" USING btree ("pharmacy_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_upload_confirm_jobs_ready" ON "upload_confirm_jobs" USING btree ("status","attempts","next_retry_at","processing_started_at","created_at");