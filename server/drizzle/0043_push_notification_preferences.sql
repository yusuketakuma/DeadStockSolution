CREATE TABLE IF NOT EXISTS "push_notification_preferences" (
  "id" serial PRIMARY KEY NOT NULL,
  "pharmacy_id" integer NOT NULL REFERENCES "pharmacies"("id") ON DELETE cascade,
  "categories_json" jsonb NOT NULL,
  "allow_critical" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_push_notification_preferences_pharmacy"
  ON "push_notification_preferences" ("pharmacy_id");
