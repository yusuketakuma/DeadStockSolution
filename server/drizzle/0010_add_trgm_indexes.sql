CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_drug_master_drug_name_trgm" ON "drug_master" USING gin ("drug_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_drug_master_generic_name_trgm" ON "drug_master" USING gin ("generic_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_activity_logs_detail_trgm" ON "activity_logs" USING gin ("detail" gin_trgm_ops);
