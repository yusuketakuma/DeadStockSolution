import {
  equalNullableNumber,
  normalizeNullableNumber,
  normalizeString,
} from '../utils/upload-diff-utils';
import { type PreparedDeadStockDiffInput, type UsedMedicationDiffInput } from './upload-diff-builders';

interface DeadStockComparableRow {
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

interface UsedMedicationComparableRow {
  drugMasterId: number | null;
  drugMasterPackageId: number | null;
  packageLabel: string | null;
  monthlyUsage: number | string | null;
  yakkaUnitPrice: number | string | null;
}

export function hasDeadStockRowChanged(
  current: DeadStockComparableRow,
  item: PreparedDeadStockDiffInput,
): boolean {
  return (
    (current.drugMasterId ?? null) !== (item.drugMasterId ?? null) ||
    (current.drugMasterPackageId ?? null) !== (item.drugMasterPackageId ?? null) ||
    normalizeString(current.packageLabel) !== normalizeString(item.packageLabel) ||
    !equalNullableNumber(current.quantity, normalizeNullableNumber(item.quantity)) ||
    !equalNullableNumber(current.yakkaUnitPrice, normalizeNullableNumber(item.yakkaUnitPrice)) ||
    !equalNullableNumber(current.yakkaTotal, normalizeNullableNumber(item.yakkaTotal)) ||
    normalizeString(current.unit) !== normalizeString(item.unit) ||
    normalizeString(current.lotNumber) !== normalizeString(item.lotNumber) ||
    normalizeString(current.expirationDateIso ?? current.expirationDate) !== normalizeString(item.normalizedDate) ||
    current.isAvailable !== true
  );
}

export function hasUsedMedicationRowChanged(
  current: UsedMedicationComparableRow,
  item: UsedMedicationDiffInput,
): boolean {
  return (
    (current.drugMasterId ?? null) !== (item.drugMasterId ?? null) ||
    (current.drugMasterPackageId ?? null) !== (item.drugMasterPackageId ?? null) ||
    normalizeString(current.packageLabel) !== normalizeString(item.packageLabel) ||
    !equalNullableNumber(current.monthlyUsage, normalizeNullableNumber(item.monthlyUsage)) ||
    !equalNullableNumber(current.yakkaUnitPrice, normalizeNullableNumber(item.yakkaUnitPrice))
  );
}
