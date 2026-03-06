import { and, eq, inArray, sql, type InferInsertModel, type SQL } from 'drizzle-orm';
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

interface DiffContext<TIncoming, TExisting extends WithId> {
  incomingItems: TIncoming[];
  existing: TExisting[];
  diffPlan: DiffPlan<TIncoming, TExisting>;
}

async function processInBatches<T>(
  items: T[],
  batchSize: number,
  processor: (batch: T[]) => Promise<void>,
): Promise<void> {
  for (let start = 0; start < items.length; start += batchSize) {
    await processor(items.slice(start, start + batchSize));
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

async function resolveDiffContext<TSource, TIncoming, TExisting extends WithId>(
  reader: UploadDiffReader,
  pharmacyId: number,
  incoming: TSource[],
  prepareIncoming: (items: TSource[]) => TIncoming[],
  selectExisting: (target: UploadDiffReader, pharmacyId: number) => Promise<TExisting[]>,
  analyzeDiff: (existing: TExisting[], preparedIncoming: TIncoming[]) => DiffPlan<TIncoming, TExisting>,
): Promise<DiffContext<TIncoming, TExisting>> {
  const incomingItems = prepareIncoming(incoming);
  const existing = await selectExisting(reader, pharmacyId);
  const diffPlan = analyzeDiff(existing, incomingItems);
  return { incomingItems, existing, diffPlan };
}

function resolveMissingIds<TExisting extends WithId>(
  deleteMissing: boolean,
  existing: TExisting[],
  seenExistingIds: Set<number>,
  collectMissing: (rows: TExisting[], seenIds: Set<number>) => number[],
): number[] {
  if (!deleteMissing) {
    return [];
  }
  return collectMissing(existing, seenExistingIds);
}

function toNullableDecimalString(value: number | null): string | null {
  return value !== null ? String(value) : null;
}

function buildValuesSql<T>(items: T[], buildRow: (item: T) => SQL): SQL {
  return sql.join(items.map((item) => buildRow(item)), sql`, `);
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

function countMissingRows<TExisting extends WithId>(
  existing: TExisting[],
  seenExistingIds: Set<number>,
  shouldInclude: (row: TExisting) => boolean = () => true,
): number {
  let count = 0;
  for (const row of existing) {
    if (shouldInclude(row) && !seenExistingIds.has(row.id)) {
      count += 1;
    }
  }
  return count;
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

async function updateUsedMedicationInBatches(
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

function prepareUsedMedicationIncoming(incoming: UsedMedicationDiffInput[]): UsedMedicationDiffInput[] {
  return dedupeIncomingByKey(incoming, usedMedicationKey);
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

function countDeadStockDeactivateRows(
  existing: DeadStockExistingRow[],
  seenExistingIds: Set<number>,
): number {
  return countMissingRows(existing, seenExistingIds, (row) => row.isAvailable === true);
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

function countUsedMedicationDeleteRows(
  existing: UsedMedicationExistingRow[],
  seenExistingIds: Set<number>,
): number {
  return countMissingRows(existing, seenExistingIds);
}

function buildDeadStockInsertRow(
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

function buildUsedMedicationInsertRow(
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

export async function previewDeadStockDiff(
  pharmacyId: number,
  incoming: DeadStockDiffInput[],
  options: ApplyDiffOptions,
): Promise<DiffSummary> {
  const context = await resolveDiffContext(
    db,
    pharmacyId,
    incoming,
    prepareDeadStockIncoming,
    selectDeadStockExisting,
    analyzeDeadStockDiff,
  );
  const deactivatedCount = options.deleteMissing
    ? countDeadStockDeactivateRows(context.existing, context.diffPlan.seenExistingIds)
    : 0;
  return summarizeDiff(context.diffPlan, deactivatedCount, context.incomingItems.length);
}

export async function applyDeadStockDiff(
  tx: UploadDiffTx,
  pharmacyId: number,
  uploadId: number,
  incoming: DeadStockDiffInput[],
  options: ApplyDiffOptions,
): Promise<DiffSummary> {
  const context = await resolveDiffContext(
    tx,
    pharmacyId,
    incoming,
    prepareDeadStockIncoming,
    selectDeadStockExisting,
    analyzeDeadStockDiff,
  );
  const insertRows = context.diffPlan.insertedItems.map((item) => buildDeadStockInsertRow(pharmacyId, uploadId, item));

  if (context.diffPlan.updatedPairs.length > 0) {
    await updateDeadStockInBatches(tx, pharmacyId, uploadId, context.diffPlan.updatedPairs);
  }

  if (insertRows.length > 0) {
    await insertDeadStockInBatches(tx, insertRows);
  }

  const toDeactivateIds = resolveMissingIds(
    options.deleteMissing,
    context.existing,
    context.diffPlan.seenExistingIds,
    collectDeadStockDeactivateIds,
  );
  let deactivated = 0;
  if (toDeactivateIds.length > 0) {
    await tx.update(deadStockItems)
      .set({ isAvailable: false })
      .where(and(
        eq(deadStockItems.pharmacyId, pharmacyId),
        inArray(deadStockItems.id, toDeactivateIds),
      ));
    deactivated = toDeactivateIds.length;
  }

  return summarizeDiff(context.diffPlan, deactivated, context.incomingItems.length);
}

export async function previewUsedMedicationDiff(
  pharmacyId: number,
  incoming: UsedMedicationDiffInput[],
  options: ApplyDiffOptions,
): Promise<DiffSummary> {
  const context = await resolveDiffContext(
    db,
    pharmacyId,
    incoming,
    prepareUsedMedicationIncoming,
    selectUsedMedicationExisting,
    analyzeUsedMedicationDiff,
  );
  const deletedCount = options.deleteMissing
    ? countUsedMedicationDeleteRows(context.existing, context.diffPlan.seenExistingIds)
    : 0;
  return summarizeDiff(context.diffPlan, deletedCount, context.incomingItems.length);
}

export async function applyUsedMedicationDiff(
  tx: UploadDiffTx,
  pharmacyId: number,
  uploadId: number,
  incoming: UsedMedicationDiffInput[],
  options: ApplyDiffOptions,
): Promise<DiffSummary> {
  const context = await resolveDiffContext(
    tx,
    pharmacyId,
    incoming,
    prepareUsedMedicationIncoming,
    selectUsedMedicationExisting,
    analyzeUsedMedicationDiff,
  );
  const insertRows = context.diffPlan.insertedItems.map((item) => buildUsedMedicationInsertRow(pharmacyId, uploadId, item));

  if (context.diffPlan.updatedPairs.length > 0) {
    await updateUsedMedicationInBatches(tx, pharmacyId, uploadId, context.diffPlan.updatedPairs);
  }

  if (insertRows.length > 0) {
    await insertUsedMedicationInBatches(tx, insertRows);
  }

  const toDeleteIds = resolveMissingIds(
    options.deleteMissing,
    context.existing,
    context.diffPlan.seenExistingIds,
    collectUsedMedicationDeleteIds,
  );
  let deleted = 0;
  if (toDeleteIds.length > 0) {
    await tx.delete(usedMedicationItems)
      .where(and(
        eq(usedMedicationItems.pharmacyId, pharmacyId),
        inArray(usedMedicationItems.id, toDeleteIds),
      ));
    deleted = toDeleteIds.length;
  }

  return summarizeDiff(context.diffPlan, deleted, context.incomingItems.length);
}
