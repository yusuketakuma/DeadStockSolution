ALTER TABLE "pharmacies" ADD COLUMN "verification_status" text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "pharmacies" ADD COLUMN "verification_request_id" integer;--> statement-breakpoint
ALTER TABLE "pharmacies" ADD COLUMN "verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "pharmacies" ADD COLUMN "rejection_reason" text;