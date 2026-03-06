import { type InferInsertModel } from 'drizzle-orm';
import { deadStockItems, usedMedicationItems } from '../db/schema';
import { toNullableDecimalString } from './upload-diff-utils';

type DeadStockInsertRow = InferInsertModel<typeof deadStockItems>;
type UsedMedicationInsertRow = InferInsertModel<typeof usedMedicationItems>;

export interface DeadStockDiffInput {
  drugCode: string | null;
  drugName: string;
  drugMasterId?: number | null;
  drugMasterPackageId?: number | null;
  packageLabel?: string | null;
  quantity: number;
  unit: string | null;
  yakkaUnitPrice: number | null;
  yakkaTotal: number | null;
  expirationDate: string | null;
  lotNumber: string | null;
}

export interface UsedMedicationDiffInput {
  drugCode: string | null;
  drugName: string;
  drugMasterId?: number | null;
  drugMasterPackageId?: number | null;
  packageLabel?: string | null;
  monthlyUsage: number | null;
  unit: string | null;
  yakkaUnitPrice: number | null;
}

export type PreparedDeadStockDiffInput = DeadStockDiffInput & { normalizedDate: string | null };

/**
 * Build a DeadStockInsertRow from incoming diff input.
 * Converts nullable numbers to decimal strings and sets default values.
 */
export function buildDeadStockInsertRow(
  pharmacyId: number,
  uploadId: number,
  item: PreparedDeadStockDiffInput,
): DeadStockInsertRow {
  return {
    pharmacyId,
    uploadId,
    drugCode: item.drugCode,
    drugName: item.drugName,
    drugMasterId: item.drugMasterId ?? null,
    drugMasterPackageId: item.drugMasterPackageId ?? null,
    packageLabel: item.packageLabel ?? null,
    quantity: item.quantity,
    unit: item.unit,
    yakkaUnitPrice: toNullableDecimalString(item.yakkaUnitPrice),
    yakkaTotal: toNullableDecimalString(item.yakkaTotal),
    expirationDate: item.expirationDate,
    expirationDateIso: item.normalizedDate,
    lotNumber: item.lotNumber,
    isAvailable: true,
  };
}

/**
 * Build a UsedMedicationInsertRow from incoming diff input.
 * Converts nullable numbers to decimal strings and sets default values.
 */
export function buildUsedMedicationInsertRow(
  pharmacyId: number,
  uploadId: number,
  item: UsedMedicationDiffInput,
): UsedMedicationInsertRow {
  return {
    pharmacyId,
    uploadId,
    drugCode: item.drugCode,
    drugName: item.drugName,
    drugMasterId: item.drugMasterId ?? null,
    drugMasterPackageId: item.drugMasterPackageId ?? null,
    packageLabel: item.packageLabel ?? null,
    monthlyUsage: item.monthlyUsage,
    unit: item.unit,
    yakkaUnitPrice: toNullableDecimalString(item.yakkaUnitPrice),
  };
}
