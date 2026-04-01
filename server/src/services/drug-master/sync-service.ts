import { eq, inArray } from 'drizzle-orm';
import { db } from '../../config/database';
import {
  drugMaster,
  drugMasterPackages,
  drugMasterPriceHistory,
  drugMasterSyncLogs,
} from '../../db/schema';
import { invalidateDrugMasterLookupCache } from './lookup-service';
import { normalizePackageInfo } from '../../utils/package-utils';
import { ParsedDrugRow, ParsedPackageRow } from './parser-service';

// ── 型定義 ──────────────────────────────────────────

export interface SyncResult {
  itemsProcessed: number;
  itemsAdded: number;
  itemsUpdated: number;
  itemsDeleted: number;
}

// ── 同期処理 ─────────────────────────────────────────

const BATCH_SIZE = 500;
const PRICE_COMPARISON_EPSILON = 0.001;

type InsertDrugMasterRow = typeof drugMaster.$inferInsert;
type InsertPriceHistoryRow = typeof drugMasterPriceHistory.$inferInsert;
type InsertPackageRow = typeof drugMasterPackages.$inferInsert;
type SyncLogRow = typeof drugMasterSyncLogs.$inferSelect;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type PackageUpdateValues = Omit<InsertPackageRow, 'drugMasterId'> & { updatedAt: string };
type UpdateDrugMasterFields = Omit<InsertDrugMasterRow, 'yjCode' | 'id' | 'createdAt'>;
type UpdateDrugMasterItem = {
  yjCode: string;
  fields: UpdateDrugMasterFields;
};
type DelistingPayload = {
  codes: string[];
  priceHistory: InsertPriceHistoryRow[];
};
type ExistingPackage = {
  id: number;
  drugMasterId: number;
  gs1Code: string | null;
  janCode: string | null;
  hotCode: string | null;
  packageDescription: string | null;
  packageQuantity: number | null;
  packageUnit: string | null;
  normalizedPackageLabel: string | null;
  packageForm: string | null;
  isLoosePackage: boolean;
};

interface ExistingDrugMasterForSync {
  yjCode: string;
  drugName: string;
  genericName: string | null;
  specification: string | null;
  unit: string | null;
  yakkaPrice: string;
  manufacturer: string | null;
  category: string | null;
  therapeuticCategory: string | null;
  isListed: boolean;
  listedDate: string | null;
  transitionDeadline: string | null;
  deletedDate: string | null;
}

interface PackageBucket {
  byGs1: Map<string, ExistingPackage>;
  byJan: Map<string, ExistingPackage>;
  byHot: Map<string, ExistingPackage>;
}

interface PackageLookupState {
  yjToId: Map<string, number>;
  buckets: Map<number, PackageBucket>;
}

interface PackageMutationCounts {
  added: number;
  updated: number;
}

const PACKAGE_CODE_CONFIG = [
  { rowField: 'gs1Code', bucketField: 'byGs1' },
  { rowField: 'janCode', bucketField: 'byJan' },
  { rowField: 'hotCode', bucketField: 'byHot' },
] as const;

async function processInBatches<T>(
  items: T[],
  batchSize: number,
  processor: (batch: T[]) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    await processor(items.slice(i, i + batchSize));
  }
}

function buildDrugMasterInsertRow(row: ParsedDrugRow, now: string): InsertDrugMasterRow {
  const fields = buildDrugMasterMutableFields(row);
  return {
    yjCode: row.yjCode,
    ...fields,
    isListed: true,
    updatedAt: now,
  };
}

function buildDrugMasterUpdateFields(row: ParsedDrugRow, now: string): UpdateDrugMasterFields {
  const fields = buildDrugMasterMutableFields(row);
  return {
    ...fields,
    isListed: true,
    deletedDate: null,
    updatedAt: now,
  };
}

function buildDrugMasterMutableFields(
  row: ParsedDrugRow,
): Omit<UpdateDrugMasterFields, 'isListed' | 'deletedDate' | 'updatedAt'> {
  return {
    drugName: row.drugName,
    genericName: row.genericName,
    specification: row.specification,
    unit: row.unit,
    yakkaPrice: String(row.yakkaPrice),
    manufacturer: row.manufacturer,
    category: row.category,
    therapeuticCategory: row.therapeuticCategory,
    listedDate: row.listedDate,
    transitionDeadline: row.transitionDeadline,
  };
}

function buildPriceHistoryRow(params: {
  yjCode: string;
  previousPrice: string | null;
  newPrice: string | null;
  revisionDate: string;
  revisionType: InsertPriceHistoryRow['revisionType'];
}): InsertPriceHistoryRow {
  return {
    yjCode: params.yjCode,
    previousPrice: params.previousPrice,
    newPrice: params.newPrice,
    revisionDate: params.revisionDate,
    revisionType: params.revisionType,
  };
}

function hasMetadataChanged(existing: ExistingDrugMasterForSync, row: ParsedDrugRow): boolean {
  return (
    existing.drugName !== row.drugName ||
    existing.genericName !== row.genericName ||
    existing.specification !== row.specification ||
    existing.unit !== row.unit ||
    existing.manufacturer !== row.manufacturer ||
    existing.category !== row.category ||
    existing.therapeuticCategory !== row.therapeuticCategory ||
    existing.listedDate !== row.listedDate ||
    existing.transitionDeadline !== row.transitionDeadline ||
    existing.deletedDate !== null
  );
}

function evaluateDrugMasterUpdate(existing: ExistingDrugMasterForSync, row: ParsedDrugRow): {
  priceChanged: boolean;
  wasDelisted: boolean;
  shouldUpdate: boolean;
} {
  const priceChanged = Math.abs(Number(existing.yakkaPrice) - row.yakkaPrice) > PRICE_COMPARISON_EPSILON;
  const wasDelisted = !existing.isListed;
  const shouldUpdate = priceChanged || wasDelisted || hasMetadataChanged(existing, row);
  return { priceChanged, wasDelisted, shouldUpdate };
}

function normalizePackage(row: ParsedPackageRow): ReturnType<typeof normalizePackageInfo> {
  return normalizePackageInfo({
    packageDescription: row.packageDescription,
    packageQuantity: row.packageQuantity,
    packageUnit: row.packageUnit,
  });
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

async function fetchDrugMasterIdMap(parsedRows: ParsedPackageRow[]): Promise<Map<string, number>> {
  const yjCodes = unique(parsedRows.map((row) => row.yjCode));
  if (yjCodes.length === 0) {
    return new Map();
  }

  const masterItems = await db.select({ id: drugMaster.id, yjCode: drugMaster.yjCode })
    .from(drugMaster)
    .where(inArray(drugMaster.yjCode, yjCodes));
  return new Map(masterItems.map((item) => [item.yjCode, item.id]));
}

async function fetchExistingPackages(drugMasterIds: number[]): Promise<ExistingPackage[]> {
  if (drugMasterIds.length === 0) {
    return [];
  }

  return db.select({
    id: drugMasterPackages.id,
    drugMasterId: drugMasterPackages.drugMasterId,
    gs1Code: drugMasterPackages.gs1Code,
    janCode: drugMasterPackages.janCode,
    hotCode: drugMasterPackages.hotCode,
    packageDescription: drugMasterPackages.packageDescription,
    packageQuantity: drugMasterPackages.packageQuantity,
    packageUnit: drugMasterPackages.packageUnit,
    normalizedPackageLabel: drugMasterPackages.normalizedPackageLabel,
    packageForm: drugMasterPackages.packageForm,
    isLoosePackage: drugMasterPackages.isLoosePackage,
  })
    .from(drugMasterPackages)
    .where(inArray(drugMasterPackages.drugMasterId, drugMasterIds));
}

function createPackageBucket(): PackageBucket {
  return {
    byGs1: new Map(),
    byJan: new Map(),
    byHot: new Map(),
  };
}

function ensurePackageBucket(
  buckets: Map<number, PackageBucket>,
  drugMasterId: number,
): PackageBucket {
  const existing = buckets.get(drugMasterId);
  if (existing) {
    return existing;
  }

  const created = createPackageBucket();
  buckets.set(drugMasterId, created);
  return created;
}

function addPackageToBuckets(buckets: Map<number, PackageBucket>, pkg: ExistingPackage): void {
  const bucket = ensurePackageBucket(buckets, pkg.drugMasterId);
  for (const config of PACKAGE_CODE_CONFIG) {
    const code = pkg[config.rowField];
    if (!code) continue;
    bucket[config.bucketField].set(code, pkg);
  }
}

function removePackageFromBuckets(buckets: Map<number, PackageBucket>, pkg: ExistingPackage): void {
  const bucket = buckets.get(pkg.drugMasterId);
  if (!bucket) return;
  for (const config of PACKAGE_CODE_CONFIG) {
    const code = pkg[config.rowField];
    if (!code) continue;
    bucket[config.bucketField].delete(code);
  }
}

function findExistingPackage(
  buckets: Map<number, PackageBucket>,
  drugMasterId: number,
  row: ParsedPackageRow,
): ExistingPackage | null {
  const bucket = buckets.get(drugMasterId);
  if (!bucket) return null;
  for (const config of PACKAGE_CODE_CONFIG) {
    const code = row[config.rowField] ?? null;
    if (!code) continue;

    const hit = bucket[config.bucketField].get(code);
    if (hit) return hit;
  }

  return null;
}

function buildPackageLookupState(
  yjToId: Map<string, number>,
  existingPackages: ExistingPackage[],
): PackageLookupState {
  const buckets = new Map<number, PackageBucket>();
  for (const pkg of existingPackages) {
    addPackageToBuckets(buckets, pkg);
  }
  return { yjToId, buckets };
}

function buildPackageUpdateValues(row: ParsedPackageRow, existingPkg: ExistingPackage): PackageUpdateValues {
  const normalized = normalizePackage(row);
  return {
    gs1Code: row.gs1Code ?? existingPkg.gs1Code,
    janCode: row.janCode ?? existingPkg.janCode,
    hotCode: row.hotCode ?? existingPkg.hotCode,
    packageDescription: row.packageDescription ?? existingPkg.packageDescription,
    packageQuantity: row.packageQuantity ?? existingPkg.packageQuantity,
    packageUnit: row.packageUnit ?? existingPkg.packageUnit,
    normalizedPackageLabel: normalized.normalizedPackageLabel ?? existingPkg.normalizedPackageLabel,
    packageForm: normalized.packageForm ?? existingPkg.packageForm,
    isLoosePackage: normalized.isLoosePackage,
    updatedAt: new Date().toISOString(),
  };
}

function buildPackageInsertRow(drugMasterId: number, row: ParsedPackageRow): InsertPackageRow {
  const normalized = normalizePackage(row);
  return {
    drugMasterId,
    gs1Code: row.gs1Code,
    janCode: row.janCode,
    hotCode: row.hotCode,
    packageDescription: row.packageDescription,
    packageQuantity: row.packageQuantity,
    packageUnit: row.packageUnit,
    normalizedPackageLabel: normalized.normalizedPackageLabel,
    packageForm: normalized.packageForm,
    isLoosePackage: normalized.isLoosePackage,
  };
}

async function insertPackageBatch(
  tx: Transaction,
  buckets: Map<number, PackageBucket>,
  toInsert: InsertPackageRow[],
): Promise<void> {
  if (toInsert.length === 0) {
    return;
  }

  const created = await tx.insert(drugMasterPackages).values(toInsert).returning({
    id: drugMasterPackages.id,
    drugMasterId: drugMasterPackages.drugMasterId,
    gs1Code: drugMasterPackages.gs1Code,
    janCode: drugMasterPackages.janCode,
    hotCode: drugMasterPackages.hotCode,
    packageDescription: drugMasterPackages.packageDescription,
    packageQuantity: drugMasterPackages.packageQuantity,
    packageUnit: drugMasterPackages.packageUnit,
    normalizedPackageLabel: drugMasterPackages.normalizedPackageLabel,
    packageForm: drugMasterPackages.packageForm,
    isLoosePackage: drugMasterPackages.isLoosePackage,
  });

  for (const pkg of created) {
    addPackageToBuckets(buckets, pkg);
  }
}

async function syncPackageBatch(
  tx: Transaction,
  batch: ParsedPackageRow[],
  lookup: PackageLookupState,
  counts: PackageMutationCounts,
): Promise<void> {
  const toInsert: InsertPackageRow[] = [];

  for (const row of batch) {
    const drugMasterId = lookup.yjToId.get(row.yjCode);
    if (!drugMasterId) continue;

    const existingPkg = findExistingPackage(lookup.buckets, drugMasterId, row);
    if (!existingPkg) {
      toInsert.push(buildPackageInsertRow(drugMasterId, row));
      counts.added++;
      continue;
    }

    const nextValues = buildPackageUpdateValues(row, existingPkg);
    await tx.update(drugMasterPackages)
      .set(nextValues)
      .where(eq(drugMasterPackages.id, existingPkg.id));

    removePackageFromBuckets(lookup.buckets, existingPkg);
    const { updatedAt: _updatedAt, ...cacheValues } = nextValues;
    addPackageToBuckets(lookup.buckets, { ...existingPkg, ...cacheValues });
    counts.updated++;
  }

  await insertPackageBatch(tx, lookup.buckets, toInsert);
}

function assertNoDuplicateYjCodes(parsedRows: ParsedDrugRow[]): ParsedDrugRow[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const row of parsedRows) {
    if (seen.has(row.yjCode)) {
      duplicates.add(row.yjCode);
      continue;
    }
    seen.add(row.yjCode);
  }

  if (duplicates.size > 0) {
    const duplicateSamples = [...duplicates].slice(0, 10);
    throw new Error(`YJコードが重複しています: ${duplicateSamples.join(', ')}`);
  }

  return parsedRows;
}

function collectDrugMasterBatchChanges(params: {
  batch: ParsedDrugRow[];
  existingMap: Map<string, ExistingDrugMasterForSync>;
  now: string;
  revisionDate: string;
  result: SyncResult;
}): {
  toInsert: InsertDrugMasterRow[];
  toUpdate: UpdateDrugMasterItem[];
  priceHistoryToInsert: InsertPriceHistoryRow[];
} {
  const { batch, existingMap, now, revisionDate, result } = params;
  const toInsert: InsertDrugMasterRow[] = [];
  const toUpdate: UpdateDrugMasterItem[] = [];
  const priceHistoryToInsert: InsertPriceHistoryRow[] = [];

  for (const row of batch) {
    const existing = existingMap.get(row.yjCode);
    result.itemsProcessed++;

    if (!existing) {
      toInsert.push(buildDrugMasterInsertRow(row, now));
      priceHistoryToInsert.push(buildPriceHistoryRow({
        yjCode: row.yjCode,
        previousPrice: null,
        newPrice: String(row.yakkaPrice),
        revisionDate,
        revisionType: 'new_listing',
      }));

      result.itemsAdded++;
      continue;
    }

    const { priceChanged, wasDelisted, shouldUpdate } = evaluateDrugMasterUpdate(existing, row);
    if (!shouldUpdate) {
      continue;
    }

    toUpdate.push({
      yjCode: row.yjCode,
      fields: buildDrugMasterUpdateFields(row, now),
    });

    if (priceChanged) {
      priceHistoryToInsert.push(buildPriceHistoryRow({
        yjCode: row.yjCode,
        previousPrice: existing.yakkaPrice,
        newPrice: String(row.yakkaPrice),
        revisionDate,
        revisionType: wasDelisted ? 'new_listing' : 'price_revision',
      }));
    }

    result.itemsUpdated++;
  }

  return { toInsert, toUpdate, priceHistoryToInsert };
}

async function applyDrugMasterBatchChanges(
  tx: Transaction,
  params: {
    toInsert: InsertDrugMasterRow[];
    toUpdate: UpdateDrugMasterItem[];
    priceHistoryToInsert: InsertPriceHistoryRow[];
  },
): Promise<void> {
  const { toInsert, toUpdate, priceHistoryToInsert } = params;

  if (toInsert.length > 0) {
    await tx.insert(drugMaster).values(toInsert);
  }
  if (toUpdate.length > 0) {
    await Promise.all(
      toUpdate.map((item) =>
        tx.update(drugMaster)
          .set(item.fields)
          .where(eq(drugMaster.yjCode, item.yjCode)),
      ),
    );
  }
  if (priceHistoryToInsert.length > 0) {
    await tx.insert(drugMasterPriceHistory).values(priceHistoryToInsert);
  }
}

function collectDelistingPayload(
  existingMap: Map<string, ExistingDrugMasterForSync>,
  incomingCodes: Set<string>,
  revisionDate: string,
  result: SyncResult,
): DelistingPayload {
  const codes: string[] = [];
  const priceHistory: InsertPriceHistoryRow[] = [];

  for (const [yjCode, existing] of existingMap) {
    if (incomingCodes.has(yjCode) || !existing.isListed) {
      continue;
    }

    codes.push(yjCode);
    priceHistory.push(buildPriceHistoryRow({
      yjCode,
      previousPrice: existing.yakkaPrice,
      newPrice: null,
      revisionDate,
      revisionType: 'delisting',
    }));
    result.itemsDeleted++;
  }

  return { codes, priceHistory };
}

async function applyDelistingPayload(
  tx: Transaction,
  payload: DelistingPayload,
  revisionDate: string,
  now: string,
): Promise<void> {
  if (payload.codes.length > 0) {
    await processInBatches(payload.codes, BATCH_SIZE, async (codes) => {
      await tx.update(drugMaster)
        .set({ isListed: false, deletedDate: revisionDate, updatedAt: now })
        .where(inArray(drugMaster.yjCode, codes));
    });
  }

  if (payload.priceHistory.length > 0) {
    await processInBatches(payload.priceHistory, BATCH_SIZE, async (historyBatch) => {
      await tx.insert(drugMasterPriceHistory).values(historyBatch);
    });
  }
}

export async function syncDrugMaster(
  parsedRows: ParsedDrugRow[],
  syncLogId: number,
  revisionDate: string,
): Promise<SyncResult> {
  const normalizedRows = assertNoDuplicateYjCodes(parsedRows);

  const result: SyncResult = {
    itemsProcessed: 0,
    itemsAdded: 0,
    itemsUpdated: 0,
    itemsDeleted: 0,
  };

  await db.transaction(async (tx) => {
    const now = new Date().toISOString();

    // 全既存YJコードを取得
    const existingItems = await tx.select({
      yjCode: drugMaster.yjCode,
      drugName: drugMaster.drugName,
      genericName: drugMaster.genericName,
      specification: drugMaster.specification,
      unit: drugMaster.unit,
      yakkaPrice: drugMaster.yakkaPrice,
      manufacturer: drugMaster.manufacturer,
      category: drugMaster.category,
      therapeuticCategory: drugMaster.therapeuticCategory,
      isListed: drugMaster.isListed,
      listedDate: drugMaster.listedDate,
      transitionDeadline: drugMaster.transitionDeadline,
      deletedDate: drugMaster.deletedDate,
    }).from(drugMaster);

    const existingMap = new Map<string, ExistingDrugMasterForSync>(
      existingItems.map((item) => [
        item.yjCode,
        {
          ...item,
          isListed: Boolean(item.isListed),
        },
      ]),
    );
    const incomingCodes = new Set(normalizedRows.map((r) => r.yjCode));

    // バッチ処理: INSERT/UPDATE を蓄積して一括実行
    await processInBatches(normalizedRows, BATCH_SIZE, async (batch) => {
      const batchChanges = collectDrugMasterBatchChanges({
        batch,
        existingMap,
        now,
        revisionDate,
        result,
      });
      await applyDrugMasterBatchChanges(tx, batchChanges);
    });

    const delistingPayload = collectDelistingPayload(existingMap, incomingCodes, revisionDate, result);
    await applyDelistingPayload(tx, delistingPayload, revisionDate, now);

    await tx.update(drugMasterSyncLogs)
      .set({
        itemsProcessed: result.itemsProcessed,
        itemsAdded: result.itemsAdded,
        itemsUpdated: result.itemsUpdated,
        itemsDeleted: result.itemsDeleted,
      })
      .where(eq(drugMasterSyncLogs.id, syncLogId));
  });

  return result;
}

export async function syncPackageData(
  parsedRows: ParsedPackageRow[],
): Promise<{ added: number; updated: number }> {
  const counts: PackageMutationCounts = { added: 0, updated: 0 };
  const yjToId = await fetchDrugMasterIdMap(parsedRows);
  const existingPackages = await fetchExistingPackages(unique([...yjToId.values()]));
  const lookup = buildPackageLookupState(yjToId, existingPackages);

  await db.transaction(async (tx) => {
    await processInBatches(parsedRows, BATCH_SIZE, async (batch) => {
      await syncPackageBatch(tx, batch, lookup, counts);
    });
  });

  return counts;
}

export async function createSyncLog(
  syncType: string,
  sourceDescription: string,
  triggeredBy: number | null,
): Promise<SyncLogRow> {
  const [log] = await db.insert(drugMasterSyncLogs).values({
    syncType,
    sourceDescription,
    status: 'running',
    triggeredBy,
    startedAt: new Date().toISOString(),
  }).returning();
  return log;
}

export async function completeSyncLog(
  logId: number,
  status: 'success' | 'failed' | 'partial',
  result: SyncResult,
  errorMessage?: string,
): Promise<void> {
  await db.update(drugMasterSyncLogs)
    .set({
      status,
      itemsProcessed: result.itemsProcessed,
      itemsAdded: result.itemsAdded,
      itemsUpdated: result.itemsUpdated,
      itemsDeleted: result.itemsDeleted,
      errorMessage: errorMessage || null,
      completedAt: new Date().toISOString(),
    })
    .where(eq(drugMasterSyncLogs.id, logId));

  if (status === 'success' || status === 'partial') {
    invalidateDrugMasterLookupCache();
  }
}
