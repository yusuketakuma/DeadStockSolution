import { db } from '../config/database';
import { inArray, or } from 'drizzle-orm';
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

function normalizeDrugCode(value: string): string {
  return value.replace(/[\s\-]/g, '').normalize('NFKC');
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
      codesInRows.add(normalizeDrugCode(row.drugCode));
    }
  }

  // コード→マスター情報のキャッシュ構築
  const codeCache = new Map<string, MasterMatchInfo>();
  const toNum = (v: string | number | null): number => Number(v ?? 0);
  const masterById = new Map<number, { id: number; yakkaPrice: number; unit: string | null }>();
  const packageCandidatesByMaster = new Map<number, PackageCandidate[]>();
  const loadedPackageCandidateMasterIds = new Set<number>();

  function toPackageCandidate(pkg: {
    id: number;
    drugMasterId: number;
    packageDescription: string | null;
    packageQuantity: number | null;
    packageUnit: string | null;
    normalizedPackageLabel: string | null;
    packageForm: string | null;
    isLoosePackage: boolean | null;
  }): PackageCandidate {
    const normalized = normalizePackageInfo({
      packageDescription: pkg.packageDescription,
      packageQuantity: pkg.packageQuantity,
      packageUnit: pkg.packageUnit,
    });
    return {
      id: pkg.id,
      drugMasterId: pkg.drugMasterId,
      packageDescription: pkg.packageDescription,
      packageQuantity: pkg.packageQuantity,
      packageUnit: pkg.packageUnit,
      normalizedPackageLabel: pkg.normalizedPackageLabel ?? normalized.normalizedPackageLabel,
      packageForm: pkg.packageForm ?? normalized.packageForm,
      isLoosePackage: pkg.isLoosePackage ?? normalized.isLoosePackage,
    };
  }

  async function loadPackageCandidatesForMasterIds(masterIds: number[]): Promise<void> {
    const targetMasterIds = [...new Set(masterIds)]
      .filter((id) => !loadedPackageCandidateMasterIds.has(id));
    if (targetMasterIds.length === 0) return;

    const rows = await db.select({
      id: drugMasterPackages.id,
      drugMasterId: drugMasterPackages.drugMasterId,
      packageDescription: drugMasterPackages.packageDescription,
      packageQuantity: drugMasterPackages.packageQuantity,
      packageUnit: drugMasterPackages.packageUnit,
      normalizedPackageLabel: drugMasterPackages.normalizedPackageLabel,
      packageForm: drugMasterPackages.packageForm,
      isLoosePackage: drugMasterPackages.isLoosePackage,
    })
      .from(drugMasterPackages)
      .where(inArray(drugMasterPackages.drugMasterId, targetMasterIds));

    const grouped = new Map<number, PackageCandidate[]>();
    for (const row of rows) {
      const candidate = toPackageCandidate(row);
      const list = grouped.get(candidate.drugMasterId) ?? [];
      list.push(candidate);
      grouped.set(candidate.drugMasterId, list);
    }

    for (const id of targetMasterIds) {
      packageCandidatesByMaster.set(id, grouped.get(id) ?? []);
      loadedPackageCandidateMasterIds.add(id);
    }
  }

  async function findPackageByUnit(drugMasterId: number, rowUnit: string | null): Promise<PackageCandidate | null> {
    if (!rowUnit) return null;
    await loadPackageCandidatesForMasterIds([drugMasterId]);
    const candidates = packageCandidatesByMaster.get(drugMasterId) ?? [];
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
    const normalizedCodes = [...codesInRows];

    // YJコードで直接検索（削除済も含む：デッドストックリストに削除済薬品が含まれることがある）
    const matchedMasterRows = await db.select({
      id: drugMaster.id,
      yjCode: drugMaster.yjCode,
      yakkaPrice: drugMaster.yakkaPrice,
      unit: drugMaster.unit,
    })
      .from(drugMaster)
      .where(inArray(drugMaster.yjCode, normalizedCodes));

    for (const m of matchedMasterRows) {
      const master = {
        id: m.id,
        yakkaPrice: toNum(m.yakkaPrice),
        unit: m.unit,
      };
      masterById.set(m.id, master);
      codeCache.set(m.yjCode, {
        id: master.id,
        yakkaPrice: master.yakkaPrice,
        unit: master.unit,
        drugMasterPackageId: null,
        packageLabel: null,
      });
    }

    // GS1/JAN/HOTコードで包装テーブルも検索
    const unresolvedCodes = normalizedCodes.filter((code) => !codeCache.has(code));
    if (unresolvedCodes.length > 0) {
      const matchedPackages = await db.select({
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
      })
        .from(drugMasterPackages)
        .where(or(
          inArray(drugMasterPackages.gs1Code, unresolvedCodes),
          inArray(drugMasterPackages.janCode, unresolvedCodes),
          inArray(drugMasterPackages.hotCode, unresolvedCodes),
        ));

      const packageByCode = new Map<string, PackageCandidate>();
      const packageMasterIds = new Set<number>();

      for (const pkg of matchedPackages) {
        const candidate = toPackageCandidate(pkg);
        if (pkg.gs1Code) packageByCode.set(normalizeDrugCode(pkg.gs1Code), candidate);
        if (pkg.janCode) packageByCode.set(normalizeDrugCode(pkg.janCode), candidate);
        if (pkg.hotCode) packageByCode.set(normalizeDrugCode(pkg.hotCode), candidate);
        packageMasterIds.add(candidate.drugMasterId);
      }

      const unresolvedMasterIds = [...packageMasterIds]
        .filter((masterId) => !masterById.has(masterId));
      if (unresolvedMasterIds.length > 0) {
        const packageMasterRows = await db.select({
          id: drugMaster.id,
          yakkaPrice: drugMaster.yakkaPrice,
          unit: drugMaster.unit,
        })
          .from(drugMaster)
          .where(inArray(drugMaster.id, unresolvedMasterIds));

        for (const m of packageMasterRows) {
          masterById.set(m.id, {
            id: m.id,
            yakkaPrice: toNum(m.yakkaPrice),
            unit: m.unit,
          });
        }
      }

      for (const code of unresolvedCodes) {
        const packageCandidate = packageByCode.get(code);
        if (!packageCandidate) continue;
        const master = masterById.get(packageCandidate.drugMasterId);
        if (!master) continue;

        codeCache.set(code, {
          id: master.id,
          yakkaPrice: master.yakkaPrice,
          unit: master.unit,
          drugMasterPackageId: packageCandidate.id,
          packageLabel: packageCandidate.normalizedPackageLabel ?? packageCandidate.packageDescription,
        });
      }
    }
  }

  // 名前でのファジーマッチ用マスターデータ（コードで解決できなかった行用）
  const nameCache = new Map<string, MasterMatchInfo | null>();
  let masterByNormalizedName: Map<string, MasterMatchInfo> | null = null;

  async function loadNameCache() {
    if (masterByNormalizedName) return;
    const all = await db.select({
      id: drugMaster.id,
      drugName: drugMaster.drugName,
      yakkaPrice: drugMaster.yakkaPrice,
      unit: drugMaster.unit,
    }).from(drugMaster);

    const byName = new Map<string, MasterMatchInfo>();
    for (const m of all) {
      const normalizedName = normalizeString(m.drugName);
      if (byName.has(normalizedName)) continue;
      byName.set(normalizedName, {
        id: m.id,
        yakkaPrice: toNum(m.yakkaPrice),
        unit: m.unit,
        drugMasterPackageId: null,
        packageLabel: null,
      });
    }
    masterByNormalizedName = byName;
  }

  async function findByName(drugName: string): Promise<MasterMatchInfo | null> {
    if (nameCache.has(drugName)) {
      return nameCache.get(drugName) ?? null;
    }

    await loadNameCache();
    const normalized = normalizeString(drugName);
    const exact = masterByNormalizedName?.get(normalized) ?? null;
    nameCache.set(drugName, exact);
    return exact;
  }

  // パス1: 全行の masterInfo を解決（名前キャッシュは初回のみDBロード）
  const masterInfoByRow: (MasterMatchInfo | null)[] = [];
  for (const row of rows) {
    let masterInfo: MasterMatchInfo | null = null;

    // 1. コードでの検索
    if (row.drugCode) {
      const cleaned = normalizeDrugCode(row.drugCode);
      masterInfo = codeCache.get(cleaned) || null;
    }

    // 2. 名前でのマッチ（コードで見つからない場合）
    if (!masterInfo) {
      masterInfo = await findByName(row.drugName);
    }

    masterInfoByRow.push(masterInfo);
  }

  // パス2: パッケージ候補が必要な masterIds を収集し、1回のDBクエリで一括取得
  const masterIdsNeedingPackages: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const masterInfo = masterInfoByRow[i];
    const row = rows[i];
    if (masterInfo && !masterInfo.drugMasterPackageId && row.unit) {
      masterIdsNeedingPackages.push(masterInfo.id);
    }
  }
  await loadPackageCandidatesForMasterIds(masterIdsNeedingPackages);

  // パス3: キャッシュ済みデータを使って各行を補完（DBアクセスなし）
  const results: EnrichedRow<T>[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const masterInfo = masterInfoByRow[i];

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
