ALTER TABLE "pharmacies" ADD COLUMN IF NOT EXISTS "verification_status" text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "pharmacies" ADD COLUMN IF NOT EXISTS "verification_request_id" integer;--> statement-breakpoint
ALTER TABLE "pharmacies" ADD COLUMN IF NOT EXISTS "verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "pharmacies" ADD COLUMN IF NOT EXISTS "rejection_reason" text;
