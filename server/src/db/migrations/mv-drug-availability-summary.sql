CREATE MATERIALIZED VIEW IF NOT EXISTS mv_drug_availability_summary AS
SELECT
  drug_master_id,
  COUNT(DISTINCT pharmacy_id) AS pharmacy_count,
  SUM(quantity) AS total_quantity,
  MIN(expiration_date_iso) AS earliest_expiry,
  MAX(created_at) AS last_updated
FROM dead_stock_items
WHERE is_available = true AND quantity > 0 AND drug_master_id IS NOT NULL
GROUP BY drug_master_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_drug_avail_drug_master
  ON mv_drug_availability_summary(drug_master_id);
