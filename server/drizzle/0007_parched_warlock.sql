CREATE INDEX IF NOT EXISTS "idx_password_reset_active_tokens" ON "password_reset_tokens" USING btree ("pharmacy_id","expires_at") WHERE "password_reset_tokens"."used_at" IS NULL;
