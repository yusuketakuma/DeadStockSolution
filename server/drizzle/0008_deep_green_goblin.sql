CREATE INDEX IF NOT EXISTS "idx_activity_logs_failure_pattern_scan" ON "activity_logs" USING btree ("action","created_at") WHERE "activity_logs"."detail" LIKE '失敗|%';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_uploads_used_med_recent_candidates" ON "uploads" USING btree ("created_at","pharmacy_id") WHERE "uploads"."upload_type" = 'used_medication';
