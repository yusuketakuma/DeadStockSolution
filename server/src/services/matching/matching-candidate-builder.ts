import { MatchCandidate, MatchItem } from '../../types';
import { getBusinessHoursStatus } from '../../utils/business-hours-utils';
import { haversineDistance } from '../../utils/geo-utils';
import {
  calculateCandidateScore,
  calculateMatchRate,
  DrugMatchResult,
  findBestDrugMatch,
  isExpiredDate,
  roundTo2,
} from '../matching-score-service';
import {
  balanceValues,
  MIN_EXCHANGE_VALUE,
  VALUE_TOLERANCE,
} from '../matching-filter-service';
import type { getActiveMatchingRuleProfile } from '../matching-rule-service';
import {
  BusinessHoursRows,
  PharmacyWithDistance,
  SpecialHoursRows,
  ViablePharmacyRow,
} from './matching-data-fetcher';
import { PreparedStockRow, UsedMedIndex } from './matching-data-preparer';

const DISTANCE_FALLBACK = 9999;
const MAX_COMPARISON_PHARMACIES_PER_SOURCE = resolveComparisonPharmacyLimit(
  process.env.MATCHING_MAX_COMPARISON_PHARMACIES_PER_SOURCE,
);

export type MatchingRuleProfile = Awaited<ReturnType<typeof getActiveMatchingRuleProfile>>;

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
): MatchItem[] {
  const items: MatchItem[] = [];

  for (const { stock, preparedDrugName } of preparedStocks) {
    const price = Number(stock.yakkaUnitPrice);
    if (!price || price <= 0) continue;

    const expirySource = stock.expirationDateIso ?? stock.expirationDate;
    if (isExpiredDate(expirySource)) continue;

    const match = findBestDrugMatch(preparedDrugName, usedMedIndex, matchCache);
    if (match.score < nameMatchThreshold) continue;

    items.push({
      deadStockItemId: stock.id,
      drugName: stock.drugName,
      quantity: stock.quantity,
      unit: stock.unit,
      yakkaUnitPrice: price,
      yakkaValue: roundTo2(price * stock.quantity),
      expirationDate: stock.expirationDate,
      expirationDateIso: stock.expirationDateIso,
      lotNumber: stock.lotNumber,
      stockCreatedAt: stock.createdAt,
      matchScore: roundTo2(match.score),
    });
  }

  return items;
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
  now: Date;
  includeIsConfiguredInBusinessStatus: boolean;
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
    now,
    includeIsConfiguredInBusinessStatus,
  } = params;

  const theirPreparedDeadStock = preparedDeadStockByPharmacy.get(otherPharmacy.id) ?? [];
  const theirUsedMedIndex = usedMedIndexByPharmacy.get(otherPharmacy.id);
  if (theirPreparedDeadStock.length === 0 || !theirUsedMedIndex) return null;

  const myToTheirCache = new Map<string, DrugMatchResult>();
  const theirToMyCache = new Map<string, DrugMatchResult>();
  const itemsFromA = buildMatchItems(
    myPreparedDeadStock,
    theirUsedMedIndex,
    myToTheirCache,
    matchingRuleProfile.nameMatchThreshold,
  );
  const itemsFromB = buildMatchItems(
    theirPreparedDeadStock,
    myUsedMedIndex,
    theirToMyCache,
    matchingRuleProfile.nameMatchThreshold,
  );
  if (itemsFromA.length === 0 || itemsFromB.length === 0) return null;

  const { balancedA, balancedB, totalA, totalB } = balanceValues(itemsFromA, itemsFromB);
  if (balancedA.length === 0 || balancedB.length === 0) return null;

  const minValue = Math.min(totalA, totalB);
  if (minValue < MIN_EXCHANGE_VALUE) return null;

  const diff = roundTo2(Math.abs(totalA - totalB));
  if (diff > VALUE_TOLERANCE) return null;

  const isFavorite = favoriteIds.has(otherPharmacy.id);
  const score = calculateCandidateScore(
    totalA,
    totalB,
    diff,
    otherPharmacy.distance,
    balancedA,
    balancedB,
    matchingRuleProfile,
    isFavorite,
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
    score,
    matchRate,
    businessStatus,
    isFavorite,
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
  now: Date;
  includeIsConfiguredInBusinessStatus: boolean;
}): MatchCandidate[] {
  const candidates: MatchCandidate[] = [];

  for (const otherPharmacy of params.pharmaciesWithDistance) {
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
      now: params.now,
      includeIsConfiguredInBusinessStatus: params.includeIsConfiguredInBusinessStatus,
    });
    if (!candidate) continue;
    candidates.push(candidate);
  }

  return candidates;
}
