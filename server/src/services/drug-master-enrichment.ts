import { db } from '../config/database';
import { drugMaster, drugMasterPackages } from '../db/schema';
import { normalizeString } from '../utils/string-utils';

interface BaseRow {
  drugCode: string | null;
  drugName: string;
  unit: string | null;
  yakkaUnitPrice: number | null;
}

interface DeadStockRow extends BaseRow {
  quantity: number;
  yakkaTotal: number | null;
  expirationDate: string | null;
  lotNumber: string | null;
}

interface UsedMedRow extends BaseRow {
  monthlyUsage: number | null;
}

type EnrichedRow<T> = T & { drugMasterId: number | null };

/**
 * 医薬品マスターからの自動補完処理
 * - drugCodeがある場合: YJコード/GS1コード/JANコードで検索
 * - yakkaUnitPriceが空の場合: マスターの薬価で補完
 * - unitが空の場合: マスターの単位で補完
 */
export async function enrichWithDrugMaster<T extends BaseRow>(
  rows: T[],
  _type: 'dead_stock' | 'used_medication',
): Promise<EnrichedRow<T>[]> {
  // マスターが空なら何もしない
  const [masterCheck] = await db.select({ id: drugMaster.id }).from(drugMaster).limit(1);
  if (!masterCheck) {
    return rows.map((r) => ({ ...r, drugMasterId: null }));
  }

  // drugCodeを持つ行のコードをまとめて検索
  const codesInRows = new Set<string>();
  for (const row of rows) {
    if (row.drugCode) {
      codesInRows.add(row.drugCode.replace(/[\s\-]/g, '').normalize('NFKC'));
    }
  }

  // コード→マスター情報のキャッシュ構築
  const codeCache = new Map<string, { id: number; yakkaPrice: number; unit: string | null }>();
  const toNum = (v: string | number | null): number => Number(v ?? 0);

  if (codesInRows.size > 0) {
    // YJコードで直接検索（削除済も含む：不動在庫に削除済薬品が含まれることがある）
    const allMaster = await db.select({
      id: drugMaster.id,
      yjCode: drugMaster.yjCode,
      yakkaPrice: drugMaster.yakkaPrice,
      unit: drugMaster.unit,
    }).from(drugMaster);

    for (const m of allMaster) {
      if (codesInRows.has(m.yjCode)) {
        codeCache.set(m.yjCode, { id: m.id, yakkaPrice: toNum(m.yakkaPrice), unit: m.unit });
      }
    }

    // GS1/JANコードで包装テーブルも検索
    const unresolvedCodes = [...codesInRows].filter((c) => !codeCache.has(c));
    if (unresolvedCodes.length > 0) {
      const allPackages = await db.select({
        gs1Code: drugMasterPackages.gs1Code,
        janCode: drugMasterPackages.janCode,
        hotCode: drugMasterPackages.hotCode,
        drugMasterId: drugMasterPackages.drugMasterId,
      }).from(drugMasterPackages);

      const pkgMap = new Map<string, number>();
      for (const pkg of allPackages) {
        if (pkg.gs1Code) pkgMap.set(pkg.gs1Code, pkg.drugMasterId);
        if (pkg.janCode) pkgMap.set(pkg.janCode, pkg.drugMasterId);
        if (pkg.hotCode) pkgMap.set(pkg.hotCode, pkg.drugMasterId);
      }

      for (const code of unresolvedCodes) {
        const masterId = pkgMap.get(code);
        if (masterId) {
          const masterInfo = allMaster.find((m) => m.id === masterId);
          if (masterInfo) {
            codeCache.set(code, { id: masterInfo.id, yakkaPrice: toNum(masterInfo.yakkaPrice), unit: masterInfo.unit });
          }
        }
      }
    }
  }

  // 名前でのファジーマッチ用マスターデータ（コードで解決できなかった行用）
  const nameCache = new Map<string, { id: number; yakkaPrice: number; unit: string | null }>();
  let masterByName: { id: number; drugName: string; normalizedName: string; yakkaPrice: number; unit: string | null }[] | null = null;

  async function loadNameCache() {
    if (masterByName) return;
    const all = await db.select({
      id: drugMaster.id,
      drugName: drugMaster.drugName,
      yakkaPrice: drugMaster.yakkaPrice,
      unit: drugMaster.unit,
    }).from(drugMaster);

    masterByName = all.map((m) => ({
      id: m.id,
      drugName: m.drugName,
      yakkaPrice: toNum(m.yakkaPrice),
      unit: m.unit,
      normalizedName: normalizeString(m.drugName),
    }));
  }

  async function findByName(drugName: string): Promise<{ id: number; yakkaPrice: number; unit: string | null } | null> {
    const cached = nameCache.get(drugName);
    if (cached !== undefined) return cached;

    await loadNameCache();
    if (!masterByName) return null;

    const normalized = normalizeString(drugName);

    // 完全一致
    const exact = masterByName.find((m) => m.normalizedName === normalized);
    if (exact) {
      const result = { id: exact.id, yakkaPrice: exact.yakkaPrice, unit: exact.unit };
      nameCache.set(drugName, result);
      return result;
    }

    return null;
  }

  // 各行を処理
  const results: EnrichedRow<T>[] = [];
  for (const row of rows) {
    let masterInfo: { id: number; yakkaPrice: number; unit: string | null } | null = null;

    // 1. コードでの検索
    if (row.drugCode) {
      const cleaned = row.drugCode.replace(/[\s\-]/g, '').normalize('NFKC');
      masterInfo = codeCache.get(cleaned) || null;
    }

    // 2. 名前でのマッチ（コードで見つからない場合）
    if (!masterInfo) {
      masterInfo = await findByName(row.drugName);
    }

    // 自動補完
    const enriched = { ...row, drugMasterId: masterInfo?.id ?? null };

    if (masterInfo) {
      if (enriched.yakkaUnitPrice === null || enriched.yakkaUnitPrice === undefined) {
        enriched.yakkaUnitPrice = masterInfo.yakkaPrice;
        // dead_stock の場合、yakkaTotal も再計算
        if ('quantity' in enriched && 'yakkaTotal' in enriched) {
          const ds = enriched as unknown as DeadStockRow & { drugMasterId: number | null };
          ds.yakkaTotal = masterInfo.yakkaPrice * ds.quantity;
        }
      }
      if (!enriched.unit && masterInfo.unit) {
        enriched.unit = masterInfo.unit;
      }
    }

    results.push(enriched);
  }

  return results;
}
