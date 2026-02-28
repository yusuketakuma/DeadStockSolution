ALTER TABLE "uploads"
  ADD COLUMN IF NOT EXISTS "requested_at" timestamp;
--> statement-breakpoint

UPDATE "uploads"
SET "requested_at" = COALESCE("created_at", now())
WHERE "requested_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "uploads"
  ALTER COLUMN "requested_at" SET DEFAULT now();
--> statement-breakpoint

ALTER TABLE "uploads"
  ALTER COLUMN "requested_at" SET NOT NULL;
