import { and, eq, exists, gte, inArray, ne, notExists, or, sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
  pharmacies,
  deadStockItems,
  deadStockReservations,
  usedMedicationItems,
  uploads,
  exchangeProposals,
  pharmacyBusinessHours,
  pharmacySpecialHours,
  pharmacyRelationships,
} from '../db/schema';
import { getBusinessHoursStatus } from '../utils/business-hours-utils';
import { haversineDistance } from '../utils/geo-utils';
import { MatchCandidate, MatchItem } from '../types';
import {
  roundTo2,
  prepareDrugName,
  buildUsedMedIndex,
  findBestDrugMatch,
  calculateCandidateScore,
  calculateMatchRate,
  isExpiredDate,
  DrugMatchResult,
  PreparedDrugName,
  UsedMedRow,
} from './matching-score-service';
import {
  MIN_EXCHANGE_VALUE,
  VALUE_TOLERANCE,
  MAX_CANDIDATES,
  balanceValues,
  groupByPharmacy,
} from './matching-filter-service';
import { getActiveMatchingRuleProfile } from './matching-rule-service';
import { sortMatchCandidatesByPriority } from './matching-priority-service';

interface DeadStockRow {
  id: number;
  pharmacyId: number;
  drugName: string;
  quantity: number;
  unit: string | null;
  yakkaUnitPrice: number | string | null;
  expirationDate: string | null;
  expirationDateIso: string | null;
  lotNumber: string | null;
  createdAt: string | null;
}

const RESERVATION_ACTIVE_STATUSES = ['proposed', 'accepted_a', 'accepted_b', 'confirmed'] as const;
const MAX_COMPARISON_PHARMACIES_PER_SOURCE = resolveComparisonPharmacyLimit(
  process.env.MATCHING_MAX_COMPARISON_PHARMACIES_PER_SOURCE,
);
type UsedMedIndex = ReturnType<typeof buildUsedMedIndex>;
type PreparedStockRow = { stock: DeadStockRow; preparedDrugName: PreparedDrugName };
type MatchingRuleProfile = Awaited<ReturnType<typeof getActiveMatchingRuleProfile>>;
type BusinessHoursRows = Parameters<typeof getBusinessHoursStatus>[0];
type SpecialHoursRows = Exclude<Parameters<typeof getBusinessHoursStatus>[1], Date>;

interface ViablePharmacyRow {
  id: number;
  name: string;
  phone: string | null;
  fax: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface PharmacyWithDistance extends ViablePharmacyRow {
  distance: number;
}

const DISTANCE_FALLBACK = 9999;
const DEAD_STOCK_SELECT_FIELDS = {
  id: deadStockItems.id,
  pharmacyId: deadStockItems.pharmacyId,
  drugName: deadStockItems.drugName,
  quantity: deadStockItems.quantity,
  unit: deadStockItems.unit,
  yakkaUnitPrice: deadStockItems.yakkaUnitPrice,
  expirationDate: deadStockItems.expirationDate,
  expirationDateIso: deadStockItems.expirationDateIso,
  lotNumber: deadStockItems.lotNumber,
  createdAt: deadStockItems.createdAt,
};
const USED_MED_SELECT_FIELDS = {
  pharmacyId: usedMedicationItems.pharmacyId,
  drugName: usedMedicationItems.drugName,
};

function resolveComparisonPharmacyLimit(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Math.min(parsed, 1000);
}

function applyReservationsToStockRows(
  rows: DeadStockRow[],
  reservedByItemId: Map<number, number>,
): DeadStockRow[] {
  const adjusted: DeadStockRow[] = [];
  for (const row of rows) {
    const reservedQty = reservedByItemId.get(row.id) ?? 0;
    const availableQty = roundTo2(Number(row.quantity) - reservedQty);
    if (!Number.isFinite(availableQty) || availableQty <= 0) continue;
    adjusted.push({
      ...row,
      quantity: availableQty,
    });
  }
  return adjusted;
}

async function fetchViablePharmacies(
  pharmacyId: number,
  firstOfMonth: string,
): Promise<ViablePharmacyRow[]> {
  return db.select({
    id: pharmacies.id,
    name: pharmacies.name,
    phone: pharmacies.phone,
    fax: pharmacies.fax,
    latitude: pharmacies.latitude,
    longitude: pharmacies.longitude,
  })
    .from(pharmacies)
    .where(and(
      ne(pharmacies.id, pharmacyId),
      eq(pharmacies.isActive, true),
      exists(
        db.select({ id: uploads.id })
          .from(uploads)
          .where(and(
            eq(uploads.pharmacyId, pharmacies.id),
            eq(uploads.uploadType, 'used_medication'),
            gte(uploads.createdAt, firstOfMonth),
          ))
      ),
      notExists(
        db.select({ id: pharmacyRelationships.id })
          .from(pharmacyRelationships)
          .where(or(
            and(
              eq(pharmacyRelationships.pharmacyId, pharmacyId),
              eq(pharmacyRelationships.targetPharmacyId, pharmacies.id),
              eq(pharmacyRelationships.relationshipType, 'blocked'),
            ),
            and(
              eq(pharmacyRelationships.pharmacyId, pharmacies.id),
              eq(pharmacyRelationships.targetPharmacyId, pharmacyId),
              eq(pharmacyRelationships.relationshipType, 'blocked'),
            ),
          ))
      ),
      exists(
        db.select({ id: deadStockItems.id })
          .from(deadStockItems)
          .where(and(
            eq(deadStockItems.pharmacyId, pharmacies.id),
            eq(deadStockItems.isAvailable, true),
          ))
      ),
      exists(
        db.select({ id: usedMedicationItems.id })
          .from(usedMedicationItems)
          .where(eq(usedMedicationItems.pharmacyId, pharmacies.id))
      ),
    ));
}

async function fetchReservationMap(
  allDeadStockIds: number[],
): Promise<Map<number, number>> {
  const reservationRows = allDeadStockIds.length > 0
    ? await db.select({
      deadStockItemId: deadStockReservations.deadStockItemId,
      reservedQty: sql<number>`coalesce(sum(${deadStockReservations.reservedQuantity}), 0)`,
    })
      .from(deadStockReservations)
      .innerJoin(exchangeProposals, eq(deadStockReservations.proposalId, exchangeProposals.id))
      .where(and(
        inArray(deadStockReservations.deadStockItemId, allDeadStockIds),
        inArray(exchangeProposals.status, RESERVATION_ACTIVE_STATUSES),
      ))
      .groupBy(deadStockReservations.deadStockItemId)
    : [];
  const reservedByItemId = new Map<number, number>();
  for (const row of reservationRows) {
    reservedByItemId.set(row.deadStockItemId, Number(row.reservedQty ?? 0));
  }
  return reservedByItemId;
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

function getFirstOfMonthIso(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function buildBlockedPairSet(rows: Array<{ pharmacyId: number; targetPharmacyId: number }>): Set<string> {
  const blockedPairs = new Set<string>();
  for (const row of rows) {
    blockedPairs.add(`${row.pharmacyId}:${row.targetPharmacyId}`);
  }
  return blockedPairs;
}

function isBlockedPair(blockedPairs: Set<string>, pharmacyAId: number, pharmacyBId: number): boolean {
  return blockedPairs.has(`${pharmacyAId}:${pharmacyBId}`) || blockedPairs.has(`${pharmacyBId}:${pharmacyAId}`);
}

function buildUsedMedIndexByPharmacy(
  rowsByPharmacy: Map<number, UsedMedRow[]>,
): Map<number, UsedMedIndex> {
  const indexByPharmacy = new Map<number, UsedMedIndex>();
  for (const [pharmacyId, rows] of rowsByPharmacy.entries()) {
    if (rows.length === 0) continue;
    indexByPharmacy.set(pharmacyId, buildUsedMedIndex(rows));
  }
  return indexByPharmacy;
}

function buildPreparedDeadStockByPharmacy(
  rowsByPharmacy: Map<number, DeadStockRow[]>,
): Map<number, PreparedStockRow[]> {
  const preparedByPharmacy = new Map<number, PreparedStockRow[]>();
  const preparedDrugNameCache = new Map<string, PreparedDrugName>();
  for (const [pharmacyId, rows] of rowsByPharmacy.entries()) {
    if (rows.length === 0) continue;
    const preparedRows: PreparedStockRow[] = rows.map((stock) => {
      const cached = preparedDrugNameCache.get(stock.drugName);
      if (cached) {
        return { stock, preparedDrugName: cached };
      }
      const preparedDrugName = prepareDrugName(stock.drugName);
      preparedDrugNameCache.set(stock.drugName, preparedDrugName);
      return { stock, preparedDrugName };
    });
    preparedByPharmacy.set(pharmacyId, preparedRows);
  }
  return preparedByPharmacy;
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

function buildPharmaciesWithDistance(
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

async function fetchBusinessHoursMaps(
  pharmacyIds: number[],
): Promise<{
  businessHoursByPharmacy: Map<number, BusinessHoursRows>;
  specialHoursByPharmacy: Map<number, SpecialHoursRows>;
}> {
  if (pharmacyIds.length === 0) {
    return {
      businessHoursByPharmacy: new Map(),
      specialHoursByPharmacy: new Map(),
    };
  }

  const [allBusinessHours, allSpecialHours] = await Promise.all([
    db.select({
      pharmacyId: pharmacyBusinessHours.pharmacyId,
      dayOfWeek: pharmacyBusinessHours.dayOfWeek,
      openTime: pharmacyBusinessHours.openTime,
      closeTime: pharmacyBusinessHours.closeTime,
      isClosed: pharmacyBusinessHours.isClosed,
      is24Hours: pharmacyBusinessHours.is24Hours,
    })
      .from(pharmacyBusinessHours)
      .where(inArray(pharmacyBusinessHours.pharmacyId, pharmacyIds)),
    db.select({
      pharmacyId: pharmacySpecialHours.pharmacyId,
      id: pharmacySpecialHours.id,
      specialType: pharmacySpecialHours.specialType,
      startDate: pharmacySpecialHours.startDate,
      endDate: pharmacySpecialHours.endDate,
      openTime: pharmacySpecialHours.openTime,
      closeTime: pharmacySpecialHours.closeTime,
      isClosed: pharmacySpecialHours.isClosed,
      is24Hours: pharmacySpecialHours.is24Hours,
      note: pharmacySpecialHours.note,
      updatedAt: pharmacySpecialHours.updatedAt,
    })
      .from(pharmacySpecialHours)
      .where(inArray(pharmacySpecialHours.pharmacyId, pharmacyIds)),
  ]);

  return {
    businessHoursByPharmacy: groupByPharmacy(allBusinessHours),
    specialHoursByPharmacy: groupByPharmacy(allSpecialHours),
  };
}

function collectCandidates(params: {
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

function buildMatchingIndexes(
  deadStockByPharmacy: Map<number, DeadStockRow[]>,
  usedMedsByPharmacy: Map<number, UsedMedRow[]>,
): {
  preparedDeadStockByPharmacy: Map<number, PreparedStockRow[]>;
  usedMedIndexByPharmacy: Map<number, UsedMedIndex>;
} {
  return {
    preparedDeadStockByPharmacy: buildPreparedDeadStockByPharmacy(deadStockByPharmacy),
    usedMedIndexByPharmacy: buildUsedMedIndexByPharmacy(usedMedsByPharmacy),
  };
}

function getSourcePreparedData(
  pharmacyId: number,
  preparedDeadStockByPharmacy: Map<number, PreparedStockRow[]>,
  usedMedIndexByPharmacy: Map<number, UsedMedIndex>,
): { myPreparedDeadStock: PreparedStockRow[]; myUsedMedIndex: UsedMedIndex } | null {
  const myPreparedDeadStock = preparedDeadStockByPharmacy.get(pharmacyId) ?? [];
  const myUsedMedIndex = usedMedIndexByPharmacy.get(pharmacyId);
  if (myPreparedDeadStock.length === 0 || !myUsedMedIndex) {
    return null;
  }
  return { myPreparedDeadStock, myUsedMedIndex };
}

function sortAndLimitCandidates(
  candidates: MatchCandidate[],
  matchingRuleProfile: MatchingRuleProfile,
  now: Date,
): MatchCandidate[] {
  return sortMatchCandidatesByPriority(candidates, matchingRuleProfile.nearExpiryDays, now)
    .slice(0, MAX_CANDIDATES);
}

export async function findMatchesBatch(pharmacyIds: number[]): Promise<Map<number, MatchCandidate[]>> {
  const sourcePharmacyIds = [...new Set(pharmacyIds)];
  const matchesByPharmacy = new Map<number, MatchCandidate[]>();
  if (sourcePharmacyIds.length === 0) return matchesByPharmacy;

  const now = new Date();
  const firstOfMonth = getFirstOfMonthIso(now);
  const matchingRuleProfile = await getActiveMatchingRuleProfile();

  const currentPharmacies = await db.select({
    id: pharmacies.id,
    name: pharmacies.name,
    latitude: pharmacies.latitude,
    longitude: pharmacies.longitude,
  })
    .from(pharmacies)
    .where(inArray(pharmacies.id, sourcePharmacyIds));
  const currentPharmacyById = new Map(currentPharmacies.map((pharmacy) => [pharmacy.id, pharmacy]));
  const existingSourcePharmacyIds: number[] = [];
  for (const pharmacyId of sourcePharmacyIds) {
    if (currentPharmacyById.has(pharmacyId)) {
      existingSourcePharmacyIds.push(pharmacyId);
    } else {
      matchesByPharmacy.set(pharmacyId, []);
    }
  }
  if (existingSourcePharmacyIds.length === 0) return matchesByPharmacy;

  const favoriteRows = await db.select({
    pharmacyId: pharmacyRelationships.pharmacyId,
    targetPharmacyId: pharmacyRelationships.targetPharmacyId,
  })
    .from(pharmacyRelationships)
    .where(and(
      inArray(pharmacyRelationships.pharmacyId, existingSourcePharmacyIds),
      eq(pharmacyRelationships.relationshipType, 'favorite'),
    ));

  const favoriteIdsByPharmacy = new Map<number, Set<number>>();
  for (const row of favoriteRows) {
    const favorites = favoriteIdsByPharmacy.get(row.pharmacyId) ?? new Set<number>();
    favorites.add(row.targetPharmacyId);
    favoriteIdsByPharmacy.set(row.pharmacyId, favorites);
  }

  const viablePharmacyPool = await db.select({
    id: pharmacies.id,
    name: pharmacies.name,
    phone: pharmacies.phone,
    fax: pharmacies.fax,
    latitude: pharmacies.latitude,
    longitude: pharmacies.longitude,
  })
    .from(pharmacies)
    .where(and(
      eq(pharmacies.isActive, true),
      exists(
        db.select({ id: uploads.id })
          .from(uploads)
          .where(and(
            eq(uploads.pharmacyId, pharmacies.id),
            eq(uploads.uploadType, 'used_medication'),
            gte(uploads.createdAt, firstOfMonth),
          )),
      ),
      exists(
        db.select({ id: deadStockItems.id })
          .from(deadStockItems)
          .where(and(
            eq(deadStockItems.pharmacyId, pharmacies.id),
            eq(deadStockItems.isAvailable, true),
          )),
      ),
      exists(
        db.select({ id: usedMedicationItems.id })
          .from(usedMedicationItems)
          .where(eq(usedMedicationItems.pharmacyId, pharmacies.id)),
      ),
    ));
  const viablePharmacyPoolIds = viablePharmacyPool.map((pharmacy) => pharmacy.id);

  const blockedRelationshipRows = existingSourcePharmacyIds.length > 0 && viablePharmacyPoolIds.length > 0
    ? await db.select({
      pharmacyId: pharmacyRelationships.pharmacyId,
      targetPharmacyId: pharmacyRelationships.targetPharmacyId,
    })
      .from(pharmacyRelationships)
      .where(and(
        eq(pharmacyRelationships.relationshipType, 'blocked'),
        or(
          and(
            inArray(pharmacyRelationships.pharmacyId, existingSourcePharmacyIds),
            inArray(pharmacyRelationships.targetPharmacyId, viablePharmacyPoolIds),
          ),
          and(
            inArray(pharmacyRelationships.pharmacyId, viablePharmacyPoolIds),
            inArray(pharmacyRelationships.targetPharmacyId, existingSourcePharmacyIds),
          ),
        ),
      ))
    : [];
  const blockedPairs = buildBlockedPairSet(blockedRelationshipRows);

  const allRelevantPharmacyIds = [...new Set([...existingSourcePharmacyIds, ...viablePharmacyPoolIds])];
  const [allDeadStockRows, allUsedMedRows] = await Promise.all([
    db.select(DEAD_STOCK_SELECT_FIELDS)
      .from(deadStockItems)
      .where(and(
        inArray(deadStockItems.pharmacyId, allRelevantPharmacyIds),
        eq(deadStockItems.isAvailable, true),
      ))
      .orderBy(deadStockItems.id),
    db.select(USED_MED_SELECT_FIELDS)
      .from(usedMedicationItems)
      .where(inArray(usedMedicationItems.pharmacyId, allRelevantPharmacyIds))
      .orderBy(usedMedicationItems.id),
  ]);

  const allDeadStockIds = [...new Set(allDeadStockRows.map((row) => row.id))];
  const reservedByItemId = await fetchReservationMap(allDeadStockIds);

  const adjustedAllDeadStock = applyReservationsToStockRows(allDeadStockRows, reservedByItemId);

  const { businessHoursByPharmacy, specialHoursByPharmacy } = await fetchBusinessHoursMaps(viablePharmacyPoolIds);

  const deadStockByPharmacy = groupByPharmacy<DeadStockRow>(adjustedAllDeadStock);
  const usedMedsByPharmacy = groupByPharmacy<UsedMedRow>(allUsedMedRows);
  const {
    preparedDeadStockByPharmacy,
    usedMedIndexByPharmacy,
  } = buildMatchingIndexes(deadStockByPharmacy, usedMedsByPharmacy);

  for (const sourcePharmacyId of existingSourcePharmacyIds) {
    const currentPharmacy = currentPharmacyById.get(sourcePharmacyId);
    if (!currentPharmacy) throw new Error('薬局が見つかりません');

    const sourcePreparedData = getSourcePreparedData(
      sourcePharmacyId,
      preparedDeadStockByPharmacy,
      usedMedIndexByPharmacy,
    );
    if (!sourcePreparedData) {
      matchesByPharmacy.set(sourcePharmacyId, []);
      continue;
    }

    const viablePharmacies = viablePharmacyPool.filter((pharmacy) => (
      pharmacy.id !== sourcePharmacyId &&
      !isBlockedPair(blockedPairs, sourcePharmacyId, pharmacy.id)
    ));

    if (viablePharmacies.length === 0) {
      matchesByPharmacy.set(sourcePharmacyId, []);
      continue;
    }

    const favoriteIds = favoriteIdsByPharmacy.get(sourcePharmacyId) ?? new Set<number>();

    const pharmaciesWithDistance = buildPharmaciesWithDistance(
      currentPharmacy,
      viablePharmacies,
      favoriteIds,
    );

    const candidates = collectCandidates({
      pharmaciesWithDistance,
      myPreparedDeadStock: sourcePreparedData.myPreparedDeadStock,
      myUsedMedIndex: sourcePreparedData.myUsedMedIndex,
      matchingRuleProfile,
      preparedDeadStockByPharmacy,
      usedMedIndexByPharmacy,
      businessHoursByPharmacy,
      specialHoursByPharmacy,
      favoriteIds,
      now,
      includeIsConfiguredInBusinessStatus: false,
    });

    matchesByPharmacy.set(sourcePharmacyId, sortAndLimitCandidates(candidates, matchingRuleProfile, now));
  }

  return matchesByPharmacy;
}

export async function findMatches(pharmacyId: number): Promise<MatchCandidate[]> {
  const [matchingRuleProfile, [currentPharmacy]] = await Promise.all([
    getActiveMatchingRuleProfile(),
    db.select({
      id: pharmacies.id,
      name: pharmacies.name,
      latitude: pharmacies.latitude,
      longitude: pharmacies.longitude,
    })
      .from(pharmacies)
      .where(eq(pharmacies.id, pharmacyId))
      .limit(1),
  ]);

  if (!currentPharmacy) throw new Error('薬局が見つかりません');

  const [myDeadStock, myUsedMeds] = await Promise.all([
    db.select(DEAD_STOCK_SELECT_FIELDS)
      .from(deadStockItems)
      .where(and(
        eq(deadStockItems.pharmacyId, pharmacyId),
        eq(deadStockItems.isAvailable, true),
      ))
      .orderBy(deadStockItems.id),
    db.select(USED_MED_SELECT_FIELDS)
      .from(usedMedicationItems)
      .where(eq(usedMedicationItems.pharmacyId, pharmacyId))
      .orderBy(usedMedicationItems.id),
  ]);

  if (myDeadStock.length === 0 || myUsedMeds.length === 0) {
    return [];
  }

  const now = new Date();
  const firstOfMonth = getFirstOfMonthIso(now);
  const [favoriteRows, viablePharmacies] = await Promise.all([
    db.select({
      targetPharmacyId: pharmacyRelationships.targetPharmacyId,
    })
      .from(pharmacyRelationships)
      .where(and(
        eq(pharmacyRelationships.pharmacyId, pharmacyId),
        eq(pharmacyRelationships.relationshipType, 'favorite'),
      )),
    fetchViablePharmacies(pharmacyId, firstOfMonth),
  ]);
  const favoriteIds = new Set(favoriteRows.map((row) => row.targetPharmacyId));

  if (viablePharmacies.length === 0) return [];
  const viablePharmacyIds = viablePharmacies.map((pharmacy) => pharmacy.id);

  const [allOtherDeadStock, allOtherUsedMeds] = await Promise.all([
    db.select(DEAD_STOCK_SELECT_FIELDS)
      .from(deadStockItems)
      .where(and(
        inArray(deadStockItems.pharmacyId, viablePharmacyIds),
        eq(deadStockItems.isAvailable, true),
      ))
      .orderBy(deadStockItems.id),
    db.select(USED_MED_SELECT_FIELDS)
      .from(usedMedicationItems)
      .where(inArray(usedMedicationItems.pharmacyId, viablePharmacyIds))
      .orderBy(usedMedicationItems.id),
  ]);

  const allDeadStockIds = [...new Set([...myDeadStock, ...allOtherDeadStock].map((row) => row.id))];
  const [reservedByItemId, { businessHoursByPharmacy, specialHoursByPharmacy }] = await Promise.all([
    fetchReservationMap(allDeadStockIds),
    fetchBusinessHoursMaps(viablePharmacyIds),
  ]);
  const adjustedMyDeadStock = applyReservationsToStockRows(myDeadStock, reservedByItemId);
  if (adjustedMyDeadStock.length === 0) {
    return [];
  }
  const adjustedOtherDeadStock = applyReservationsToStockRows(allOtherDeadStock, reservedByItemId);
  const deadStockByPharmacy = groupByPharmacy<DeadStockRow>(adjustedOtherDeadStock);
  const usedMedsByPharmacy = groupByPharmacy<UsedMedRow>(allOtherUsedMeds);
  const allDeadStockByPharmacy = new Map(deadStockByPharmacy);
  allDeadStockByPharmacy.set(pharmacyId, adjustedMyDeadStock);
  const allUsedMedsByPharmacy = new Map(usedMedsByPharmacy);
  allUsedMedsByPharmacy.set(pharmacyId, myUsedMeds);
  const {
    preparedDeadStockByPharmacy,
    usedMedIndexByPharmacy,
  } = buildMatchingIndexes(allDeadStockByPharmacy, allUsedMedsByPharmacy);
  const sourcePreparedData = getSourcePreparedData(
    pharmacyId,
    preparedDeadStockByPharmacy,
    usedMedIndexByPharmacy,
  );
  if (!sourcePreparedData) {
    return [];
  }

  const pharmaciesWithDistance = buildPharmaciesWithDistance(
    currentPharmacy,
    viablePharmacies,
    favoriteIds,
  );

  const candidates = collectCandidates({
    pharmaciesWithDistance,
    myPreparedDeadStock: sourcePreparedData.myPreparedDeadStock,
    myUsedMedIndex: sourcePreparedData.myUsedMedIndex,
    matchingRuleProfile,
    preparedDeadStockByPharmacy,
    usedMedIndexByPharmacy,
    businessHoursByPharmacy,
    specialHoursByPharmacy,
    favoriteIds,
    now,
    includeIsConfiguredInBusinessStatus: true,
  });

  return sortAndLimitCandidates(candidates, matchingRuleProfile, now);
}
