import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../config/database';
import { deadStockItems, usedMedicationItems } from '../db/schema';

interface DeadStockDiffInput {
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

interface UsedMedicationDiffInput {
  drugCode: string | null;
  drugName: string;
  drugMasterId?: number | null;
  drugMasterPackageId?: number | null;
  packageLabel?: string | null;
  monthlyUsage: number | null;
  unit: string | null;
  yakkaUnitPrice: number | null;
}

export interface DiffSummary {
  inserted: number;
  updated: number;
  deactivated: number;
  unchanged: number;
  totalIncoming: number;
}

export interface ApplyDiffOptions {
  deleteMissing: boolean;
}

function normalizeString(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function normalizeNullableNumber(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Math.round(Number(value) * 1000) / 1000;
}

function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/\//g, '-').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  return normalized;
}

function deadStockKey(item: {
  drugCode: string | null;
  drugName: string;
  unit: string | null;
  expirationDate: string | null;
  lotNumber: string | null;
}): string {
  return [
    normalizeString(item.drugCode),
    normalizeString(item.drugName),
    normalizeString(item.unit),
    normalizeString(item.expirationDate),
    normalizeString(item.lotNumber),
  ].join('|');
}

function usedMedicationKey(item: {
  drugCode: string | null;
  drugName: string;
  unit: string | null;
}): string {
  return [
    normalizeString(item.drugCode),
    normalizeString(item.drugName),
    normalizeString(item.unit),
  ].join('|');
}

function equalNullableNumber(a: number | string | null, b: number | null): boolean {
  const left = a === null ? null : Number(a);
  const right = b === null ? null : Number(b);
  if (left === null || right === null) return left === right;
  return Math.abs(left - right) < 0.0001;
}

export async function previewDeadStockDiff(
  pharmacyId: number,
  incoming: DeadStockDiffInput[],
  options: ApplyDiffOptions,
): Promise<DiffSummary> {
  const existing = await db.select({
    id: deadStockItems.id,
    drugCode: deadStockItems.drugCode,
    drugName: deadStockItems.drugName,
    quantity: deadStockItems.quantity,
    unit: deadStockItems.unit,
    yakkaUnitPrice: deadStockItems.yakkaUnitPrice,
    yakkaTotal: deadStockItems.yakkaTotal,
    expirationDate: deadStockItems.expirationDate,
    expirationDateIso: deadStockItems.expirationDateIso,
    lotNumber: deadStockItems.lotNumber,
    isAvailable: deadStockItems.isAvailable,
  })
    .from(deadStockItems)
    .where(eq(deadStockItems.pharmacyId, pharmacyId));

  const existingByKey = new Map<string, (typeof existing)[number]>();
  for (const row of existing) {
    const key = deadStockKey({
      drugCode: row.drugCode,
      drugName: row.drugName,
      unit: row.unit,
      expirationDate: row.expirationDateIso ?? row.expirationDate,
      lotNumber: row.lotNumber,
    });
    if (!existingByKey.has(key)) existingByKey.set(key, row);
  }

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  const seenExistingIds = new Set<number>();

  for (const item of incoming) {
    const normalizedDate = normalizeDate(item.expirationDate);
    const key = deadStockKey({
      drugCode: item.drugCode,
      drugName: item.drugName,
      unit: item.unit,
      expirationDate: normalizedDate,
      lotNumber: item.lotNumber,
    });
    const current = existingByKey.get(key);
    if (!current) {
      inserted += 1;
      continue;
    }

    seenExistingIds.add(current.id);

    const changed =
      !equalNullableNumber(current.quantity, normalizeNullableNumber(item.quantity)) ||
      !equalNullableNumber(current.yakkaUnitPrice, normalizeNullableNumber(item.yakkaUnitPrice)) ||
      !equalNullableNumber(current.yakkaTotal, normalizeNullableNumber(item.yakkaTotal)) ||
      normalizeString(current.unit) !== normalizeString(item.unit) ||
      normalizeString(current.lotNumber) !== normalizeString(item.lotNumber) ||
      normalizeString(current.expirationDateIso ?? current.expirationDate) !== normalizeString(normalizedDate) ||
      current.isAvailable !== true;

    if (changed) {
      updated += 1;
    } else {
      unchanged += 1;
    }
  }

  const deactivated = options.deleteMissing
    ? existing.filter((row) => row.isAvailable && !seenExistingIds.has(row.id)).length
    : 0;

  return {
    inserted,
    updated,
    deactivated,
    unchanged,
    totalIncoming: incoming.length,
  };
}

export async function applyDeadStockDiff(
  tx: any,
  pharmacyId: number,
  uploadId: number,
  incoming: DeadStockDiffInput[],
  options: ApplyDiffOptions,
): Promise<DiffSummary> {
  const existing = await tx.select({
    id: deadStockItems.id,
    drugCode: deadStockItems.drugCode,
    drugName: deadStockItems.drugName,
    quantity: deadStockItems.quantity,
    unit: deadStockItems.unit,
    yakkaUnitPrice: deadStockItems.yakkaUnitPrice,
    yakkaTotal: deadStockItems.yakkaTotal,
    expirationDate: deadStockItems.expirationDate,
    expirationDateIso: deadStockItems.expirationDateIso,
    lotNumber: deadStockItems.lotNumber,
    isAvailable: deadStockItems.isAvailable,
  })
    .from(deadStockItems)
    .where(eq(deadStockItems.pharmacyId, pharmacyId));

  const existingByKey = new Map<string, (typeof existing)[number]>();
  for (const row of existing) {
    const key = deadStockKey({
      drugCode: row.drugCode,
      drugName: row.drugName,
      unit: row.unit,
      expirationDate: row.expirationDateIso ?? row.expirationDate,
      lotNumber: row.lotNumber,
    });
    if (!existingByKey.has(key)) existingByKey.set(key, row);
  }

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  const seenExistingIds = new Set<number>();
  const insertRows: Array<{
    pharmacyId: number;
    uploadId: number;
    drugCode: string | null;
    drugName: string;
    drugMasterId: number | null;
    drugMasterPackageId: number | null;
    packageLabel: string | null;
    quantity: number;
    unit: string | null;
    yakkaUnitPrice: string | null;
    yakkaTotal: string | null;
    expirationDate: string | null;
    expirationDateIso: string | null;
    lotNumber: string | null;
    isAvailable: boolean;
  }> = [];

  for (const item of incoming) {
    const normalizedDate = normalizeDate(item.expirationDate);
    const key = deadStockKey({
      drugCode: item.drugCode,
      drugName: item.drugName,
      unit: item.unit,
      expirationDate: normalizedDate,
      lotNumber: item.lotNumber,
    });
    const current = existingByKey.get(key);

    if (!current) {
      insertRows.push({
        pharmacyId,
        uploadId,
        drugCode: item.drugCode,
        drugName: item.drugName,
        drugMasterId: item.drugMasterId ?? null,
        drugMasterPackageId: item.drugMasterPackageId ?? null,
        packageLabel: item.packageLabel ?? null,
        quantity: item.quantity,
        unit: item.unit,
        yakkaUnitPrice: item.yakkaUnitPrice !== null ? String(item.yakkaUnitPrice) : null,
        yakkaTotal: item.yakkaTotal !== null ? String(item.yakkaTotal) : null,
        expirationDate: item.expirationDate,
        expirationDateIso: normalizedDate,
        lotNumber: item.lotNumber,
        isAvailable: true,
      });
      inserted += 1;
      continue;
    }

    seenExistingIds.add(current.id);

    const changed =
      !equalNullableNumber(current.quantity, normalizeNullableNumber(item.quantity)) ||
      !equalNullableNumber(current.yakkaUnitPrice, normalizeNullableNumber(item.yakkaUnitPrice)) ||
      !equalNullableNumber(current.yakkaTotal, normalizeNullableNumber(item.yakkaTotal)) ||
      normalizeString(current.unit) !== normalizeString(item.unit) ||
      normalizeString(current.lotNumber) !== normalizeString(item.lotNumber) ||
      normalizeString(current.expirationDateIso ?? current.expirationDate) !== normalizeString(normalizedDate) ||
      current.isAvailable !== true;

    if (!changed) {
      unchanged += 1;
      continue;
    }

    await tx.update(deadStockItems)
      .set({
        uploadId,
        drugMasterId: item.drugMasterId ?? null,
        drugMasterPackageId: item.drugMasterPackageId ?? null,
        packageLabel: item.packageLabel ?? null,
        quantity: item.quantity,
        unit: item.unit,
        yakkaUnitPrice: item.yakkaUnitPrice !== null ? String(item.yakkaUnitPrice) : null,
        yakkaTotal: item.yakkaTotal !== null ? String(item.yakkaTotal) : null,
        expirationDate: item.expirationDate,
        expirationDateIso: normalizedDate,
        lotNumber: item.lotNumber,
        isAvailable: true,
      })
      .where(and(
        eq(deadStockItems.id, current.id),
        eq(deadStockItems.pharmacyId, pharmacyId),
      ));

    updated += 1;
  }
  if (insertRows.length > 0) {
    await tx.insert(deadStockItems).values(insertRows);
  }

  let deactivated = 0;
  if (options.deleteMissing) {
    const toDeactivateIds = existing
      .filter((row: { id: number; isAvailable: boolean | null }) => row.isAvailable && !seenExistingIds.has(row.id))
      .map((row: { id: number }) => row.id);

    if (toDeactivateIds.length > 0) {
      await tx.update(deadStockItems)
        .set({ isAvailable: false })
        .where(and(
          eq(deadStockItems.pharmacyId, pharmacyId),
          inArray(deadStockItems.id, toDeactivateIds),
        ));
      deactivated = toDeactivateIds.length;
    }
  }

  return {
    inserted,
    updated,
    deactivated,
    unchanged,
    totalIncoming: incoming.length,
  };
}

export async function previewUsedMedicationDiff(
  pharmacyId: number,
  incoming: UsedMedicationDiffInput[],
  options: ApplyDiffOptions,
): Promise<DiffSummary> {
  const existing = await db.select({
    id: usedMedicationItems.id,
    drugCode: usedMedicationItems.drugCode,
    drugName: usedMedicationItems.drugName,
    unit: usedMedicationItems.unit,
    monthlyUsage: usedMedicationItems.monthlyUsage,
    yakkaUnitPrice: usedMedicationItems.yakkaUnitPrice,
  })
    .from(usedMedicationItems)
    .where(eq(usedMedicationItems.pharmacyId, pharmacyId));

  const existingByKey = new Map<string, (typeof existing)[number]>();
  for (const row of existing) {
    const key = usedMedicationKey({
      drugCode: row.drugCode,
      drugName: row.drugName,
      unit: row.unit,
    });
    if (!existingByKey.has(key)) existingByKey.set(key, row);
  }

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  const seenExistingIds = new Set<number>();

  for (const item of incoming) {
    const key = usedMedicationKey(item);
    const current = existingByKey.get(key);
    if (!current) {
      inserted += 1;
      continue;
    }

    seenExistingIds.add(current.id);
    const changed =
      !equalNullableNumber(current.monthlyUsage, normalizeNullableNumber(item.monthlyUsage)) ||
      !equalNullableNumber(current.yakkaUnitPrice, normalizeNullableNumber(item.yakkaUnitPrice));

    if (changed) {
      updated += 1;
    } else {
      unchanged += 1;
    }
  }

  const deactivated = options.deleteMissing
    ? existing.filter((row) => !seenExistingIds.has(row.id)).length
    : 0;

  return {
    inserted,
    updated,
    deactivated,
    unchanged,
    totalIncoming: incoming.length,
  };
}

export async function applyUsedMedicationDiff(
  tx: any,
  pharmacyId: number,
  uploadId: number,
  incoming: UsedMedicationDiffInput[],
  options: ApplyDiffOptions,
): Promise<DiffSummary> {
  const existing = await tx.select({
    id: usedMedicationItems.id,
    drugCode: usedMedicationItems.drugCode,
    drugName: usedMedicationItems.drugName,
    unit: usedMedicationItems.unit,
    monthlyUsage: usedMedicationItems.monthlyUsage,
    yakkaUnitPrice: usedMedicationItems.yakkaUnitPrice,
  })
    .from(usedMedicationItems)
    .where(eq(usedMedicationItems.pharmacyId, pharmacyId));

  const existingByKey = new Map<string, (typeof existing)[number]>();
  for (const row of existing) {
    const key = usedMedicationKey({
      drugCode: row.drugCode,
      drugName: row.drugName,
      unit: row.unit,
    });
    if (!existingByKey.has(key)) existingByKey.set(key, row);
  }

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  const seenExistingIds = new Set<number>();
  const insertRows: Array<{
    pharmacyId: number;
    uploadId: number;
    drugCode: string | null;
    drugName: string;
    drugMasterId: number | null;
    drugMasterPackageId: number | null;
    packageLabel: string | null;
    monthlyUsage: number | null;
    unit: string | null;
    yakkaUnitPrice: string | null;
  }> = [];

  for (const item of incoming) {
    const key = usedMedicationKey(item);
    const current = existingByKey.get(key);

    if (!current) {
      insertRows.push({
        pharmacyId,
        uploadId,
        drugCode: item.drugCode,
        drugName: item.drugName,
        drugMasterId: item.drugMasterId ?? null,
        drugMasterPackageId: item.drugMasterPackageId ?? null,
        packageLabel: item.packageLabel ?? null,
        monthlyUsage: item.monthlyUsage,
        unit: item.unit,
        yakkaUnitPrice: item.yakkaUnitPrice !== null ? String(item.yakkaUnitPrice) : null,
      });
      inserted += 1;
      continue;
    }

    seenExistingIds.add(current.id);
    const changed =
      !equalNullableNumber(current.monthlyUsage, normalizeNullableNumber(item.monthlyUsage)) ||
      !equalNullableNumber(current.yakkaUnitPrice, normalizeNullableNumber(item.yakkaUnitPrice));

    if (!changed) {
      unchanged += 1;
      continue;
    }

    await tx.update(usedMedicationItems)
      .set({
        uploadId,
        drugMasterId: item.drugMasterId ?? null,
        drugMasterPackageId: item.drugMasterPackageId ?? null,
        packageLabel: item.packageLabel ?? null,
        monthlyUsage: item.monthlyUsage,
        unit: item.unit,
        yakkaUnitPrice: item.yakkaUnitPrice !== null ? String(item.yakkaUnitPrice) : null,
      })
      .where(and(
        eq(usedMedicationItems.id, current.id),
        eq(usedMedicationItems.pharmacyId, pharmacyId),
      ));

    updated += 1;
  }
  if (insertRows.length > 0) {
    await tx.insert(usedMedicationItems).values(insertRows);
  }

  let deactivated = 0;
  if (options.deleteMissing) {
    const toDeleteIds = existing
      .filter((row: { id: number }) => !seenExistingIds.has(row.id))
      .map((row: { id: number }) => row.id);

    if (toDeleteIds.length > 0) {
      await tx.delete(usedMedicationItems)
        .where(and(
          eq(usedMedicationItems.pharmacyId, pharmacyId),
          inArray(usedMedicationItems.id, toDeleteIds),
        ));
      deactivated = toDeleteIds.length;
    }
  }

  return {
    inserted,
    updated,
    deactivated,
    unchanged,
    totalIncoming: incoming.length,
  };
}
