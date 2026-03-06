import { and, eq, inArray, sql, type InferInsertModel } from 'drizzle-orm';
import { db } from '../config/database';
import { deadStockItems, usedMedicationItems } from '../db/schema';
import { buildValuesSql, processInBatches, toNullableDecimalString } from './upload-diff-utils';
import { type PreparedDeadStockDiffInput, type UsedMedicationDiffInput } from './upload-diff-builders';

const DIFF_INSERT_BATCH_SIZE = 500;
const DIFF_UPDATE_BATCH_SIZE = 250;

type UploadDiffTx = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;
type DeadStockInsertRow = InferInsertModel<typeof deadStockItems>;
type UsedMedicationInsertRow = InferInsertModel<typeof usedMedicationItems>;

export interface DeadStockExistingRow {
  id: number;
  drugCode: string | null;
  drugName: string;
  drugMasterId: number | null;
  drugMasterPackageId: number | null;
  packageLabel: string | null;
  quantity: number | string | null;
  yakkaUnitPrice: number | string | null;
  yakkaTotal: number | string | null;
  unit: string | null;
  lotNumber: string | null;
  expirationDate: string | null;
  expirationDateIso: string | null;
  isAvailable: boolean | null;
}

export interface UsedMedicationExistingRow {
  id: number;
  drugCode: string | null;
  drugName: string;
  drugMasterId: number | null;
  drugMasterPackageId: number | null;
  packageLabel: string | null;
  monthlyUsage: number | string | null;
  yakkaUnitPrice: number | string | null;
  unit: string | null;
}

export async function insertDeadStockInBatches(tx: UploadDiffTx, rows: DeadStockInsertRow[]): Promise<void> {
  await processInBatches(rows, DIFF_INSERT_BATCH_SIZE, async (batch) => {
    await tx.insert(deadStockItems).values(batch);
  });
}

export async function insertUsedMedicationInBatches(tx: UploadDiffTx, rows: UsedMedicationInsertRow[]): Promise<void> {
  await processInBatches(rows, DIFF_INSERT_BATCH_SIZE, async (batch) => {
    await tx.insert(usedMedicationItems).values(batch);
  });
}

export async function updateDeadStockInBatches(
  tx: UploadDiffTx,
  pharmacyId: number,
  uploadId: number,
  updatedPairs: Array<{ current: DeadStockExistingRow; item: PreparedDeadStockDiffInput }>,
): Promise<void> {
  await processInBatches(updatedPairs, DIFF_UPDATE_BATCH_SIZE, async (batch) => {
    const updateRowsSql = buildValuesSql(batch, ({ current, item }) => sql`(
      ${current.id},
      ${uploadId},
      ${item.drugMasterId ?? null},
      ${item.drugMasterPackageId ?? null},
      ${item.packageLabel ?? null},
      ${item.quantity},
      ${item.unit},
      ${toNullableDecimalString(item.yakkaUnitPrice)},
      ${toNullableDecimalString(item.yakkaTotal)},
      ${item.expirationDate},
      ${item.normalizedDate},
      ${item.lotNumber}
    )`);

    await tx.execute(sql`
      WITH updates (
        id,
        upload_id,
        drug_master_id,
        drug_master_package_id,
        package_label,
        quantity,
        unit,
        yakka_unit_price,
        yakka_total,
        expiration_date,
        expiration_date_iso,
        lot_number
      ) AS (
        VALUES ${updateRowsSql}
      )
      UPDATE dead_stock_items AS target
      SET
        upload_id = updates.upload_id,
        drug_master_id = updates.drug_master_id,
        drug_master_package_id = updates.drug_master_package_id,
        package_label = updates.package_label,
        quantity = updates.quantity,
        unit = updates.unit,
        yakka_unit_price = updates.yakka_unit_price,
        yakka_total = updates.yakka_total,
        expiration_date = updates.expiration_date,
        expiration_date_iso = updates.expiration_date_iso,
        lot_number = updates.lot_number,
        is_available = true
      FROM updates
      WHERE target.id = updates.id
        AND target.pharmacy_id = ${pharmacyId}
    `);
  });
}

export async function updateUsedMedicationInBatches(
  tx: UploadDiffTx,
  pharmacyId: number,
  uploadId: number,
  updatedPairs: Array<{ current: UsedMedicationExistingRow; item: UsedMedicationDiffInput }>,
): Promise<void> {
  await processInBatches(updatedPairs, DIFF_UPDATE_BATCH_SIZE, async (batch) => {
    const updateRowsSql = buildValuesSql(batch, ({ current, item }) => sql`(
      ${current.id},
      ${uploadId},
      ${item.drugMasterId ?? null},
      ${item.drugMasterPackageId ?? null},
      ${item.packageLabel ?? null},
      ${item.monthlyUsage},
      ${item.unit},
      ${toNullableDecimalString(item.yakkaUnitPrice)}
    )`);

    await tx.execute(sql`
      WITH updates (
        id,
        upload_id,
        drug_master_id,
        drug_master_package_id,
        package_label,
        monthly_usage,
        unit,
        yakka_unit_price
      ) AS (
        VALUES ${updateRowsSql}
      )
      UPDATE used_medication_items AS target
      SET
        upload_id = updates.upload_id,
        drug_master_id = updates.drug_master_id,
        drug_master_package_id = updates.drug_master_package_id,
        package_label = updates.package_label,
        monthly_usage = updates.monthly_usage,
        unit = updates.unit,
        yakka_unit_price = updates.yakka_unit_price
      FROM updates
      WHERE target.id = updates.id
        AND target.pharmacy_id = ${pharmacyId}
    `);
  });
}
