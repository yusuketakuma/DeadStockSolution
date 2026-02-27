import { and, eq, inArray, type InferInsertModel } from 'drizzle-orm';
import { db } from '../config/database';
import { deadStockItems, usedMedicationItems } from '../db/schema';
import {
  buildExistingByKey,
  deadStockKey,
  dedupeIncomingByKey,
  equalNullableNumber,
  normalizeDate,
  normalizeNullableNumber,
  normalizeString,
  usedMedicationKey,
} from '../utils/upload-diff-utils';

const DIFF_INSERT_BATCH_SIZE = 500;

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

type PreparedDeadStockDiffInput = DeadStockDiffInput & { normalizedDate: string | null };

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

interface DeadStockExistingRow extends DeadStockComparableRow {
  id: number;
  drugCode: string | null;
  drugName: string;
}

interface UsedMedicationExistingRow extends UsedMedicationComparableRow {
  id: number;
  drugCode: string | null;
  drugName: string;
  unit: string | null;
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

type UploadDiffTx = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete'>;
type UploadDiffReader = Pick<typeof db, 'select'>;
type DeadStockInsertRow = InferInsertModel<typeof deadStockItems>;
type UsedMedicationInsertRow = InferInsertModel<typeof usedMedicationItems>;

async function insertDeadStockInBatches(tx: UploadDiffTx, rows: DeadStockInsertRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += DIFF_INSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + DIFF_INSERT_BATCH_SIZE);
    await tx.insert(deadStockItems).values(batch);
  }
}

async function insertUsedMedicationInBatches(tx: UploadDiffTx, rows: UsedMedicationInsertRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += DIFF_INSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + DIFF_INSERT_BATCH_SIZE);
    await tx.insert(usedMedicationItems).values(batch);
  }
}

function prepareDeadStockIncoming(incoming: DeadStockDiffInput[]): PreparedDeadStockDiffInput[] {
  const deduped = new Map<string, PreparedDeadStockDiffInput>();
  for (const item of incoming) {
    const normalizedDate = normalizeDate(item.expirationDate);
    const key = deadStockKey({
      drugCode: item.drugCode,
      drugName: item.drugName,
      unit: item.unit,
      expirationDate: normalizedDate,
      lotNumber: item.lotNumber,
    });
    deduped.set(key, { ...item, normalizedDate });
  }
  return [...deduped.values()];
}

function hasDeadStockRowChanged(current: DeadStockComparableRow, item: PreparedDeadStockDiffInput): boolean {
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

function hasUsedMedicationRowChanged(current: UsedMedicationComparableRow, item: UsedMedicationDiffInput): boolean {
  return (
    (current.drugMasterId ?? null) !== (item.drugMasterId ?? null) ||
    (current.drugMasterPackageId ?? null) !== (item.drugMasterPackageId ?? null) ||
    normalizeString(current.packageLabel) !== normalizeString(item.packageLabel) ||
    !equalNullableNumber(current.monthlyUsage, normalizeNullableNumber(item.monthlyUsage)) ||
    !equalNullableNumber(current.yakkaUnitPrice, normalizeNullableNumber(item.yakkaUnitPrice))
  );
}

async function selectDeadStockExisting(
  reader: UploadDiffReader,
  pharmacyId: number,
): Promise<DeadStockExistingRow[]> {
  return reader.select({
    id: deadStockItems.id,
    drugCode: deadStockItems.drugCode,
    drugName: deadStockItems.drugName,
    drugMasterId: deadStockItems.drugMasterId,
    drugMasterPackageId: deadStockItems.drugMasterPackageId,
    packageLabel: deadStockItems.packageLabel,
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
}

async function selectUsedMedicationExisting(
  reader: UploadDiffReader,
  pharmacyId: number,
): Promise<UsedMedicationExistingRow[]> {
  return reader.select({
    id: usedMedicationItems.id,
    drugCode: usedMedicationItems.drugCode,
    drugName: usedMedicationItems.drugName,
    drugMasterId: usedMedicationItems.drugMasterId,
    drugMasterPackageId: usedMedicationItems.drugMasterPackageId,
    packageLabel: usedMedicationItems.packageLabel,
    unit: usedMedicationItems.unit,
    monthlyUsage: usedMedicationItems.monthlyUsage,
    yakkaUnitPrice: usedMedicationItems.yakkaUnitPrice,
  })
    .from(usedMedicationItems)
    .where(eq(usedMedicationItems.pharmacyId, pharmacyId));
}

interface DeadStockDiffPlan {
  insertedItems: PreparedDeadStockDiffInput[];
  updatedPairs: Array<{ current: DeadStockExistingRow; item: PreparedDeadStockDiffInput }>;
  unchanged: number;
  seenExistingIds: Set<number>;
}

function analyzeDeadStockDiff(
  existing: DeadStockExistingRow[],
  dedupedIncoming: PreparedDeadStockDiffInput[],
): DeadStockDiffPlan {
  const existingByKey = buildExistingByKey(existing, (row) => deadStockKey({
    drugCode: row.drugCode,
    drugName: row.drugName,
    unit: row.unit,
    expirationDate: row.expirationDateIso ?? row.expirationDate,
    lotNumber: row.lotNumber,
  }));

  const insertedItems: PreparedDeadStockDiffInput[] = [];
  const updatedPairs: Array<{ current: DeadStockExistingRow; item: PreparedDeadStockDiffInput }> = [];
  let unchanged = 0;
  const seenExistingIds = new Set<number>();

  for (const item of dedupedIncoming) {
    const key = deadStockKey({
      drugCode: item.drugCode,
      drugName: item.drugName,
      unit: item.unit,
      expirationDate: item.normalizedDate,
      lotNumber: item.lotNumber,
    });

    const current = existingByKey.get(key);
    if (!current) {
      insertedItems.push(item);
      continue;
    }

    seenExistingIds.add(current.id);
    if (hasDeadStockRowChanged(current, item)) {
      updatedPairs.push({ current, item });
      continue;
    }

    unchanged += 1;
  }

  return {
    insertedItems,
    updatedPairs,
    unchanged,
    seenExistingIds,
  };
}

function collectDeadStockDeactivateIds(
  existing: DeadStockExistingRow[],
  seenExistingIds: Set<number>,
): number[] {
  return existing
    .filter((row) => row.isAvailable && !seenExistingIds.has(row.id))
    .map((row) => row.id);
}

interface UsedMedicationDiffPlan {
  insertedItems: UsedMedicationDiffInput[];
  updatedPairs: Array<{ current: UsedMedicationExistingRow; item: UsedMedicationDiffInput }>;
  unchanged: number;
  seenExistingIds: Set<number>;
}

function analyzeUsedMedicationDiff(
  existing: UsedMedicationExistingRow[],
  dedupedIncoming: UsedMedicationDiffInput[],
): UsedMedicationDiffPlan {
  const existingByKey = buildExistingByKey(existing, (row) => usedMedicationKey({
    drugCode: row.drugCode,
    drugName: row.drugName,
    unit: row.unit,
  }));

  const insertedItems: UsedMedicationDiffInput[] = [];
  const updatedPairs: Array<{ current: UsedMedicationExistingRow; item: UsedMedicationDiffInput }> = [];
  let unchanged = 0;
  const seenExistingIds = new Set<number>();

  for (const item of dedupedIncoming) {
    const key = usedMedicationKey(item);
    const current = existingByKey.get(key);
    if (!current) {
      insertedItems.push(item);
      continue;
    }

    seenExistingIds.add(current.id);
    if (hasUsedMedicationRowChanged(current, item)) {
      updatedPairs.push({ current, item });
      continue;
    }

    unchanged += 1;
  }

  return {
    insertedItems,
    updatedPairs,
    unchanged,
    seenExistingIds,
  };
}

function collectUsedMedicationDeleteIds(
  existing: UsedMedicationExistingRow[],
  seenExistingIds: Set<number>,
): number[] {
  return existing
    .filter((row) => !seenExistingIds.has(row.id))
    .map((row) => row.id);
}

export async function previewDeadStockDiff(
  pharmacyId: number,
  incoming: DeadStockDiffInput[],
  options: ApplyDiffOptions,
): Promise<DiffSummary> {
  const dedupedIncoming = prepareDeadStockIncoming(incoming);
  const existing = await selectDeadStockExisting(db, pharmacyId);
  const diffPlan = analyzeDeadStockDiff(existing, dedupedIncoming);

  const deactivated = options.deleteMissing
    ? collectDeadStockDeactivateIds(existing, diffPlan.seenExistingIds).length
    : 0;

  return {
    inserted: diffPlan.insertedItems.length,
    updated: diffPlan.updatedPairs.length,
    deactivated,
    unchanged: diffPlan.unchanged,
    totalIncoming: dedupedIncoming.length,
  };
}

export async function applyDeadStockDiff(
  tx: UploadDiffTx,
  pharmacyId: number,
  uploadId: number,
  incoming: DeadStockDiffInput[],
  options: ApplyDiffOptions,
): Promise<DiffSummary> {
  const dedupedIncoming = prepareDeadStockIncoming(incoming);
  const existing = await selectDeadStockExisting(tx, pharmacyId);
  const diffPlan = analyzeDeadStockDiff(existing, dedupedIncoming);
  const insertRows: DeadStockInsertRow[] = diffPlan.insertedItems.map((item) => ({
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
    expirationDateIso: item.normalizedDate,
    lotNumber: item.lotNumber,
    isAvailable: true,
  }));

  for (const { current, item } of diffPlan.updatedPairs) {
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
        expirationDateIso: item.normalizedDate,
        lotNumber: item.lotNumber,
        isAvailable: true,
      })
      .where(and(
        eq(deadStockItems.id, current.id),
        eq(deadStockItems.pharmacyId, pharmacyId),
      ));
  }

  if (insertRows.length > 0) {
    await insertDeadStockInBatches(tx, insertRows);
  }

  let deactivated = 0;
  if (options.deleteMissing) {
    const toDeactivateIds = collectDeadStockDeactivateIds(existing, diffPlan.seenExistingIds);

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
    inserted: diffPlan.insertedItems.length,
    updated: diffPlan.updatedPairs.length,
    deactivated,
    unchanged: diffPlan.unchanged,
    totalIncoming: dedupedIncoming.length,
  };
}

export async function previewUsedMedicationDiff(
  pharmacyId: number,
  incoming: UsedMedicationDiffInput[],
  options: ApplyDiffOptions,
): Promise<DiffSummary> {
  const dedupedIncoming = dedupeIncomingByKey(incoming, usedMedicationKey);
  const existing = await selectUsedMedicationExisting(db, pharmacyId);
  const diffPlan = analyzeUsedMedicationDiff(existing, dedupedIncoming);

  const deactivated = options.deleteMissing
    ? collectUsedMedicationDeleteIds(existing, diffPlan.seenExistingIds).length
    : 0;

  return {
    inserted: diffPlan.insertedItems.length,
    updated: diffPlan.updatedPairs.length,
    deactivated,
    unchanged: diffPlan.unchanged,
    totalIncoming: dedupedIncoming.length,
  };
}

export async function applyUsedMedicationDiff(
  tx: UploadDiffTx,
  pharmacyId: number,
  uploadId: number,
  incoming: UsedMedicationDiffInput[],
  options: ApplyDiffOptions,
): Promise<DiffSummary> {
  const dedupedIncoming = dedupeIncomingByKey(incoming, usedMedicationKey);
  const existing = await selectUsedMedicationExisting(tx, pharmacyId);
  const diffPlan = analyzeUsedMedicationDiff(existing, dedupedIncoming);
  const insertRows: UsedMedicationInsertRow[] = diffPlan.insertedItems.map((item) => ({
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
  }));

  for (const { current, item } of diffPlan.updatedPairs) {
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
  }

  if (insertRows.length > 0) {
    await insertUsedMedicationInBatches(tx, insertRows);
  }

  let deactivated = 0;
  if (options.deleteMissing) {
    const toDeleteIds = collectUsedMedicationDeleteIds(existing, diffPlan.seenExistingIds);

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
    inserted: diffPlan.insertedItems.length,
    updated: diffPlan.updatedPairs.length,
    deactivated,
    unchanged: diffPlan.unchanged,
    totalIncoming: dedupedIncoming.length,
  };
}
