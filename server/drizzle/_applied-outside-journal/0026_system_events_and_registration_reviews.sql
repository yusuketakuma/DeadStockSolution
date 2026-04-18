CREATE TABLE IF NOT EXISTS "system_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "source" text NOT NULL,
  "level" text NOT NULL DEFAULT 'error',
  "event_type" text NOT NULL,
  "message" text NOT NULL,
  "detail_json" text,
  "occurred_at" timestamp DEFAULT now() NOT NULL,
  "created_at" timestamp DEFAULT now(),
  CONSTRAINT "chk_system_events_source" CHECK ("source" IN ('runtime_error', 'unhandled_rejection', 'uncaught_exception', 'vercel_deploy')),
  CONSTRAINT "chk_system_events_level" CHECK ("level" IN ('info', 'warning', 'error'))
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_system_events_occurred_at"
  ON "system_events" ("occurred_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_system_events_source_occurred_at"
  ON "system_events" ("source", "occurred_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_system_events_level_occurred_at"
  ON "system_events" ("level", "occurred_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_system_events_type_occurred_at"
  ON "system_events" ("event_type", "occurred_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "pharmacy_registration_reviews" (
  "id" serial PRIMARY KEY NOT NULL,
  "email" text NOT NULL,
  "pharmacy_name" text NOT NULL,
  "postal_code" text NOT NULL,
  "prefecture" text NOT NULL,
  "address" text NOT NULL,
  "phone" text NOT NULL,
  "fax" text NOT NULL,
  "license_number" text NOT NULL,
  "permit_license_number" text NOT NULL,
  "permit_pharmacy_name" text NOT NULL,
  "permit_address" text NOT NULL,
  "verdict" text NOT NULL,
  "screening_score" integer NOT NULL DEFAULT 0,
  "screening_reasons" text NOT NULL,
  "mismatch_details_json" text,
  "created_pharmacy_id" integer,
  "registration_ip" text,
  "submitted_at" timestamp DEFAULT now(),
  "reviewed_at" timestamp DEFAULT now(),
  CONSTRAINT "chk_registration_reviews_verdict" CHECK ("verdict" IN ('approved', 'rejected')),
  CONSTRAINT "chk_registration_reviews_score" CHECK ("screening_score" >= 0 AND "screening_score" <= 100)
);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pharmacy_registration_reviews_created_pharmacy_id_pharmacies_id_fk'
  ) THEN
    ALTER TABLE "pharmacy_registration_reviews"
      ADD CONSTRAINT "pharmacy_registration_reviews_created_pharmacy_id_pharmacies_id_fk"
      FOREIGN KEY ("created_pharmacy_id") REFERENCES "public"."pharmacies"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END
$$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_registration_reviews_submitted"
  ON "pharmacy_registration_reviews" ("submitted_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_registration_reviews_verdict_submitted"
  ON "pharmacy_registration_reviews" ("verdict", "submitted_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_registration_reviews_created_pharmacy"
  ON "pharmacy_registration_reviews" ("created_pharmacy_id");
