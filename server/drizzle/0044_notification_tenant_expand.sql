CREATE TABLE IF NOT EXISTS "tenants" (
  "id" serial PRIMARY KEY,
  "name" text NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

INSERT INTO "tenants" ("id", "name", "slug", "created_at", "updated_at")
SELECT
  "id",
  COALESCE(NULLIF("name", ''), 'Pharmacy ' || "id"::text),
  'pharmacy-' || "id"::text,
  now(),
  now()
FROM "pharmacies"
ON CONFLICT ("id") DO NOTHING;

SELECT setval(
  pg_get_serial_sequence('"tenants"', 'id'),
  GREATEST((SELECT COALESCE(MAX("id"), 1) FROM "tenants"), 1),
  true
);

CREATE OR REPLACE FUNCTION "sync_pharmacy_tenant"()
RETURNS trigger AS $$
BEGIN
  INSERT INTO "tenants" ("id", "name", "slug", "created_at", "updated_at")
  VALUES (
    NEW."id",
    COALESCE(NULLIF(NEW."name", ''), 'Pharmacy ' || NEW."id"::text),
    'pharmacy-' || NEW."id"::text,
    now(),
    now()
  )
  ON CONFLICT ("id") DO UPDATE
  SET
    "name" = EXCLUDED."name",
    "updated_at" = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "sync_pharmacy_tenant" ON "pharmacies";
CREATE TRIGGER "sync_pharmacy_tenant"
AFTER INSERT OR UPDATE OF "name" ON "pharmacies"
FOR EACH ROW
EXECUTE FUNCTION "sync_pharmacy_tenant"();

ALTER TABLE "notifications" ADD COLUMN IF NOT EXISTS "tenant_id" integer;
UPDATE "notifications" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL;

DO $$
BEGIN
  ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "idx_notifications_tenant_created"
  ON "notifications" ("tenant_id", "created_at");

ALTER TABLE "match_notifications" ADD COLUMN IF NOT EXISTS "tenant_id" integer;
UPDATE "match_notifications" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL;

DO $$
BEGIN
  ALTER TABLE "match_notifications"
    ADD CONSTRAINT "match_notifications_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "idx_match_notifications_tenant_created"
  ON "match_notifications" ("tenant_id", "created_at");

ALTER TABLE "notification_group_states" ADD COLUMN IF NOT EXISTS "tenant_id" integer;
UPDATE "notification_group_states" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL;

DO $$
BEGIN
  ALTER TABLE "notification_group_states"
    ADD CONSTRAINT "notification_group_states_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "idx_notification_group_state_tenant"
  ON "notification_group_states" ("tenant_id", "updated_at");

ALTER TABLE "push_subscriptions" ADD COLUMN IF NOT EXISTS "tenant_id" integer;
UPDATE "push_subscriptions" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL;

DO $$
BEGIN
  ALTER TABLE "push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "idx_push_subscriptions_tenant"
  ON "push_subscriptions" ("tenant_id");

ALTER TABLE "match_candidate_snapshots" ADD COLUMN IF NOT EXISTS "tenant_id" integer;
UPDATE "match_candidate_snapshots" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL;

DO $$
BEGIN
  ALTER TABLE "match_candidate_snapshots"
    ADD CONSTRAINT "match_candidate_snapshots_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "idx_match_snapshots_tenant_updated"
  ON "match_candidate_snapshots" ("tenant_id", "updated_at");

ALTER TABLE "predictive_alerts" ADD COLUMN IF NOT EXISTS "tenant_id" integer;
UPDATE "predictive_alerts" SET "tenant_id" = "pharmacy_id" WHERE "tenant_id" IS NULL;

DO $$
BEGIN
  ALTER TABLE "predictive_alerts"
    ADD CONSTRAINT "predictive_alerts_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "idx_predictive_alerts_tenant_created"
  ON "predictive_alerts" ("tenant_id", "created_at");
