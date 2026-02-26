DO $$ BEGIN
  CREATE TYPE monthly_report_status_enum AS ENUM ('success', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE dead_stock_items
  ADD COLUMN IF NOT EXISTS expiration_date_iso date;

UPDATE dead_stock_items
SET expiration_date_iso = CASE
  WHEN expiration_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN expiration_date::date
  WHEN expiration_date ~ '^[0-9]{4}/[0-9]{2}/[0-9]{2}$' THEN replace(expiration_date, '/', '-')::date
  ELSE expiration_date_iso
END
WHERE expiration_date IS NOT NULL
  AND expiration_date_iso IS NULL;

CREATE INDEX IF NOT EXISTS idx_dead_stock_expiry_risk
  ON dead_stock_items (pharmacy_id, is_available, expiration_date_iso);

CREATE TABLE IF NOT EXISTS proposal_comments (
  id serial PRIMARY KEY,
  proposal_id integer NOT NULL REFERENCES exchange_proposals(id) ON DELETE CASCADE,
  author_pharmacy_id integer NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  body text NOT NULL,
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_proposal_comments_proposal_created
  ON proposal_comments (proposal_id, created_at);
CREATE INDEX IF NOT EXISTS idx_proposal_comments_author
  ON proposal_comments (author_pharmacy_id, created_at);

CREATE TABLE IF NOT EXISTS exchange_feedback (
  id serial PRIMARY KEY,
  proposal_id integer NOT NULL REFERENCES exchange_proposals(id) ON DELETE CASCADE,
  from_pharmacy_id integer NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  to_pharmacy_id integer NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment text,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_exchange_feedback_proposal_from_unique
  ON exchange_feedback (proposal_id, from_pharmacy_id);
CREATE INDEX IF NOT EXISTS idx_exchange_feedback_target
  ON exchange_feedback (to_pharmacy_id, created_at);

CREATE TABLE IF NOT EXISTS pharmacy_trust_scores (
  pharmacy_id integer PRIMARY KEY REFERENCES pharmacies(id) ON DELETE CASCADE,
  trust_score numeric(5,2) NOT NULL DEFAULT 60.00,
  rating_count integer NOT NULL DEFAULT 0,
  positive_rate numeric(5,2) NOT NULL DEFAULT 0.00,
  updated_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trust_scores_updated_at
  ON pharmacy_trust_scores (updated_at);

CREATE TABLE IF NOT EXISTS monthly_reports (
  id serial PRIMARY KEY,
  year integer NOT NULL,
  month integer NOT NULL CHECK (month >= 1 AND month <= 12),
  status monthly_report_status_enum NOT NULL DEFAULT 'success',
  report_json text NOT NULL,
  generated_by integer REFERENCES pharmacies(id) ON DELETE SET NULL,
  generated_at timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_monthly_reports_year_month_unique
  ON monthly_reports (year, month);
CREATE INDEX IF NOT EXISTS idx_monthly_reports_generated_at
  ON monthly_reports (generated_at);
