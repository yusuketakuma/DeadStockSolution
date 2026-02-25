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

export async function syncDrugMaster(
  parsedRows: ParsedDrugRow[],
  syncLogId: number,
  revisionDate: string,
): Promise<SyncResult> {
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
      yakkaPrice: drugMaster.yakkaPrice,
      isListed: drugMaster.isListed,
    }).from(drugMaster);

    const existingMap = new Map(existingItems.map((item) => [item.yjCode, item]));
    const incomingCodes = new Set(parsedRows.map((r) => r.yjCode));

    // バッチ処理: INSERT/UPDATE
    for (let i = 0; i < parsedRows.length; i += BATCH_SIZE) {
      const batch = parsedRows.slice(i, i + BATCH_SIZE);

      for (const row of batch) {
        const existing = existingMap.get(row.yjCode);
        result.itemsProcessed++;

        if (!existing) {
          // 新規追加
          await tx.insert(drugMaster).values({
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
          });

          await tx.insert(drugMasterPriceHistory).values({
            yjCode: row.yjCode,
            previousPrice: null,
            newPrice: String(row.yakkaPrice),
            revisionDate,
            revisionType: 'new_listing',
          });

          result.itemsAdded++;
        } else {
          // 既存品目の更新チェック（float精度を考慮）
          const priceChanged = Math.abs(Number(existing.yakkaPrice) - row.yakkaPrice) > 0.001;
          const wasDelisted = !existing.isListed;

          await tx.update(drugMaster)
            .set({
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
            })
            .where(eq(drugMaster.yjCode, row.yjCode));

          if (priceChanged) {
            await tx.insert(drugMasterPriceHistory).values({
              yjCode: row.yjCode,
              previousPrice: existing.yakkaPrice,
              newPrice: String(row.yakkaPrice),
              revisionDate,
              revisionType: wasDelisted ? 'new_listing' : 'price_revision',
            });
          }

          result.itemsUpdated++;
        }
      }

      // 同期ログを中間更新（トランザクション外からも見える進捗のためdbを使用）
      await db.update(drugMasterSyncLogs)
        .set({
          itemsProcessed: result.itemsProcessed,
          itemsAdded: result.itemsAdded,
          itemsUpdated: result.itemsUpdated,
        })
        .where(eq(drugMasterSyncLogs.id, syncLogId));
    }

    // ファイルに含まれない既存品目で、まだ収載中のものを経過措置 or 削除扱いにする
    for (const [yjCode, existing] of existingMap) {
      if (!incomingCodes.has(yjCode) && existing.isListed) {
        await tx.update(drugMaster)
          .set({
            isListed: false,
            deletedDate: revisionDate,
            updatedAt: now,
          })
          .where(eq(drugMaster.yjCode, yjCode));

        await tx.insert(drugMasterPriceHistory).values({
          yjCode,
          previousPrice: existing.yakkaPrice,
          newPrice: null,
          revisionDate,
          revisionType: 'delisting',
        });

        result.itemsDeleted++;
      }
    }
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

  for (let i = 0; i < parsedRows.length; i += BATCH_SIZE) {
    const batch = parsedRows.slice(i, i + BATCH_SIZE);

    for (const row of batch) {
      const drugMasterId = yjToId.get(row.yjCode);
      if (!drugMasterId) continue; // 対応するマスターがなければスキップ

      // GS1コード or JANコード or HOTコードで既存チェック
      const existingPkg = findExistingPackage(drugMasterId, row);

      if (existingPkg) {
        const normalized = normalizePackageInfo({
          packageDescription: row.packageDescription,
          packageQuantity: row.packageQuantity,
          packageUnit: row.packageUnit,
        });
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

        await db.update(drugMasterPackages)
          .set(nextValues)
          .where(eq(drugMasterPackages.id, existingPkg.id));

        removeFromBucket(existingPkg);
        const { updatedAt: _updatedAt, ...cacheValues } = nextValues;
        addToBucket({
          ...existingPkg,
          ...cacheValues,
        });

        updated++;
      } else {
        const normalized = normalizePackageInfo({
          packageDescription: row.packageDescription,
          packageQuantity: row.packageQuantity,
          packageUnit: row.packageUnit,
        });
        const [created] = await db.insert(drugMasterPackages).values({
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
        }).returning({
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

        if (created) {
          addToBucket(created);
        }

        added++;
      }
    }
  }

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
