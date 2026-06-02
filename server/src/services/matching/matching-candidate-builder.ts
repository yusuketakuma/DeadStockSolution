import { MatchCandidate, MatchItem } from '../../types';
import { getBusinessHoursStatus } from '../../utils/business-hours-utils';
import { haversineDistance } from '../../utils/geo-utils';
import { classifyPackageFormFromUnit, arePackageFormsCompatible, type PackageForm } from '../../utils/package-utils';
import {
  calculateCandidateScoreWithBreakdown,
  calculateMatchRate,
  findBestDrugMatchWithEquivalences,
  isExpiredDate,
  prepareDrugName,
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
const BOX_QUANTITY_EPSILON = 0.0001;

interface CandidateMatchItem {
  item: MatchItem;
  compatibilityKeys: Set<string>;
}

type PackageFormsByKey = Map<string, Set<string>>;

interface BoxListingInfo {
  boxCount: number;
  packageQuantity: number;
  packageUnit: string;
  listingQuantity: number;
  packageForm: PackageForm;
}

function normalizePackageUnit(value: string | null | undefined): string | null {
  return value?.normalize('NFKC').trim() || null;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function resolveBoxListingInfo(stock: PreparedStockRow['stock']): BoxListingInfo | null {
  const packageQuantity = Number(stock.packageQuantity);
  if (!Number.isFinite(packageQuantity) || packageQuantity <= 0) return null;

  const packageUnit = normalizePackageUnit(stock.packageUnit);
  const stockUnit = normalizePackageUnit(stock.unit);
  if (!packageUnit || (stockUnit && packageUnit !== stockUnit)) return null;

  const packageForm = (stock.packageForm ?? classifyPackageFormFromUnit(stock.packageLabel ?? stock.unit)) as PackageForm;
  if (stock.isLoosePackage === true || packageForm === 'loose') return null;

  const stockQuantity = Number(stock.quantity);
  if (!isPositiveFiniteNumber(stockQuantity)) return null;

  const boxCount = Math.floor((stockQuantity + BOX_QUANTITY_EPSILON) / packageQuantity);
  if (!Number.isInteger(boxCount) || boxCount <= 0) return null;

  return {
    boxCount,
    packageQuantity,
    packageUnit,
    listingQuantity: roundTo2(boxCount * packageQuantity),
    packageForm,
  };
}

function buildCompatibilityKeys(
  preparedDrugName: PreparedStockRow['preparedDrugName'],
  rawDrugName: string,
  matchedNormalizedName?: string,
): Set<string> {
  const compatibilityKeys = new Set<string>();
  if (preparedDrugName.normalizedDrugName) {
    compatibilityKeys.add(preparedDrugName.normalizedDrugName);
  }
  if (matchedNormalizedName) {
    compatibilityKeys.add(matchedNormalizedName);
  }
  if (compatibilityKeys.size === 0) {
    const normalizedDrugName = prepareDrugName(rawDrugName).normalizedDrugName;
    if (normalizedDrugName) {
      compatibilityKeys.add(normalizedDrugName);
    }
  }
  return compatibilityKeys;
}

function buildFormsByCompatibilityKey(items: CandidateMatchItem[]): Map<string, Set<string>> {
  const formsByKey: PackageFormsByKey = new Map<string, Set<string>>();

  for (const item of items) {
    if (!item.item.packageForm) {
      continue;
    }
    for (const key of item.compatibilityKeys) {
      const forms = formsByKey.get(key) ?? new Set<string>();
      forms.add(item.item.packageForm);
      formsByKey.set(key, forms);
    }
  }

  return formsByKey;
}

function hasCompatibleCounterpart(
  item: CandidateMatchItem,
  counterpartFormsByKey: PackageFormsByKey,
): boolean {
  if (!item.item.packageForm) {
    return true;
  }

  let foundComparableKey = false;
  for (const key of item.compatibilityKeys) {
    const counterpartForms = counterpartFormsByKey.get(key);
    if (!counterpartForms || counterpartForms.size === 0) {
      continue;
    }
    foundComparableKey = true;
    if ([...counterpartForms].some((form) => arePackageFormsCompatible(item.item.packageForm as PackageForm, form as PackageForm))) {
      return true;
    }
  }

  return !foundComparableKey;
}

function buildCandidateMatchItem(
  stock: PreparedStockRow['stock'],
  preparedDrugName: PreparedStockRow['preparedDrugName'],
  price: number,
  match: DrugMatchResult,
): CandidateMatchItem | null {
  const boxListing = resolveBoxListingInfo(stock);
  if (!boxListing) {
    return null;
  }

  return {
    item: {
      deadStockItemId: stock.id,
      drugCode: stock.drugCode,
      drugName: stock.drugName,
      drugMasterPackageId: stock.drugMasterPackageId ?? null,
      quantity: boxListing.listingQuantity,
      unit: stock.unit ?? boxListing.packageUnit,
      packageLabel: stock.packageLabel,
      packageQuantity: boxListing.packageQuantity,
      packageUnit: boxListing.packageUnit,
      boxCount: boxListing.boxCount,
      packageForm: boxListing.packageForm,
      yakkaUnitPrice: price,
      yakkaValue: roundTo2(price * boxListing.listingQuantity),
      expirationDate: stock.expirationDate,
      expirationDateIso: stock.expirationDateIso,
      lotNumber: stock.lotNumber,
      stockCreatedAt: stock.createdAt,
      matchScore: roundTo2(match.score),
    },
    compatibilityKeys: buildCompatibilityKeys(
      preparedDrugName,
      stock.drugName,
      match.matchedNormalizedName,
    ),
  };
}

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
  referenceDate: Date,
): { items: CandidateMatchItem[]; hasEquivalenceMatch: boolean } {
  const items: CandidateMatchItem[] = [];
  let hasEquivalenceMatch = false;

  for (const { stock, preparedDrugName } of preparedStocks) {
    const price = Number(stock.yakkaUnitPrice);
    if (!price || price <= 0) continue;

    const expirySource = stock.expirationDateIso ?? stock.expirationDate;
    if (isExpiredDate(expirySource, referenceDate)) continue;

    const match = findBestDrugMatchWithEquivalences(preparedDrugName, usedMedIndex, matchCache, equivalenceMap);
    if (match.score < nameMatchThreshold) continue;

    if (match.matchedByEquivalence) {
      hasEquivalenceMatch = true;
    }

    const item = buildCandidateMatchItem(stock, preparedDrugName, price, match);
    if (item) {
      items.push(item);
    }
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
  itemsA: CandidateMatchItem[],
  itemsB: CandidateMatchItem[],
): { itemsFromA: MatchItem[]; itemsFromB: MatchItem[] } {
  const bFormsByKey = buildFormsByCompatibilityKey(itemsB);
  const aFormsByKey = buildFormsByCompatibilityKey(itemsA);

  const filteredA = itemsA
    .filter((item) => hasCompatibleCounterpart(item, bFormsByKey))
    .map((item) => item.item);
  const filteredB = itemsB
    .filter((item) => hasCompatibleCounterpart(item, aFormsByKey))
    .map((item) => item.item);

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
  dismissPenaltyByPharmacy?: Map<number, Array<{ drugCode: string; penalty: number }>>;
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
    now,
  );
  const { items: rawItemsFromB, hasEquivalenceMatch: bHasEquivalence } = buildMatchItems(
    theirPreparedDeadStock,
    myUsedMedIndex,
    theirToMyCache,
    matchingRuleProfile.nameMatchThreshold,
    equivalenceMap,
    now,
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
    now,
    successCount,
  );
  const candidateDrugCodes = new Set(
    balancedA.concat(balancedB)
      .map((item) => item.drugCode?.trim() ?? '')
      .filter(Boolean),
  );
  const dismissPenalty = (params.dismissPenaltyByPharmacy?.get(otherPharmacy.id) ?? []).reduce((sum, row) => {
    if (!row.drugCode) return sum + row.penalty;
    return candidateDrugCodes.has(row.drugCode) ? sum + row.penalty : sum;
  }, 0);
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
    dismissPenalty,
    scoreBreakdown: scoreResult.breakdown,
    matchRate,
    businessStatus,
    isFavorite,
    matchType,
  };
}

function isStockEligibleForMatch(
  stock: PreparedStockRow['stock'],
  referenceDate: Date,
): boolean {
  const price = Number(stock.yakkaUnitPrice);
  if (!price || price <= 0) return false;

  const expirySource = stock.expirationDateIso ?? stock.expirationDate;
  return !isExpiredDate(expirySource, referenceDate);
}

function precomputeGlobalDrugMatches(params: {
  pharmaciesWithDistance: PharmacyWithDistance[];
  preparedDeadStockByPharmacy: Map<number, PreparedStockRow[]>;
  myUsedMedIndex: UsedMedIndex;
  nameMatchThreshold: number;
  equivalenceMap: Map<string, string[]>;
  now: Date;
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
      if (!isStockEligibleForMatch(stock, params.now)) continue;
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
  dismissPenaltyByPharmacy?: Map<number, Array<{ drugCode: string; penalty: number }>>;
}): MatchCandidate[] {
  const candidates: MatchCandidate[] = [];
  const { pharmaciesWithInboundMatches, globalDrugMatchCache } = precomputeGlobalDrugMatches({
    pharmaciesWithDistance: params.pharmaciesWithDistance,
    preparedDeadStockByPharmacy: params.preparedDeadStockByPharmacy,
    myUsedMedIndex: params.myUsedMedIndex,
    nameMatchThreshold: params.matchingRuleProfile.nameMatchThreshold,
    equivalenceMap: params.equivalenceMap,
    now: params.now,
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
      dismissPenaltyByPharmacy: params.dismissPenaltyByPharmacy,
    });
    if (!candidate) continue;
    if (candidate.score !== undefined && candidate.dismissPenalty) {
      candidate.score = Math.max(0, roundTo2(candidate.score - candidate.dismissPenalty * 4));
    }
    candidates.push(candidate);
  }

  return candidates;
}
