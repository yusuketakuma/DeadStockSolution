ALTER TABLE "pharmacies" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "pharmacy_business_hours" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "pharmacy_special_hours" ADD COLUMN IF NOT EXISTS "version" integer DEFAULT 1 NOT NULL;
