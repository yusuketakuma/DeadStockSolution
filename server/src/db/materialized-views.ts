import { sql } from 'drizzle-orm';
import { db } from '../config/database';

const CREATE_MV_DRUG_AVAILABILITY_SUMMARY_SQL = `
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
`;

const CREATE_MV_DRUG_AVAILABILITY_SUMMARY_INDEX_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_drug_avail_drug_master
ON mv_drug_availability_summary(drug_master_id);
`;

type DrugAvailabilitySummaryRow = {
  drugMasterId: number;
  pharmacyCount: number;
  totalQuantity: number;
  earliestExpiry: string | null;
  lastUpdated: string | null;
};

async function ensureDrugAvailabilitySummaryMaterializedView(): Promise<void> {
  await db.execute(sql.raw(CREATE_MV_DRUG_AVAILABILITY_SUMMARY_SQL));
  await db.execute(sql.raw(CREATE_MV_DRUG_AVAILABILITY_SUMMARY_INDEX_SQL));
}

export async function refreshDrugAvailabilitySummary(): Promise<void> {
  await ensureDrugAvailabilitySummaryMaterializedView();
  await db.execute(sql.raw('REFRESH MATERIALIZED VIEW CONCURRENTLY mv_drug_availability_summary'));
}

export async function queryDrugAvailabilitySummary(drugMasterIds: number[]): Promise<DrugAvailabilitySummaryRow[]> {
  if (drugMasterIds.length === 0) {
    return [];
  }

  const result = await db.execute(sql`
    SELECT
      drug_master_id,
      pharmacy_count,
      total_quantity,
      earliest_expiry,
      last_updated
    FROM mv_drug_availability_summary
    WHERE drug_master_id IN (${sql.join(drugMasterIds.map((id) => sql`${id}`), sql`, `)})
  `);

  return result.rows.map((row) => ({
    drugMasterId: Number(row.drug_master_id),
    pharmacyCount: Number(row.pharmacy_count),
    totalQuantity: Number(row.total_quantity),
    earliestExpiry: row.earliest_expiry as string | null,
    lastUpdated: row.last_updated as string | null,
  }));
}
