import { db } from '../config/database';
import { drugMaster, drugMasterPackages } from '../db/schema';
import { normalizeString } from '../utils/string-utils';
import { normalizePackageInfo, scorePackageMatch } from '../utils/package-utils';

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

type EnrichedRow<T> = T & {
  drugMasterId: number | null;
  drugMasterPackageId: number | null;
  packageLabel: string | null;
};

interface MasterMatchInfo {
  id: number;
  yakkaPrice: number;
  unit: string | null;
  drugMasterPackageId: number | null;
  packageLabel: string | null;
}

interface PackageCandidate {
  id: number;
  drugMasterId: number;
  packageDescription: string | null;
  packageQuantity: number | null;
  packageUnit: string | null;
  normalizedPackageLabel: string | null;
  packageForm: string | null;
  isLoosePackage: boolean;
}

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
    return rows.map((r) => ({ ...r, drugMasterId: null, drugMasterPackageId: null, packageLabel: null }));
  }

  // drugCodeを持つ行のコードをまとめて検索
  const codesInRows = new Set<string>();
  for (const row of rows) {
    if (row.drugCode) {
      codesInRows.add(row.drugCode.replace(/[\s\-]/g, '').normalize('NFKC'));
    }
  }

  // コード→マスター情報のキャッシュ構築
  const codeCache = new Map<string, MasterMatchInfo>();
  const toNum = (v: string | number | null): number => Number(v ?? 0);
  let packageCandidatesByMaster: Map<number, PackageCandidate[]> | null = null;

  async function ensurePackageCandidatesByMaster(): Promise<Map<number, PackageCandidate[]>> {
    if (packageCandidatesByMaster) return packageCandidatesByMaster;

    const allPackagesRaw = await db.select({
      id: drugMasterPackages.id,
      gs1Code: drugMasterPackages.gs1Code,
      janCode: drugMasterPackages.janCode,
      hotCode: drugMasterPackages.hotCode,
      drugMasterId: drugMasterPackages.drugMasterId,
      packageDescription: drugMasterPackages.packageDescription,
      packageQuantity: drugMasterPackages.packageQuantity,
      packageUnit: drugMasterPackages.packageUnit,
      normalizedPackageLabel: drugMasterPackages.normalizedPackageLabel,
      packageForm: drugMasterPackages.packageForm,
      isLoosePackage: drugMasterPackages.isLoosePackage,
    }).from(drugMasterPackages);

    const grouped = new Map<number, PackageCandidate[]>();
    for (const row of allPackagesRaw) {
      const normalized = normalizePackageInfo({
        packageDescription: row.packageDescription,
        packageQuantity: row.packageQuantity,
        packageUnit: row.packageUnit,
      });

      const candidate: PackageCandidate = {
        id: row.id,
        drugMasterId: row.drugMasterId,
        packageDescription: row.packageDescription,
        packageQuantity: row.packageQuantity,
        packageUnit: row.packageUnit,
        normalizedPackageLabel: row.normalizedPackageLabel ?? normalized.normalizedPackageLabel,
        packageForm: row.packageForm ?? normalized.packageForm,
        isLoosePackage: row.isLoosePackage ?? normalized.isLoosePackage,
      };

      const list = grouped.get(candidate.drugMasterId) ?? [];
      list.push(candidate);
      grouped.set(candidate.drugMasterId, list);
    }

    packageCandidatesByMaster = grouped;
    return grouped;
  }

  async function findPackageByUnit(drugMasterId: number, rowUnit: string | null): Promise<PackageCandidate | null> {
    if (!rowUnit) return null;
    const grouped = await ensurePackageCandidatesByMaster();
    const candidates = grouped.get(drugMasterId) ?? [];
    if (candidates.length === 0) return null;

    let best: PackageCandidate | null = null;
    let bestScore = 0;
    for (const candidate of candidates) {
      const score = scorePackageMatch({
        rowUnit,
        normalizedPackageLabel: candidate.normalizedPackageLabel,
        packageDescription: candidate.packageDescription,
        isLoosePackage: candidate.isLoosePackage,
      });
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }

    return bestScore >= 40 ? best : null;
  }

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
        codeCache.set(m.yjCode, {
          id: m.id,
          yakkaPrice: toNum(m.yakkaPrice),
          unit: m.unit,
          drugMasterPackageId: null,
          packageLabel: null,
        });
      }
    }

    // GS1/JANコードで包装テーブルも検索
    const unresolvedCodes = [...codesInRows].filter((c) => !codeCache.has(c));
    if (unresolvedCodes.length > 0) {
      const allPackages = await db.select({
        id: drugMasterPackages.id,
        gs1Code: drugMasterPackages.gs1Code,
        janCode: drugMasterPackages.janCode,
        hotCode: drugMasterPackages.hotCode,
        drugMasterId: drugMasterPackages.drugMasterId,
        packageDescription: drugMasterPackages.packageDescription,
        packageQuantity: drugMasterPackages.packageQuantity,
        packageUnit: drugMasterPackages.packageUnit,
        normalizedPackageLabel: drugMasterPackages.normalizedPackageLabel,
        packageForm: drugMasterPackages.packageForm,
        isLoosePackage: drugMasterPackages.isLoosePackage,
      }).from(drugMasterPackages);

      const pkgMap = new Map<string, PackageCandidate>();
      const grouped = new Map<number, PackageCandidate[]>();
      for (const pkg of allPackages) {
        const normalized = normalizePackageInfo({
          packageDescription: pkg.packageDescription,
          packageQuantity: pkg.packageQuantity,
          packageUnit: pkg.packageUnit,
        });
        const candidate: PackageCandidate = {
          id: pkg.id,
          drugMasterId: pkg.drugMasterId,
          packageDescription: pkg.packageDescription,
          packageQuantity: pkg.packageQuantity,
          packageUnit: pkg.packageUnit,
          normalizedPackageLabel: pkg.normalizedPackageLabel ?? normalized.normalizedPackageLabel,
          packageForm: pkg.packageForm ?? normalized.packageForm,
          isLoosePackage: pkg.isLoosePackage ?? normalized.isLoosePackage,
        };
        if (pkg.gs1Code) pkgMap.set(pkg.gs1Code, candidate);
        if (pkg.janCode) pkgMap.set(pkg.janCode, candidate);
        if (pkg.hotCode) pkgMap.set(pkg.hotCode, candidate);

        const list = grouped.get(candidate.drugMasterId) ?? [];
        list.push(candidate);
        grouped.set(candidate.drugMasterId, list);
      }
      packageCandidatesByMaster = grouped;

      for (const code of unresolvedCodes) {
        const packageCandidate = pkgMap.get(code);
        if (packageCandidate) {
          const masterInfo = allMaster.find((m) => m.id === packageCandidate.drugMasterId);
          if (masterInfo) {
            codeCache.set(code, {
              id: masterInfo.id,
              yakkaPrice: toNum(masterInfo.yakkaPrice),
              unit: masterInfo.unit,
              drugMasterPackageId: packageCandidate.id,
              packageLabel: packageCandidate.normalizedPackageLabel ?? packageCandidate.packageDescription,
            });
          }
        }
      }
    }
  }

  // 名前でのファジーマッチ用マスターデータ（コードで解決できなかった行用）
  const nameCache = new Map<string, MasterMatchInfo>();
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

  async function findByName(drugName: string): Promise<MasterMatchInfo | null> {
    const cached = nameCache.get(drugName);
    if (cached !== undefined) return cached;

    await loadNameCache();
    if (!masterByName) return null;

    const normalized = normalizeString(drugName);

    // 完全一致
    const exact = masterByName.find((m) => m.normalizedName === normalized);
    if (exact) {
      const result: MasterMatchInfo = {
        id: exact.id,
        yakkaPrice: exact.yakkaPrice,
        unit: exact.unit,
        drugMasterPackageId: null,
        packageLabel: null,
      };
      nameCache.set(drugName, result);
      return result;
    }

    return null;
  }

  // 各行を処理
  const results: EnrichedRow<T>[] = [];
  for (const row of rows) {
    let masterInfo: MasterMatchInfo | null = null;

    // 1. コードでの検索
    if (row.drugCode) {
      const cleaned = row.drugCode.replace(/[\s\-]/g, '').normalize('NFKC');
      masterInfo = codeCache.get(cleaned) || null;
    }

    // 2. 名前でのマッチ（コードで見つからない場合）
    if (!masterInfo) {
      masterInfo = await findByName(row.drugName);
    }

    let packageInfo: PackageCandidate | null = null;
    if (masterInfo && !masterInfo.drugMasterPackageId && row.unit) {
      packageInfo = await findPackageByUnit(masterInfo.id, row.unit);
    }

    // 自動補完
    const enriched = {
      ...row,
      drugMasterId: masterInfo?.id ?? null,
      drugMasterPackageId: packageInfo?.id ?? masterInfo?.drugMasterPackageId ?? null,
      packageLabel: packageInfo?.normalizedPackageLabel
        ?? packageInfo?.packageDescription
        ?? masterInfo?.packageLabel
        ?? null,
    };

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
