ALTER TABLE "dds_bootstrap_tokens"
  ALTER COLUMN "expires_at" TYPE timestamp with time zone USING "expires_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "consumed_at" TYPE timestamp with time zone USING CASE WHEN "consumed_at" IS NULL THEN NULL ELSE "consumed_at" AT TIME ZONE 'UTC' END,
  ALTER COLUMN "created_at" TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE "dds_agent_connections"
  ALTER COLUMN "last_heartbeat_at" TYPE timestamp with time zone USING CASE WHEN "last_heartbeat_at" IS NULL THEN NULL ELSE "last_heartbeat_at" AT TIME ZONE 'UTC' END,
  ALTER COLUMN "last_seen_at" TYPE timestamp with time zone USING CASE WHEN "last_seen_at" IS NULL THEN NULL ELSE "last_seen_at" AT TIME ZONE 'UTC' END,
  ALTER COLUMN "created_at" TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "registered_at" TYPE timestamp with time zone USING "registered_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at" TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE "dds_agent_jobs"
  ALTER COLUMN "lease_expires_at" TYPE timestamp with time zone USING CASE WHEN "lease_expires_at" IS NULL THEN NULL ELSE "lease_expires_at" AT TIME ZONE 'UTC' END,
  ALTER COLUMN "leased_at" TYPE timestamp with time zone USING CASE WHEN "leased_at" IS NULL THEN NULL ELSE "leased_at" AT TIME ZONE 'UTC' END,
  ALTER COLUMN "completed_at" TYPE timestamp with time zone USING CASE WHEN "completed_at" IS NULL THEN NULL ELSE "completed_at" AT TIME ZONE 'UTC' END,
  ALTER COLUMN "created_at" TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at" TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC';
--> statement-breakpoint
ALTER TABLE "dds_work_items"
  ALTER COLUMN "created_at" TYPE timestamp with time zone USING "created_at" AT TIME ZONE 'UTC',
  ALTER COLUMN "updated_at" TYPE timestamp with time zone USING "updated_at" AT TIME ZONE 'UTC';
