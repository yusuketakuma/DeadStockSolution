import { and, eq, inArray, type InferInsertModel } from 'drizzle-orm';
import { db } from '../config/database';
import { deadStockItems, usedMedicationItems } from '../db/schema';
import {
  deadStockKey,
  dedupeIncomingByKey,
  normalizeDate,
  usedMedicationKey,
} from '../utils/upload-diff-utils';
import {
  buildDeadStockInsertRow,
  buildUsedMedicationInsertRow,
  type DeadStockDiffInput,
  type PreparedDeadStockDiffInput,
  type UsedMedicationDiffInput,
} from './upload-diff-builders';
import {
  analyzeIncomingDiff,
  type DiffPlan,
} from './upload-diff-analyzer';
import {
  collectMissingIds,
  countMissingRows,
} from './upload-diff-utils';
import {
  insertDeadStockInBatches,
  insertUsedMedicationInBatches,
  updateDeadStockInBatches,
  updateUsedMedicationInBatches,
  type DeadStockExistingRow,
  type UsedMedicationExistingRow,
} from './upload-diff-batch';
import {
  hasDeadStockRowChanged,
  hasUsedMedicationRowChanged,
} from './upload-diff-comparator';

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

interface DiffContext<TIncoming, TExisting extends { id: number }> {
  incomingItems: TIncoming[];
  existing: TExisting[];
  diffPlan: DiffPlan<TIncoming, TExisting>;
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

async function resolveDiffContext<TSource, TIncoming, TExisting extends { id: number }>(
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

function resolveMissingIds<TExisting extends { id: number }>(
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
