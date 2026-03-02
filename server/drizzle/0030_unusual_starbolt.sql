ALTER TABLE "pharmacies" ALTER COLUMN "verification_status" SET DEFAULT 'pending_verification';--> statement-breakpoint
ALTER TABLE "pharmacies" ADD COLUMN IF NOT EXISTS "matching_auto_notify_enabled" boolean DEFAULT true NOT NULL;
