CREATE TABLE IF NOT EXISTS "match_dismiss_feedback" (
  "id" serial PRIMARY KEY NOT NULL,
  "pharmacy_id" integer NOT NULL REFERENCES "pharmacies"("id") ON DELETE cascade,
  "candidate_pharmacy_id" integer NOT NULL REFERENCES "pharmacies"("id") ON DELETE cascade,
  "reason" text NOT NULL,
  "drug_code" text NOT NULL DEFAULT '',
  "drug_group" text NOT NULL DEFAULT '',
  "dismiss_count" integer NOT NULL DEFAULT 1,
  "last_dismissed_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "chk_match_dismiss_reason" CHECK ("reason" IN ('distance','expiry','value_gap','item_fit','other'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_match_dismiss_feedback" ON "match_dismiss_feedback" ("pharmacy_id", "candidate_pharmacy_id", "reason", "drug_code", "drug_group");
CREATE INDEX IF NOT EXISTS "idx_match_dismiss_feedback_pharmacy" ON "match_dismiss_feedback" ("pharmacy_id", "last_dismissed_at");

CREATE TABLE IF NOT EXISTS "proposal_counter_offers" (
  "id" serial PRIMARY KEY NOT NULL,
  "proposal_id" integer NOT NULL REFERENCES "exchange_proposals"("id") ON DELETE cascade,
  "proposer_pharmacy_id" integer NOT NULL REFERENCES "pharmacies"("id") ON DELETE cascade,
  "responder_pharmacy_id" integer NOT NULL REFERENCES "pharmacies"("id") ON DELETE cascade,
  "status" varchar(24) NOT NULL DEFAULT 'pending',
  "summary" text NOT NULL,
  "items_json" text NOT NULL,
  "response_note" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "responded_at" timestamp,
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "chk_proposal_counter_offer_status" CHECK ("status" IN ('pending','accepted','rejected','superseded'))
);
CREATE INDEX IF NOT EXISTS "idx_proposal_counter_offers_proposal_created" ON "proposal_counter_offers" ("proposal_id", "created_at");
CREATE INDEX IF NOT EXISTS "idx_proposal_counter_offers_responder_status" ON "proposal_counter_offers" ("responder_pharmacy_id", "status", "created_at");

CREATE TABLE IF NOT EXISTS "admin_dashboard_snapshots" (
  "id" serial PRIMARY KEY NOT NULL,
  "total_uploads" integer NOT NULL DEFAULT 0,
  "total_exchanges" integer NOT NULL DEFAULT 0,
  "unread_notifications" integer NOT NULL DEFAULT 0,
  "failed_upload_jobs_24h" integer NOT NULL DEFAULT 0,
  "pending_proposal_actions_24h" integer NOT NULL DEFAULT 0,
  "escalated_requests_24h" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_admin_dashboard_snapshots_created" ON "admin_dashboard_snapshots" ("created_at");

CREATE TABLE IF NOT EXISTS "openclaw_runbook_logs" (
  "id" serial PRIMARY KEY NOT NULL,
  "admin_id" integer REFERENCES "pharmacies"("id") ON DELETE set null,
  "action" varchar(128) NOT NULL,
  "status" varchar(24) NOT NULL DEFAULT 'success',
  "detail" text,
  "result_summary" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_openclaw_runbook_logs_created" ON "openclaw_runbook_logs" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_openclaw_runbook_logs_admin_created" ON "openclaw_runbook_logs" ("admin_id", "created_at");

CREATE TABLE IF NOT EXISTS "upload_issue_remediations" (
  "id" serial PRIMARY KEY NOT NULL,
  "issue_code" text NOT NULL,
  "cause" text NOT NULL,
  "fix" text NOT NULL,
  "verify" text NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_upload_issue_remediation_code" ON "upload_issue_remediations" ("issue_code");

CREATE TABLE IF NOT EXISTS "upload_issue_remediation_history" (
  "id" serial PRIMARY KEY NOT NULL,
  "issue_code" text NOT NULL,
  "cause" text NOT NULL,
  "fix" text NOT NULL,
  "verify" text NOT NULL,
  "updated_by_admin_id" integer REFERENCES "pharmacies"("id") ON DELETE set null,
  "created_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_upload_issue_remediation_history_code" ON "upload_issue_remediation_history" ("issue_code", "created_at");

CREATE TABLE IF NOT EXISTS "notification_group_states" (
  "id" serial PRIMARY KEY NOT NULL,
  "pharmacy_id" integer NOT NULL REFERENCES "pharmacies"("id") ON DELETE cascade,
  "action_path" text NOT NULL,
  "snoozed_until" timestamp with time zone,
  "last_read_at" timestamp with time zone,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_notification_group_state" ON "notification_group_states" ("pharmacy_id", "action_path");
CREATE INDEX IF NOT EXISTS "idx_notification_group_state_pharmacy" ON "notification_group_states" ("pharmacy_id", "updated_at");
