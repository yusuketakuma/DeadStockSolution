ALTER TABLE "dead_stock_items" ADD COLUMN "drug_master_package_id" integer;--> statement-breakpoint
ALTER TABLE "dead_stock_items" ADD COLUMN "package_label" text;--> statement-breakpoint
ALTER TABLE "drug_master_packages" ADD COLUMN "normalized_package_label" text;--> statement-breakpoint
ALTER TABLE "drug_master_packages" ADD COLUMN "package_form" text;--> statement-breakpoint
ALTER TABLE "drug_master_packages" ADD COLUMN "is_loose_package" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "used_medication_items" ADD COLUMN "drug_master_package_id" integer;--> statement-breakpoint
ALTER TABLE "used_medication_items" ADD COLUMN "package_label" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dead_stock_drug_master_package_id" ON "dead_stock_items" USING btree ("drug_master_package_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_drug_packages_normalized_label" ON "drug_master_packages" USING btree ("normalized_package_label");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_used_med_drug_master_package_id" ON "used_medication_items" USING btree ("drug_master_package_id");