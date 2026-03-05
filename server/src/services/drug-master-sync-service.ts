import { eq, inArray } from 'drizzle-orm';
import { db } from '../config/database';
import {
  drugMaster,
  drugMasterPackages,
  drugMasterPriceHistory,
  drugMasterSyncLogs,
} from '../db/schema';
import { normalizePackageInfo } from '../utils/package-utils';
import { ParsedDrugRow, ParsedPackageRow } from './drug-master-parser-service';

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
type UpdateDrugMasterFields = Omit<InsertDrugMasterRow, 'yjCode' | 'id' | 'createdAt'>;
type UpdateDrugMasterItem = {
  yjCode: string;
  fields: UpdateDrugMasterFields;
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

function buildDrugMasterInsertRow(row: ParsedDrugRow, now: string): InsertDrugMasterRow {
  return {
    yjCode: row.yjCode,
    drugName: row.drugName,
    genericName: row.genericName,
    specification: row.specification,
    unit: row.unit,
    yakkaPrice: String(row.yakkaPrice),
    manufacturer: row.manufacturer,
    category: row.category,
    therapeuticCategory: row.therapeuticCategory,
    isListed: true,
    listedDate: row.listedDate,
    transitionDeadline: row.transitionDeadline,
    updatedAt: now,
  };
}

function buildDrugMasterUpdateFields(row: ParsedDrugRow, now: string): UpdateDrugMasterFields {
  return {
    drugName: row.drugName,
    genericName: row.genericName,
    specification: row.specification,
    unit: row.unit,
    yakkaPrice: String(row.yakkaPrice),
    manufacturer: row.manufacturer,
    category: row.category,
    therapeuticCategory: row.therapeuticCategory,
    isListed: true,
    listedDate: row.listedDate,
    transitionDeadline: row.transitionDeadline,
    deletedDate: null,
    updatedAt: now,
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

function normalizePackage(row: ParsedPackageRow) {
  return normalizePackageInfo({
    packageDescription: row.packageDescription,
    packageQuantity: row.packageQuantity,
    packageUnit: row.packageUnit,
  });
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
      id: drugMaster.id,
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

    const existingMap = new Map(existingItems.map((item) => [item.yjCode, item as ExistingDrugMasterForSync]));
    const incomingCodes = new Set(normalizedRows.map((r) => r.yjCode));

    // バッチ処理: INSERT/UPDATE を蓄積して一括実行
    for (let i = 0; i < normalizedRows.length; i += BATCH_SIZE) {
      const batch = normalizedRows.slice(i, i + BATCH_SIZE);

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

      // バッチ INSERT 一括実行
      if (toInsert.length > 0) {
        await tx.insert(drugMaster).values(toInsert);
      }
      // バッチ UPDATE 並列実行（N回逐次 → Promise.all でDBラウンドトリップ削減）
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

    // ファイルに含まれない既存品目を一括で経過措置 or 削除扱いにする
    const delistingCodes: string[] = [];
    const delistingPriceHistory: (typeof drugMasterPriceHistory.$inferInsert)[] = [];
    for (const [yjCode, existing] of existingMap) {
      if (!incomingCodes.has(yjCode) && existing.isListed) {
        delistingCodes.push(yjCode);
        delistingPriceHistory.push(buildPriceHistoryRow({
          yjCode,
          previousPrice: existing.yakkaPrice,
          newPrice: null,
          revisionDate,
          revisionType: 'delisting',
        }));
        result.itemsDeleted++;
      }
    }

    if (delistingCodes.length > 0) {
      // バッチで delisting UPDATE
      for (let i = 0; i < delistingCodes.length; i += BATCH_SIZE) {
        const codes = delistingCodes.slice(i, i + BATCH_SIZE);
        await tx.update(drugMaster)
          .set({ isListed: false, deletedDate: revisionDate, updatedAt: now })
          .where(inArray(drugMaster.yjCode, codes));
      }
      // バッチで price history INSERT
      for (let i = 0; i < delistingPriceHistory.length; i += BATCH_SIZE) {
        const historyBatch = delistingPriceHistory.slice(i, i + BATCH_SIZE);
        await tx.insert(drugMasterPriceHistory).values(historyBatch);
      }
    }

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
  let added = 0;
  let updated = 0;

  // YJコード → drug_master.id のマップを構築（必要なコードだけフィルター）
  const yjCodes = [...new Set(parsedRows.map((r) => r.yjCode))];
  const masterItems = yjCodes.length > 0
    ? await db.select({ id: drugMaster.id, yjCode: drugMaster.yjCode })
        .from(drugMaster)
        .where(inArray(drugMaster.yjCode, yjCodes))
    : [];
  const yjToId = new Map(masterItems.map((m) => [m.yjCode, m.id]));

  const relevantMasterIds = [...new Set(masterItems.map((m) => m.id))];
  const existingPackages = relevantMasterIds.length > 0
    ? await db.select({
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
      .where(inArray(drugMasterPackages.drugMasterId, relevantMasterIds))
    : [];

  type ExistingPackage = (typeof existingPackages)[number];
  interface PackageBucket {
    byGs1: Map<string, ExistingPackage>;
    byJan: Map<string, ExistingPackage>;
    byHot: Map<string, ExistingPackage>;
  }

  const buckets = new Map<number, PackageBucket>();
  function ensureBucket(drugMasterId: number): PackageBucket {
    const existing = buckets.get(drugMasterId);
    if (existing) return existing;
    const created: PackageBucket = {
      byGs1: new Map(),
      byJan: new Map(),
      byHot: new Map(),
    };
    buckets.set(drugMasterId, created);
    return created;
  }

  function addToBucket(pkg: ExistingPackage): void {
    const bucket = ensureBucket(pkg.drugMasterId);
    if (pkg.gs1Code) bucket.byGs1.set(pkg.gs1Code, pkg);
    if (pkg.janCode) bucket.byJan.set(pkg.janCode, pkg);
    if (pkg.hotCode) bucket.byHot.set(pkg.hotCode, pkg);
  }

  function removeFromBucket(pkg: ExistingPackage): void {
    const bucket = buckets.get(pkg.drugMasterId);
    if (!bucket) return;
    if (pkg.gs1Code) bucket.byGs1.delete(pkg.gs1Code);
    if (pkg.janCode) bucket.byJan.delete(pkg.janCode);
    if (pkg.hotCode) bucket.byHot.delete(pkg.hotCode);
  }

  function findExistingPackage(drugMasterId: number, row: ParsedPackageRow): ExistingPackage | null {
    const bucket = buckets.get(drugMasterId);
    if (!bucket) return null;
    if (row.gs1Code) {
      const hit = bucket.byGs1.get(row.gs1Code);
      if (hit) return hit;
    }
    if (row.janCode) {
      const hit = bucket.byJan.get(row.janCode);
      if (hit) return hit;
    }
    if (row.hotCode) {
      const hit = bucket.byHot.get(row.hotCode);
      if (hit) return hit;
    }
    return null;
  }

  for (const pkg of existingPackages) {
    addToBucket(pkg);
  }

  await db.transaction(async (tx) => {
    for (let i = 0; i < parsedRows.length; i += BATCH_SIZE) {
      const batch = parsedRows.slice(i, i + BATCH_SIZE);
      type InsertPackageRow = typeof drugMasterPackages.$inferInsert;
      const toInsert: InsertPackageRow[] = [];

      for (const row of batch) {
        const drugMasterId = yjToId.get(row.yjCode);
        if (!drugMasterId) continue;
        const normalized = normalizePackage(row);

        const existingPkg = findExistingPackage(drugMasterId, row);

        if (existingPkg) {
          const nextValues = {
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

          await tx.update(drugMasterPackages)
            .set(nextValues)
            .where(eq(drugMasterPackages.id, existingPkg.id));

          removeFromBucket(existingPkg);
          const { updatedAt: _updatedAt, ...cacheValues } = nextValues;
          addToBucket({ ...existingPkg, ...cacheValues });

          updated++;
        } else {
          toInsert.push({
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
          });

          added++;
        }
      }

      // バッチ INSERT 一括実行
      if (toInsert.length > 0) {
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
          addToBucket(pkg);
        }
      }
    }
  });

  return { added, updated };
}

export async function createSyncLog(syncType: string, sourceDescription: string, triggeredBy: number | null) {
  const [log] = await db.insert(drugMasterSyncLogs).values({
    syncType,
    sourceDescription,
    status: 'running',
    triggeredBy,
    startedAt: new Date().toISOString(),
  }).returning();
  return log;
}

export async function completeSyncLog(logId: number, status: 'success' | 'failed' | 'partial', result: SyncResult, errorMessage?: string) {
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
}
