CREATE TABLE IF NOT EXISTS "predictive_alerts" (
  "id" serial PRIMARY KEY NOT NULL,
  "pharmacy_id" integer NOT NULL,
  "alert_type" text NOT NULL,
  "title" text NOT NULL,
  "message" text NOT NULL,
  "detail_json" text NOT NULL,
  "dedupe_key" text NOT NULL,
  "notification_id" integer,
  "detected_at" timestamp DEFAULT now() NOT NULL,
  "resolved_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  CONSTRAINT "chk_predictive_alerts_type" CHECK ("alert_type" IN ('near_expiry', 'excess_stock'))
);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'predictive_alerts_pharmacy_id_pharmacies_id_fk'
  ) THEN
    ALTER TABLE "predictive_alerts"
      ADD CONSTRAINT "predictive_alerts_pharmacy_id_pharmacies_id_fk"
      FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'predictive_alerts_notification_id_notifications_id_fk'
  ) THEN
    ALTER TABLE "predictive_alerts"
      ADD CONSTRAINT "predictive_alerts_notification_id_notifications_id_fk"
      FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END
$$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_predictive_alerts_pharmacy_created"
  ON "predictive_alerts" ("pharmacy_id", "created_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_predictive_alerts_unresolved"
  ON "predictive_alerts" ("pharmacy_id", "resolved_at", "created_at");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_predictive_alerts_type_detected"
  ON "predictive_alerts" ("alert_type", "detected_at");
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_predictive_alerts_dedupe_unique"
  ON "predictive_alerts" ("pharmacy_id", "dedupe_key");
