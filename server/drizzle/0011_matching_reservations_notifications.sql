CREATE TABLE IF NOT EXISTS "dead_stock_reservations" (
  "id" serial PRIMARY KEY NOT NULL,
  "dead_stock_item_id" integer NOT NULL,
  "proposal_id" integer NOT NULL,
  "reserved_quantity" real NOT NULL,
  "created_at" timestamp DEFAULT now(),
  CONSTRAINT "chk_dead_stock_reservation_qty" CHECK ("dead_stock_reservations"."reserved_quantity" > 0)
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dead_stock_reservations_dead_stock_item_id_dead_stock_items_id_fk'
  ) THEN
    ALTER TABLE "dead_stock_reservations"
      ADD CONSTRAINT "dead_stock_reservations_dead_stock_item_id_dead_stock_items_id_fk"
      FOREIGN KEY ("dead_stock_item_id") REFERENCES "public"."dead_stock_items"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'dead_stock_reservations_proposal_id_exchange_proposals_id_fk'
  ) THEN
    ALTER TABLE "dead_stock_reservations"
      ADD CONSTRAINT "dead_stock_reservations_proposal_id_exchange_proposals_id_fk"
      FOREIGN KEY ("proposal_id") REFERENCES "public"."exchange_proposals"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dead_stock_reservations_item" ON "dead_stock_reservations" ("dead_stock_item_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dead_stock_reservations_proposal" ON "dead_stock_reservations" ("proposal_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_dead_stock_reservations_unique" ON "dead_stock_reservations" ("proposal_id", "dead_stock_item_id");
--> statement-breakpoint
INSERT INTO "dead_stock_reservations" ("dead_stock_item_id", "proposal_id", "reserved_quantity", "created_at")
SELECT
  "epi"."dead_stock_item_id",
  "epi"."proposal_id",
  "epi"."quantity",
  now()
FROM "exchange_proposal_items" AS "epi"
INNER JOIN "exchange_proposals" AS "ep" ON "ep"."id" = "epi"."proposal_id"
WHERE "ep"."status" IN ('proposed', 'accepted_a', 'accepted_b', 'confirmed')
ON CONFLICT ("proposal_id", "dead_stock_item_id") DO NOTHING;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "match_candidate_snapshots" (
  "id" serial PRIMARY KEY NOT NULL,
  "pharmacy_id" integer NOT NULL,
  "candidate_hash" text NOT NULL,
  "candidate_count" integer DEFAULT 0 NOT NULL,
  "top_candidates_json" text NOT NULL,
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'match_candidate_snapshots_pharmacy_id_pharmacies_id_fk'
  ) THEN
    ALTER TABLE "match_candidate_snapshots"
      ADD CONSTRAINT "match_candidate_snapshots_pharmacy_id_pharmacies_id_fk"
      FOREIGN KEY ("pharmacy_id") REFERENCES "public"."pharmacies"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_match_snapshots_pharmacy_unique" ON "match_candidate_snapshots" ("pharmacy_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "match_notifications" (
  "id" serial PRIMARY KEY NOT NULL,
  "pharmacy_id" integer NOT NULL,
  "trigger_pharmacy_id" integer NOT NULL,
  "trigger_upload_type" "upload_type_enum" NOT NULL,
  "candidate_count_before" integer DEFAULT 0 NOT NULL,
  "candidate_count_after" integer DEFAULT 0 NOT NULL,
  "diff_json" text NOT NULL,
  "is_read" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'match_notifications_pharmacy_id_pharmacies_id_fk'
  ) THEN
    ALTER TABLE "match_notifications"
      ADD CONSTRAINT "match_notifications_pharmacy_id_pharmacies_id_fk"
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
    WHERE conname = 'match_notifications_trigger_pharmacy_id_pharmacies_id_fk'
  ) THEN
    ALTER TABLE "match_notifications"
      ADD CONSTRAINT "match_notifications_trigger_pharmacy_id_pharmacies_id_fk"
      FOREIGN KEY ("trigger_pharmacy_id") REFERENCES "public"."pharmacies"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_match_notifications_pharmacy_created" ON "match_notifications" ("pharmacy_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_match_notifications_unread" ON "match_notifications" ("pharmacy_id", "is_read", "created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "matching_refresh_jobs" (
  "id" serial PRIMARY KEY NOT NULL,
  "trigger_pharmacy_id" integer NOT NULL,
  "upload_type" "upload_type_enum" NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'matching_refresh_jobs_trigger_pharmacy_id_pharmacies_id_fk'
  ) THEN
    ALTER TABLE "matching_refresh_jobs"
      ADD CONSTRAINT "matching_refresh_jobs_trigger_pharmacy_id_pharmacies_id_fk"
      FOREIGN KEY ("trigger_pharmacy_id") REFERENCES "public"."pharmacies"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END
$$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_matching_refresh_jobs_created" ON "matching_refresh_jobs" ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_matching_refresh_jobs_trigger" ON "matching_refresh_jobs" ("trigger_pharmacy_id", "created_at");
