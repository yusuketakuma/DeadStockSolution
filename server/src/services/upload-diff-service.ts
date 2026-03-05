import { and, eq, inArray, sql, type InferInsertModel } from 'drizzle-orm';
import { db } from '../config/database';
import { deadStockItems, usedMedicationItems } from '../db/schema';
import { splitIntoChunks } from '../utils/array-utils';
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
const DIFF_UPDATE_BATCH_SIZE = 250;

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

type UploadDiffTx = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;
type UploadDiffReader = Pick<typeof db, 'select'>;
type DeadStockInsertRow = InferInsertModel<typeof deadStockItems>;
type UsedMedicationInsertRow = InferInsertModel<typeof usedMedicationItems>;
type WithId = { id: number };

interface DiffPlan<TIncoming, TExisting extends WithId> {
  insertedItems: TIncoming[];
  updatedPairs: Array<{ current: TExisting; item: TIncoming }>;
  unchanged: number;
  seenExistingIds: Set<number>;
}

async function processInBatches<T>(
  items: T[],
  batchSize: number,
  processor: (batch: T[]) => Promise<void>,
): Promise<void> {
  const batches = splitIntoChunks(items, batchSize);
  for (const batch of batches) {
    await processor(batch);
  }
}

function summarizeDiff(
  diffPlan: { insertedItems: unknown[]; updatedPairs: unknown[]; unchanged: number },
  deactivated: number,
  totalIncoming: number,
): DiffSummary {
  return {
    inserted: diffPlan.insertedItems.length,
    updated: diffPlan.updatedPairs.length,
    deactivated,
    unchanged: diffPlan.unchanged,
    totalIncoming,
  };
}

function analyzeIncomingDiff<TIncoming, TExisting extends WithId>(
  existing: TExisting[],
  incoming: TIncoming[],
  buildKeyForExisting: (row: TExisting) => string,
  buildKeyForIncoming: (item: TIncoming) => string,
  hasRowChanged: (current: TExisting, item: TIncoming) => boolean,
): DiffPlan<TIncoming, TExisting> {
  const existingByKey = buildExistingByKey(existing, buildKeyForExisting);
  const insertedItems: TIncoming[] = [];
  const updatedPairs: Array<{ current: TExisting; item: TIncoming }> = [];
  const seenExistingIds = new Set<number>();
  let unchanged = 0;

  for (const item of incoming) {
    const current = existingByKey.get(buildKeyForIncoming(item));
    if (!current) {
      insertedItems.push(item);
      continue;
    }

    seenExistingIds.add(current.id);
    if (hasRowChanged(current, item)) {
      updatedPairs.push({ current, item });
      continue;
    }

    unchanged += 1;
  }

  return { insertedItems, updatedPairs, unchanged, seenExistingIds };
}

function collectMissingIds<TExisting extends WithId>(
  existing: TExisting[],
  seenExistingIds: Set<number>,
  shouldInclude: (row: TExisting) => boolean = () => true,
): number[] {
  return existing
    .filter((row) => shouldInclude(row) && !seenExistingIds.has(row.id))
    .map((row) => row.id);
}

async function insertDeadStockInBatches(tx: UploadDiffTx, rows: DeadStockInsertRow[]): Promise<void> {
  await processInBatches(rows, DIFF_INSERT_BATCH_SIZE, async (batch) => {
    await tx.insert(deadStockItems).values(batch);
  });
}

async function insertUsedMedicationInBatches(tx: UploadDiffTx, rows: UsedMedicationInsertRow[]): Promise<void> {
  await processInBatches(rows, DIFF_INSERT_BATCH_SIZE, async (batch) => {
    await tx.insert(usedMedicationItems).values(batch);
  });
}

async function updateDeadStockInBatches(
  tx: UploadDiffTx,
  pharmacyId: number,
  uploadId: number,
  updatedPairs: Array<{ current: DeadStockExistingRow; item: PreparedDeadStockDiffInput }>,
): Promise<void> {
  await processInBatches(updatedPairs, DIFF_UPDATE_BATCH_SIZE, async (batch) => {
    const updateRowsSql = sql.join(batch.map(({ current, item }) => sql`(
      ${current.id},
      ${uploadId},
      ${item.drugMasterId ?? null},
      ${item.drugMasterPackageId ?? null},
      ${item.packageLabel ?? null},
      ${item.quantity},
      ${item.unit},
      ${item.yakkaUnitPrice !== null ? String(item.yakkaUnitPrice) : null},
      ${item.yakkaTotal !== null ? String(item.yakkaTotal) : null},
      ${item.expirationDate},
      ${item.normalizedDate},
      ${item.lotNumber}
    )`), sql`, `);

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

async function updateUsedMedicationInBatches(
  tx: UploadDiffTx,
  pharmacyId: number,
  uploadId: number,
  updatedPairs: Array<{ current: UsedMedicationExistingRow; item: UsedMedicationDiffInput }>,
): Promise<void> {
  await processInBatches(updatedPairs, DIFF_UPDATE_BATCH_SIZE, async (batch) => {
    const updateRowsSql = sql.join(batch.map(({ current, item }) => sql`(
      ${current.id},
      ${uploadId},
      ${item.drugMasterId ?? null},
      ${item.drugMasterPackageId ?? null},
      ${item.packageLabel ?? null},
      ${item.monthlyUsage},
      ${item.unit},
      ${item.yakkaUnitPrice !== null ? String(item.yakkaUnitPrice) : null}
    )`), sql`, `);

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

function analyzeDeadStockDiff(
  existing: DeadStockExistingRow[],
  dedupedIncoming: PreparedDeadStockDiffInput[],
): DiffPlan<PreparedDeadStockDiffInput, DeadStockExistingRow> {
  return analyzeIncomingDiff(
    existing,
    dedupedIncoming,
    (row) => deadStockKey({
      drugCode: row.drugCode,
      drugName: row.drugName,
      unit: row.unit,
      expirationDate: row.expirationDateIso ?? row.expirationDate,
      lotNumber: row.lotNumber,
    }),
    (item) => deadStockKey({
      drugCode: item.drugCode,
      drugName: item.drugName,
      unit: item.unit,
      expirationDate: item.normalizedDate,
      lotNumber: item.lotNumber,
    }),
    hasDeadStockRowChanged,
  );
}

function collectDeadStockDeactivateIds(
  existing: DeadStockExistingRow[],
  seenExistingIds: Set<number>,
): number[] {
  return collectMissingIds(existing, seenExistingIds, (row) => row.isAvailable === true);
}

function analyzeUsedMedicationDiff(
  existing: UsedMedicationExistingRow[],
  dedupedIncoming: UsedMedicationDiffInput[],
): DiffPlan<UsedMedicationDiffInput, UsedMedicationExistingRow> {
  return analyzeIncomingDiff(
    existing,
    dedupedIncoming,
    (row) => usedMedicationKey({
      drugCode: row.drugCode,
      drugName: row.drugName,
      unit: row.unit,
    }),
    usedMedicationKey,
    hasUsedMedicationRowChanged,
  );
}

function collectUsedMedicationDeleteIds(
  existing: UsedMedicationExistingRow[],
  seenExistingIds: Set<number>,
): number[] {
  return collectMissingIds(existing, seenExistingIds);
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

  return summarizeDiff(diffPlan, deactivated, dedupedIncoming.length);
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

  if (diffPlan.updatedPairs.length > 0) {
    await updateDeadStockInBatches(tx, pharmacyId, uploadId, diffPlan.updatedPairs);
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

  return summarizeDiff(diffPlan, deactivated, dedupedIncoming.length);
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

  return summarizeDiff(diffPlan, deactivated, dedupedIncoming.length);
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

  if (diffPlan.updatedPairs.length > 0) {
    await updateUsedMedicationInBatches(tx, pharmacyId, uploadId, diffPlan.updatedPairs);
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

  return summarizeDiff(diffPlan, deactivated, dedupedIncoming.length);
}
