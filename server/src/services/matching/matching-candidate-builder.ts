import { MatchCandidate, MatchItem } from '../../types';
import { getBusinessHoursStatus } from '../../utils/business-hours-utils';
import { haversineDistance } from '../../utils/geo-utils';
import { classifyPackageFormFromUnit, arePackageFormsCompatible, type PackageForm } from '../../utils/package-utils';
import {
  calculateCandidateScoreWithBreakdown,
  calculateMatchRate,
  findBestDrugMatchWithEquivalences,
  isExpiredDate,
  roundTo2,
} from '../matching-score-service';
import type { DrugMatchResult, MatchingRuleProfile, PharmacyWithDistance, PreparedStockRow, UsedMedIndex, ViablePharmacyRow } from '../../types/matching';
import {
  balanceValues,
  MIN_EXCHANGE_VALUE,
  VALUE_TOLERANCE,
} from '../matching-filter-service';
import {
  BusinessHoursRows,
  SpecialHoursRows,
} from './matching-data-fetcher';

const DISTANCE_FALLBACK = 9999;
const MAX_COMPARISON_PHARMACIES_PER_SOURCE = resolveComparisonPharmacyLimit(
  process.env.MATCHING_MAX_COMPARISON_PHARMACIES_PER_SOURCE,
);

function resolveComparisonPharmacyLimit(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Math.min(parsed, 1000);
}

function buildMatchItems(
  preparedStocks: PreparedStockRow[],
  usedMedIndex: UsedMedIndex,
  matchCache: Map<string, DrugMatchResult>,
  nameMatchThreshold: number,
  equivalenceMap: Map<string, string[]>,
): { items: MatchItem[]; hasEquivalenceMatch: boolean } {
  const items: MatchItem[] = [];
  let hasEquivalenceMatch = false;

  for (const { stock, preparedDrugName } of preparedStocks) {
    const price = Number(stock.yakkaUnitPrice);
    if (!price || price <= 0) continue;

    const expirySource = stock.expirationDateIso ?? stock.expirationDate;
    if (isExpiredDate(expirySource)) continue;

    const match = findBestDrugMatchWithEquivalences(preparedDrugName, usedMedIndex, matchCache, equivalenceMap);
    if (match.score < nameMatchThreshold) continue;

    if (match.matchedByEquivalence) {
      hasEquivalenceMatch = true;
    }

    items.push({
      deadStockItemId: stock.id,
      drugName: stock.drugName,
      quantity: stock.quantity,
      unit: stock.unit,
      packageForm: classifyPackageFormFromUnit(stock.packageLabel ?? stock.unit),
      yakkaUnitPrice: price,
      yakkaValue: roundTo2(price * stock.quantity),
      expirationDate: stock.expirationDate,
      expirationDateIso: stock.expirationDateIso,
      lotNumber: stock.lotNumber,
      stockCreatedAt: stock.createdAt,
      matchScore: roundTo2(match.score),
    });
  }

  return { items, hasEquivalenceMatch };
}

/**
 * A/Bの品目ペアで包装形態の互換性をチェックし、非互換な品目を除外する。
 *
 * ルール:
 * - 同一薬品名（正規化後）でA側がPTP、B側がバラ → 両方除外
 * - 包装形態が不明（null）の場合は互換扱い（除外しない）
 * - 100T PTP ↔ 1000T PTP は互換（包装数量は無視、形態のみ比較）
 */
function filterByPackageCompatibility(
  itemsA: MatchItem[],
  itemsB: MatchItem[],
): { itemsFromA: MatchItem[]; itemsFromB: MatchItem[] } {
  // B側の薬品名→包装形態マップ（同一薬品名で複数形態がある場合は全て保持）
  const bFormsByDrug = new Map<string, Set<string>>();
  for (const item of itemsB) {
    const key = item.drugName.normalize('NFKC').toLowerCase();
    const forms = bFormsByDrug.get(key) ?? new Set<string>();
    if (item.packageForm) forms.add(item.packageForm);
    bFormsByDrug.set(key, forms);
  }

  const aFormsByDrug = new Map<string, Set<string>>();
  for (const item of itemsA) {
    const key = item.drugName.normalize('NFKC').toLowerCase();
    const forms = aFormsByDrug.get(key) ?? new Set<string>();
    if (item.packageForm) forms.add(item.packageForm);
    aFormsByDrug.set(key, forms);
  }

  // A品目: B側に同一薬品名があり、包装形態が非互換なら除外
  const filteredA = itemsA.filter((item) => {
    if (!item.packageForm) return true;
    const key = item.drugName.normalize('NFKC').toLowerCase();
    const bForms = bFormsByDrug.get(key);
    if (!bForms || bForms.size === 0) return true; // B側に形態情報なし→許容
    return [...bForms].some((bf) => arePackageFormsCompatible(item.packageForm as PackageForm, bf as PackageForm));
  });

  // B品目: A側に同一薬品名があり、包装形態が非互換なら除外
  const filteredB = itemsB.filter((item) => {
    if (!item.packageForm) return true;
    const key = item.drugName.normalize('NFKC').toLowerCase();
    const aForms = aFormsByDrug.get(key);
    if (!aForms || aForms.size === 0) return true;
    return [...aForms].some((af) => arePackageFormsCompatible(item.packageForm as PackageForm, af as PackageForm));
  });

  return { itemsFromA: filteredA, itemsFromB: filteredB };
}

function clampPharmacyComparisonPool<T extends { id: number }>(
  sortedPharmacies: T[],
  favoriteIds: Set<number>,
): T[] {
  if (sortedPharmacies.length <= MAX_COMPARISON_PHARMACIES_PER_SOURCE) {
    return sortedPharmacies;
  }

  const selected = sortedPharmacies.slice(0, MAX_COMPARISON_PHARMACIES_PER_SOURCE);
  const selectedIds = new Set(selected.map((pharmacy) => pharmacy.id));
  for (const pharmacy of sortedPharmacies) {
    if (favoriteIds.has(pharmacy.id) && !selectedIds.has(pharmacy.id)) {
      selected.push(pharmacy);
    }
  }
  return selected;
}

function resolveDistance(
  sourcePharmacy: { latitude: number | null; longitude: number | null },
  targetPharmacy: { latitude: number | null; longitude: number | null },
): number {
  if (
    sourcePharmacy.latitude === null ||
    sourcePharmacy.longitude === null ||
    targetPharmacy.latitude === null ||
    targetPharmacy.longitude === null
  ) {
    return DISTANCE_FALLBACK;
  }

  return haversineDistance(
    sourcePharmacy.latitude,
    sourcePharmacy.longitude,
    targetPharmacy.latitude,
    targetPharmacy.longitude,
  );
}

export function buildPharmaciesWithDistance(
  sourcePharmacy: { latitude: number | null; longitude: number | null },
  viablePharmacies: ViablePharmacyRow[],
  favoriteIds: Set<number>,
): PharmacyWithDistance[] {
  const sortedByDistance = viablePharmacies
    .map((pharmacy) => ({
      ...pharmacy,
      distance: resolveDistance(sourcePharmacy, pharmacy),
    }))
    .sort((a, b) => a.distance - b.distance || a.id - b.id);

  return clampPharmacyComparisonPool(sortedByDistance, favoriteIds);
}

function buildCandidateBusinessStatus(
  pharmacyHours: BusinessHoursRows | undefined,
  pharmacySpecialHours: SpecialHoursRows | undefined,
  now: Date,
  includeIsConfigured: boolean,
) {
  const businessStatus = getBusinessHoursStatus(pharmacyHours ?? [], pharmacySpecialHours ?? [], now);
  if (!includeIsConfigured) {
    return businessStatus;
  }

  return {
    ...businessStatus,
    isConfigured: (pharmacyHours?.length ?? 0) > 0 || (pharmacySpecialHours?.length ?? 0) > 0,
  };
}

function resolveBalancedCandidateValues(itemsFromA: MatchItem[], itemsFromB: MatchItem[]) {
  const { balancedA, balancedB, totalA, totalB } = balanceValues(itemsFromA, itemsFromB);
  const minValue = Math.min(totalA, totalB);
  const diff = roundTo2(Math.abs(totalA - totalB));
  return { balancedA, balancedB, totalA, totalB, minValue, diff };
}

function buildCandidateFromPharmacy(params: {
  otherPharmacy: PharmacyWithDistance;
  myPreparedDeadStock: PreparedStockRow[];
  myUsedMedIndex: UsedMedIndex;
  preparedDeadStockByPharmacy: Map<number, PreparedStockRow[]>;
  usedMedIndexByPharmacy: Map<number, UsedMedIndex>;
  businessHoursByPharmacy: Map<number, BusinessHoursRows>;
  specialHoursByPharmacy: Map<number, SpecialHoursRows>;
  matchingRuleProfile: MatchingRuleProfile;
  favoriteIds: Set<number>;
  groupMemberIds: Set<number>;
  now: Date;
  includeIsConfiguredInBusinessStatus: boolean;
  equivalenceMap: Map<string, string[]>;
  myToTheirCache: Map<string, DrugMatchResult>;
  theirToMyCache: Map<string, DrugMatchResult>;
  successCountByPharmacy: Map<number, number>;
}): MatchCandidate | null {
  const {
    otherPharmacy,
    myPreparedDeadStock,
    myUsedMedIndex,
    preparedDeadStockByPharmacy,
    usedMedIndexByPharmacy,
    businessHoursByPharmacy,
    specialHoursByPharmacy,
    matchingRuleProfile,
    favoriteIds,
    groupMemberIds,
    now,
    includeIsConfiguredInBusinessStatus,
    equivalenceMap,
    myToTheirCache,
    theirToMyCache,
    successCountByPharmacy,
  } = params;

  const theirPreparedDeadStock = preparedDeadStockByPharmacy.get(otherPharmacy.id) ?? [];
  const theirUsedMedIndex = usedMedIndexByPharmacy.get(otherPharmacy.id);
  if (theirPreparedDeadStock.length === 0 || !theirUsedMedIndex) return null;

  const { items: rawItemsFromA, hasEquivalenceMatch: aHasEquivalence } = buildMatchItems(
    myPreparedDeadStock,
    theirUsedMedIndex,
    myToTheirCache,
    matchingRuleProfile.nameMatchThreshold,
    equivalenceMap,
  );
  const { items: rawItemsFromB, hasEquivalenceMatch: bHasEquivalence } = buildMatchItems(
    theirPreparedDeadStock,
    myUsedMedIndex,
    theirToMyCache,
    matchingRuleProfile.nameMatchThreshold,
    equivalenceMap,
  );
  if (rawItemsFromA.length === 0 || rawItemsFromB.length === 0) return null;

  // 包装形態互換性フィルタ: A/Bで同一薬品名の品目間で包装形態が非互換な場合は除外
  const { itemsFromA, itemsFromB } = filterByPackageCompatibility(rawItemsFromA, rawItemsFromB);
  if (itemsFromA.length === 0 || itemsFromB.length === 0) return null;

  const { balancedA, balancedB, totalA, totalB, minValue, diff } = resolveBalancedCandidateValues(itemsFromA, itemsFromB);
  if (balancedA.length === 0 || balancedB.length === 0) return null;
  if (minValue < MIN_EXCHANGE_VALUE) return null;
  if (diff > VALUE_TOLERANCE) return null;

  const isFavorite = favoriteIds.has(otherPharmacy.id);
  const isGroupMember = groupMemberIds.has(otherPharmacy.id);
  const successCount = successCountByPharmacy.get(otherPharmacy.id) ?? 0;
  const scoreResult = calculateCandidateScoreWithBreakdown(
    totalA,
    totalB,
    diff,
    otherPharmacy.distance,
    balancedA,
    balancedB,
    matchingRuleProfile,
    isFavorite,
    isGroupMember,
    new Date(),
    successCount,
  );
  const matchRate = calculateMatchRate(balancedA, balancedB);
  const pharmacyHours = businessHoursByPharmacy.get(otherPharmacy.id);
  const pharmacySpecialHours = specialHoursByPharmacy.get(otherPharmacy.id);
  const businessStatus = buildCandidateBusinessStatus(
    pharmacyHours,
    pharmacySpecialHours,
    now,
    includeIsConfiguredInBusinessStatus,
  );

  const matchType: 'exact' | 'equivalent' = (aHasEquivalence || bHasEquivalence) ? 'equivalent' : 'exact';

  return {
    pharmacyId: otherPharmacy.id,
    pharmacyName: otherPharmacy.name,
    pharmacyPhone: otherPharmacy.phone,
    pharmacyFax: otherPharmacy.fax,
    distance: roundTo2(otherPharmacy.distance),
    itemsFromA: balancedA,
    itemsFromB: balancedB,
    totalValueA: roundTo2(totalA),
    totalValueB: roundTo2(totalB),
    valueDifference: diff,
    score: scoreResult.total,
    scoreBreakdown: scoreResult.breakdown,
    matchRate,
    businessStatus,
    isFavorite,
    matchType,
  };
}

function isStockEligibleForMatch(stock: PreparedStockRow['stock']): boolean {
  const price = Number(stock.yakkaUnitPrice);
  if (!price || price <= 0) return false;

  const expirySource = stock.expirationDateIso ?? stock.expirationDate;
  return !isExpiredDate(expirySource);
}

function precomputeGlobalDrugMatches(params: {
  pharmaciesWithDistance: PharmacyWithDistance[];
  preparedDeadStockByPharmacy: Map<number, PreparedStockRow[]>;
  myUsedMedIndex: UsedMedIndex;
  nameMatchThreshold: number;
  equivalenceMap: Map<string, string[]>;
}): {
  pharmaciesWithInboundMatches: Set<number>;
  globalDrugMatchCache: Map<string, DrugMatchResult>;
} {
  const candidatePharmacyIds = new Set(params.pharmaciesWithDistance.map((pharmacy) => pharmacy.id));
  const drugToPharmacies = new Map<string, {
    preparedDrugName: PreparedStockRow['preparedDrugName'];
    pharmacyIds: Set<number>;
  }>();

  for (const [pharmacyId, preparedStocks] of params.preparedDeadStockByPharmacy.entries()) {
    if (!candidatePharmacyIds.has(pharmacyId)) continue;

    for (const { stock, preparedDrugName } of preparedStocks) {
      if (!isStockEligibleForMatch(stock)) continue;
      const key = preparedDrugName.normalizedDrugName;
      if (!key) continue;

      const existing = drugToPharmacies.get(key);
      if (existing) {
        existing.pharmacyIds.add(pharmacyId);
        continue;
      }

      drugToPharmacies.set(key, {
        preparedDrugName,
        pharmacyIds: new Set<number>([pharmacyId]),
      });
    }
  }

  const globalDrugMatchCache = new Map<string, DrugMatchResult>();
  const pharmaciesWithInboundMatches = new Set<number>();

  for (const { preparedDrugName, pharmacyIds } of drugToPharmacies.values()) {
    const match = findBestDrugMatchWithEquivalences(
      preparedDrugName,
      params.myUsedMedIndex,
      globalDrugMatchCache,
      params.equivalenceMap,
    );
    if (match.score < params.nameMatchThreshold) continue;

    for (const pharmacyId of pharmacyIds) {
      pharmaciesWithInboundMatches.add(pharmacyId);
    }
  }

  return {
    pharmaciesWithInboundMatches,
    globalDrugMatchCache,
  };
}

export function collectCandidates(params: {
  pharmaciesWithDistance: PharmacyWithDistance[];
  myPreparedDeadStock: PreparedStockRow[];
  myUsedMedIndex: UsedMedIndex;
  preparedDeadStockByPharmacy: Map<number, PreparedStockRow[]>;
  usedMedIndexByPharmacy: Map<number, UsedMedIndex>;
  businessHoursByPharmacy: Map<number, BusinessHoursRows>;
  specialHoursByPharmacy: Map<number, SpecialHoursRows>;
  matchingRuleProfile: MatchingRuleProfile;
  favoriteIds: Set<number>;
  groupMemberIds: Set<number>;
  now: Date;
  includeIsConfiguredInBusinessStatus: boolean;
  equivalenceMap: Map<string, string[]>;
  successCountByPharmacy: Map<number, number>;
}): MatchCandidate[] {
  const candidates: MatchCandidate[] = [];
  const { pharmaciesWithInboundMatches, globalDrugMatchCache } = precomputeGlobalDrugMatches({
    pharmaciesWithDistance: params.pharmaciesWithDistance,
    preparedDeadStockByPharmacy: params.preparedDeadStockByPharmacy,
    myUsedMedIndex: params.myUsedMedIndex,
    nameMatchThreshold: params.matchingRuleProfile.nameMatchThreshold,
    equivalenceMap: params.equivalenceMap,
  });
  if (pharmaciesWithInboundMatches.size === 0) {
    return candidates;
  }

  for (const otherPharmacy of params.pharmaciesWithDistance) {
    if (!pharmaciesWithInboundMatches.has(otherPharmacy.id)) continue;

    const candidate = buildCandidateFromPharmacy({
      otherPharmacy,
      myPreparedDeadStock: params.myPreparedDeadStock,
      myUsedMedIndex: params.myUsedMedIndex,
      matchingRuleProfile: params.matchingRuleProfile,
      preparedDeadStockByPharmacy: params.preparedDeadStockByPharmacy,
      usedMedIndexByPharmacy: params.usedMedIndexByPharmacy,
      businessHoursByPharmacy: params.businessHoursByPharmacy,
      specialHoursByPharmacy: params.specialHoursByPharmacy,
      favoriteIds: params.favoriteIds,
      groupMemberIds: params.groupMemberIds,
      now: params.now,
      includeIsConfiguredInBusinessStatus: params.includeIsConfiguredInBusinessStatus,
      equivalenceMap: params.equivalenceMap,
      myToTheirCache: new Map<string, DrugMatchResult>(),
      theirToMyCache: globalDrugMatchCache,
      successCountByPharmacy: params.successCountByPharmacy,
    });
    if (!candidate) continue;
    candidates.push(candidate);
  }

  return candidates;
}
