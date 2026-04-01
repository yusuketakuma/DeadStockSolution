import { db } from '../../config/database';
import { inArray, or } from 'drizzle-orm';
import { drugMaster, drugMasterPackages } from '../../db/schema';
import { buildTokenizedSearchConditions } from '../../utils/search-utils';
import { normalizeString } from '../../utils/string-utils';
import { normalizePackageInfo, scorePackageMatch } from '../../utils/package-utils';

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

export interface MasterCandidate {
  drugMasterId: number;
  drugName: string;
  yjCode: string;
  yakkaPrice: number;
  unit: string | null;
  matchType: 'exact_code' | 'exact_name' | 'fuzzy_name' | 'none';
}

type EnrichedRow<T> = T & {
  drugMasterId: number | null;
  drugMasterPackageId: number | null;
  packageLabel: string | null;
  matchConfidence: 'exact' | 'fuzzy' | 'code_not_found' | 'none';
  candidates?: MasterCandidate[];
};

export interface EnrichmentWarning {
  rowIndex: number;
  issueCode: 'DRUG_CODE_NOT_IN_MASTER';
  issueMessage: string;
}

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

interface MasterRecord {
  id: number;
  yakkaPrice: number;
  unit: string | null;
}

interface DrugMasterLookupState {
  codeCache: Map<string, MasterMatchInfo>;
  masterById: Map<number, MasterRecord>;
  packageCandidatesByMaster: Map<number, PackageCandidate[]>;
  loadedPackageCandidateMasterIds: Set<number>;
}

function normalizeDrugCode(value: string): string {
  return value.replace(/[\s\-]/g, '').normalize('NFKC');
}

function toEmptyEnrichedRow<T extends BaseRow>(row: T): EnrichedRow<T> {
  return {
    ...row,
    drugMasterId: null,
    drugMasterPackageId: null,
    packageLabel: null,
    matchConfidence: 'none',
  };
}

function toNum(value: string | number | null): number {
  return Number(value ?? 0);
}

function collectNormalizedCodes<T extends BaseRow>(rows: T[]): string[] {
  const codes = new Set<string>();
  for (const row of rows) {
    if (row.drugCode) {
      codes.add(normalizeDrugCode(row.drugCode));
    }
  }
  return [...codes];
}

function createLookupState(): DrugMasterLookupState {
  return {
    codeCache: new Map<string, MasterMatchInfo>(),
    masterById: new Map<number, MasterRecord>(),
    packageCandidatesByMaster: new Map<number, PackageCandidate[]>(),
    loadedPackageCandidateMasterIds: new Set<number>(),
  };
}

function toMasterMatchInfo(
  master: MasterRecord,
  drugMasterPackageId: number | null,
  packageLabel: string | null,
): MasterMatchInfo {
  return {
    id: master.id,
    yakkaPrice: master.yakkaPrice,
    unit: master.unit,
    drugMasterPackageId,
    packageLabel,
  };
}

function addCodePackageCandidate(
  packageByCode: Map<string, PackageCandidate>,
  code: string | null,
  candidate: PackageCandidate,
): void {
  if (!code) return;
  packageByCode.set(normalizeDrugCode(code), candidate);
}

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

function storeMasterRecord(
  state: DrugMasterLookupState,
  row: { id: number; yakkaPrice: string | number | null; unit: string | null },
): MasterRecord {
  const master = {
    id: row.id,
    yakkaPrice: toNum(row.yakkaPrice),
    unit: row.unit,
  };
  state.masterById.set(row.id, master);
  return master;
}

async function loadPackageCandidatesForMasterIds(
  state: DrugMasterLookupState,
  masterIds: number[],
): Promise<void> {
  const targetMasterIds = [...new Set(masterIds)]
    .filter((id) => !state.loadedPackageCandidateMasterIds.has(id));
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
    state.packageCandidatesByMaster.set(id, grouped.get(id) ?? []);
    state.loadedPackageCandidateMasterIds.add(id);
  }
}

function collectMasterIdsNeedingPackages<T extends BaseRow>(
  rows: T[],
  masterInfoByRow: (MasterMatchInfo | null)[],
): number[] {
  const masterIds = new Set<number>();
  for (let index = 0; index < rows.length; index += 1) {
    const masterInfo = masterInfoByRow[index];
    if (!masterInfo || masterInfo.drugMasterPackageId || !rows[index].unit) {
      continue;
    }
    masterIds.add(masterInfo.id);
  }
  return [...masterIds];
}

function scoreNameMatch(
  normalizedSearch: string,
  normalizedTarget: string,
): { matchType: MasterCandidate['matchType']; score: number } {
  if (normalizedTarget === normalizedSearch) {
    return { matchType: 'exact_name', score: 100 };
  }
  if (normalizedTarget.includes(normalizedSearch)) {
    return {
      matchType: 'fuzzy_name',
      score: 80 - Math.min(30, Math.abs(normalizedTarget.length - normalizedSearch.length)),
    };
  }
  if (normalizedSearch.includes(normalizedTarget)) {
    return {
      matchType: 'fuzzy_name',
      score: 70 - Math.min(30, Math.abs(normalizedTarget.length - normalizedSearch.length)),
    };
  }

  const minLen = Math.min(normalizedSearch.length, normalizedTarget.length);
  let commonPrefix = 0;
  for (let i = 0; i < minLen; i += 1) {
    if (normalizedSearch[i] !== normalizedTarget[i]) {
      break;
    }
    commonPrefix += 1;
  }
  if (commonPrefix < 3) {
    return { matchType: 'none', score: 0 };
  }

  return {
    matchType: 'fuzzy_name',
    score: 40 + commonPrefix * 2,
  };
}

function findPackageByUnit(
  packageCandidatesByMaster: Map<number, PackageCandidate[]>,
  drugMasterId: number,
  rowUnit: string | null,
): PackageCandidate | null {
  if (!rowUnit) return null;
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

function resolvePackageLabel(
  packageInfo: PackageCandidate | null,
  masterInfo: MasterMatchInfo | null,
): string | null {
  return packageInfo?.normalizedPackageLabel
    ?? packageInfo?.packageDescription
    ?? masterInfo?.packageLabel
    ?? null;
}

function applyMasterDefaults<T extends BaseRow>(
  enriched: EnrichedRow<T>,
  masterInfo: MasterMatchInfo,
  type: 'dead_stock' | 'used_medication',
): void {
  const isDeadStockLike = (row: EnrichedRow<T>): row is EnrichedRow<T & DeadStockRow> => (
    'quantity' in row && 'yakkaTotal' in row
  );

  if (enriched.yakkaUnitPrice === null || enriched.yakkaUnitPrice === undefined) {
    enriched.yakkaUnitPrice = masterInfo.yakkaPrice;
    if (type === 'dead_stock' && isDeadStockLike(enriched)) {
      enriched.yakkaTotal = masterInfo.yakkaPrice * enriched.quantity;
    }
  }
  if (!enriched.unit && masterInfo.unit) {
    enriched.unit = masterInfo.unit;
  }
}

async function populateCodeLookup(
  normalizedCodes: string[],
  state: DrugMasterLookupState,
): Promise<void> {
  if (normalizedCodes.length === 0) return;

  const matchedMasterRows = await db.select({
    id: drugMaster.id,
    yjCode: drugMaster.yjCode,
    yakkaPrice: drugMaster.yakkaPrice,
    unit: drugMaster.unit,
  })
    .from(drugMaster)
    .where(inArray(drugMaster.yjCode, normalizedCodes));

  for (const row of matchedMasterRows) {
    const master = storeMasterRecord(state, row);
    state.codeCache.set(row.yjCode, toMasterMatchInfo(master, null, null));
  }

  const unresolvedCodes = normalizedCodes.filter((code) => !state.codeCache.has(code));
  if (unresolvedCodes.length === 0) return;

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
    addCodePackageCandidate(packageByCode, pkg.gs1Code, candidate);
    addCodePackageCandidate(packageByCode, pkg.janCode, candidate);
    addCodePackageCandidate(packageByCode, pkg.hotCode, candidate);
    packageMasterIds.add(candidate.drugMasterId);
  }

  const unresolvedMasterIds = [...packageMasterIds]
    .filter((masterId) => !state.masterById.has(masterId));
  if (unresolvedMasterIds.length > 0) {
    const packageMasterRows = await db.select({
      id: drugMaster.id,
      yakkaPrice: drugMaster.yakkaPrice,
      unit: drugMaster.unit,
    })
      .from(drugMaster)
      .where(inArray(drugMaster.id, unresolvedMasterIds));
    for (const row of packageMasterRows) {
      storeMasterRecord(state, row);
    }
  }

  for (const code of unresolvedCodes) {
    const packageCandidate = packageByCode.get(code);
    if (!packageCandidate) continue;
    const master = state.masterById.get(packageCandidate.drugMasterId);
    if (!master) continue;

    state.codeCache.set(
      code,
      toMasterMatchInfo(
        master,
        packageCandidate.id,
        packageCandidate.normalizedPackageLabel ?? packageCandidate.packageDescription,
      ),
    );
  }
}

interface ResolveMasterResult {
  masterInfoByRow: (MasterMatchInfo | null)[];
  codeNotFoundIndexes: Set<number>;
}

async function resolveMasterInfoByRow<T extends BaseRow>(
  rows: T[],
  codeCache: Map<string, MasterMatchInfo>,
): Promise<ResolveMasterResult> {
  const nameCache = new Map<string, MasterMatchInfo | null>();
  let masterByNormalizedName: Map<string, MasterMatchInfo> | null = null;

  const resolveByCode = (drugCode: string | null): MasterMatchInfo | null => {
    if (!drugCode) return null;
    return codeCache.get(normalizeDrugCode(drugCode)) ?? null;
  };

  const loadNameCache = async (): Promise<void> => {
    if (masterByNormalizedName) return;
    const all = await db.select({
      id: drugMaster.id,
      drugName: drugMaster.drugName,
      yakkaPrice: drugMaster.yakkaPrice,
      unit: drugMaster.unit,
    }).from(drugMaster);

    const byName = new Map<string, MasterMatchInfo>();
    for (const row of all) {
      const normalizedName = normalizeString(row.drugName);
      if (byName.has(normalizedName)) continue;
      byName.set(normalizedName, {
        id: row.id,
        yakkaPrice: toNum(row.yakkaPrice),
        unit: row.unit,
        drugMasterPackageId: null,
        packageLabel: null,
      });
    }
    masterByNormalizedName = byName;
  };

  const findByName = (drugName: string): MasterMatchInfo | null => {
    if (nameCache.has(drugName)) {
      return nameCache.get(drugName) ?? null;
    }
    if (!masterByNormalizedName) {
      return null;
    }

    const exact = masterByNormalizedName.get(normalizeString(drugName)) ?? null;
    nameCache.set(drugName, exact);
    return exact;
  };

  const masterInfoByRow = rows.map((row) => resolveByCode(row.drugCode));
  // Track indexes where a drug_code was provided but didn't match any master code.
  // These rows fall back to name matching and must NOT be reported as 'exact'.
  const codeNotFoundIndexes = new Set<number>();
  const unresolvedNameIndexes: number[] = [];
  for (let index = 0; index < masterInfoByRow.length; index += 1) {
    if (!masterInfoByRow[index]) {
      unresolvedNameIndexes.push(index);
      if (rows[index].drugCode) {
        codeNotFoundIndexes.add(index);
      }
    }
  }

  if (unresolvedNameIndexes.length > 0) {
    await loadNameCache();
    for (const index of unresolvedNameIndexes) {
      masterInfoByRow[index] = findByName(rows[index].drugName);
    }
  }

  return { masterInfoByRow, codeNotFoundIndexes };
}

async function enrichRowsWithResolvedInfo<T extends BaseRow>(
  rows: T[],
  type: 'dead_stock' | 'used_medication',
  masterInfoByRow: (MasterMatchInfo | null)[],
  state: DrugMasterLookupState,
  codeNotFoundIndexes: Set<number>,
  warnings?: EnrichmentWarning[],
): Promise<EnrichedRow<T>[]> {
  const masterIdsNeedingPackages = collectMasterIdsNeedingPackages(rows, masterInfoByRow);
  await loadPackageCandidatesForMasterIds(state, masterIdsNeedingPackages);

  return rows.map((row, index) => {
    const masterInfo = masterInfoByRow[index];
    const packageInfo = masterInfo && !masterInfo.drugMasterPackageId && row.unit
      ? findPackageByUnit(state.packageCandidatesByMaster, masterInfo.id, row.unit)
      : null;

    const isCodeNotFound = codeNotFoundIndexes.has(index);

    // Determine match confidence:
    // - 'exact'         : drug_code provided and matched a master code
    // - 'code_not_found': drug_code provided but didn't match any master code; fell back to name
    // - 'fuzzy'         : no drug_code provided; matched by name
    // - 'none'          : no match found at all
    let matchConfidence: 'exact' | 'fuzzy' | 'code_not_found' | 'none';
    if (!masterInfo) {
      matchConfidence = 'none';
    } else if (row.drugCode && !isCodeNotFound) {
      matchConfidence = 'exact';
    } else if (isCodeNotFound) {
      matchConfidence = 'code_not_found';
    } else {
      matchConfidence = 'fuzzy';
    }

    if (isCodeNotFound && warnings) {
      warnings.push({
        rowIndex: index,
        issueCode: 'DRUG_CODE_NOT_IN_MASTER',
        issueMessage: `薬品コード「${row.drugCode}」は医薬品マスターに存在しません。薬品名による照合にフォールバックしました`,
      });
    }

    const enriched: EnrichedRow<T> = {
      ...row,
      drugMasterId: masterInfo?.id ?? null,
      drugMasterPackageId: packageInfo?.id ?? masterInfo?.drugMasterPackageId ?? null,
      packageLabel: resolvePackageLabel(packageInfo, masterInfo),
      matchConfidence,
    };

    if (masterInfo) {
      applyMasterDefaults(enriched, masterInfo, type);
    }

    return enriched;
  });
}

/**
 * 薬品名であいまい検索し、候補リストを返す。
 * アップロード時に紐付けできなかった行に対して、ユーザーが正しい品目を選択するために使用。
 */
export async function searchMasterCandidates(
  drugName: string,
  limit: number = 10,
): Promise<MasterCandidate[]> {
  const normalized = normalizeString(drugName);
  if (!normalized || normalized.length < 2) return [];

  const searchCondition = buildTokenizedSearchConditions(normalized, [drugMaster.drugName, drugMaster.genericName]);
  if (!searchCondition) return [];

  const filtered = await db.select({
    id: drugMaster.id,
    drugName: drugMaster.drugName,
    yjCode: drugMaster.yjCode,
    yakkaPrice: drugMaster.yakkaPrice,
    unit: drugMaster.unit,
  }).from(drugMaster)
    .where(searchCondition)
    .limit(200);

  const scored: Array<MasterCandidate & { score: number }> = [];

  for (const row of filtered) {
    const rowNormalized = normalizeString(row.drugName);
    if (!rowNormalized) continue;
    const { matchType, score } = scoreNameMatch(normalized, rowNormalized);
    if (matchType !== 'none') {
      scored.push({
        drugMasterId: row.id,
        drugName: row.drugName,
        yjCode: row.yjCode,
        yakkaPrice: toNum(row.yakkaPrice),
        unit: row.unit,
        matchType,
        score,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ score: _score, ...rest }) => rest);
}

/**
 * 医薬品マスターからの自動補完処理
 * - drugCodeがある場合: YJコード/GS1コード/JANコードで検索
 * - yakkaUnitPriceが空の場合: マスターの薬価で補完
 * - unitが空の場合: マスターの単位で補完
 *
 * @param warnings - オプション。drug_codeが存在しない場合などの警告を収集する配列。
 *                   渡された場合、DRUG_CODE_NOT_IN_MASTER 警告が追記される。
 */
export async function enrichWithDrugMaster<T extends BaseRow>(
  rows: T[],
  type: 'dead_stock' | 'used_medication',
  warnings?: EnrichmentWarning[],
): Promise<EnrichedRow<T>[]> {
  // マスターが空なら何もしない
  const [masterCheck] = await db.select({ id: drugMaster.id }).from(drugMaster).limit(1);
  if (!masterCheck) {
    return rows.map(toEmptyEnrichedRow);
  }
  const normalizedCodes = collectNormalizedCodes(rows);
  const lookupState = createLookupState();
  await populateCodeLookup(normalizedCodes, lookupState);

  const { masterInfoByRow, codeNotFoundIndexes } = await resolveMasterInfoByRow(rows, lookupState.codeCache);
  return enrichRowsWithResolvedInfo(rows, type, masterInfoByRow, lookupState, codeNotFoundIndexes, warnings);
}
