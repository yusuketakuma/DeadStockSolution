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
  NAME_MATCH_THRESHOLD,
  roundTo2,
  prepareDrugName,
  buildUsedMedIndex,
  findBestDrugMatch,
  calculateCandidateScore,
  calculateMatchRate,
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

interface DeadStockRow {
  id: number;
  pharmacyId: number;
  drugName: string;
  quantity: number;
  unit: string | null;
  yakkaUnitPrice: number | string | null;
  expirationDate: string | null;
}

const RESERVATION_ACTIVE_STATUSES = ['proposed', 'accepted_a', 'accepted_b', 'confirmed'] as const;

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
): Promise<Array<{ id: number; name: string; phone: string; fax: string; latitude: number | null; longitude: number | null }>> {
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
  preparedStocks: Array<{ stock: DeadStockRow; preparedDrugName: PreparedDrugName }>,
  usedMedIndex: ReturnType<typeof buildUsedMedIndex>,
  matchCache: Map<string, DrugMatchResult>,
): MatchItem[] {
  const items: MatchItem[] = [];
  for (const { stock, preparedDrugName } of preparedStocks) {
    const price = Number(stock.yakkaUnitPrice);
    if (!price || price <= 0) continue;
    const match = findBestDrugMatch(preparedDrugName, usedMedIndex, matchCache);
    if (match.score < NAME_MATCH_THRESHOLD) continue;
    items.push({
      deadStockItemId: stock.id,
      drugName: stock.drugName,
      quantity: stock.quantity,
      unit: stock.unit,
      yakkaUnitPrice: price,
      yakkaValue: roundTo2(price * stock.quantity),
      expirationDate: stock.expirationDate,
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

export async function findMatchesBatch(pharmacyIds: number[]): Promise<Map<number, MatchCandidate[]>> {
  const sourcePharmacyIds = [...new Set(pharmacyIds)];
  const matchesByPharmacy = new Map<number, MatchCandidate[]>();
  if (sourcePharmacyIds.length === 0) return matchesByPharmacy;

  const now = new Date();
  const firstOfMonth = getFirstOfMonthIso(now);

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
    db.select({
      id: deadStockItems.id,
      pharmacyId: deadStockItems.pharmacyId,
      drugName: deadStockItems.drugName,
      quantity: deadStockItems.quantity,
      unit: deadStockItems.unit,
      yakkaUnitPrice: deadStockItems.yakkaUnitPrice,
      expirationDate: deadStockItems.expirationDate,
    })
      .from(deadStockItems)
      .where(and(
        inArray(deadStockItems.pharmacyId, allRelevantPharmacyIds),
        eq(deadStockItems.isAvailable, true),
      ))
      .orderBy(deadStockItems.id),
    db.select({
      pharmacyId: usedMedicationItems.pharmacyId,
      drugName: usedMedicationItems.drugName,
    })
      .from(usedMedicationItems)
      .where(inArray(usedMedicationItems.pharmacyId, allRelevantPharmacyIds))
      .orderBy(usedMedicationItems.id),
  ]);

  const allDeadStockIds = [...new Set(allDeadStockRows.map((row) => row.id))];
  const reservedByItemId = await fetchReservationMap(allDeadStockIds);

  const adjustedAllDeadStock = applyReservationsToStockRows(allDeadStockRows, reservedByItemId);

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
      .where(inArray(pharmacyBusinessHours.pharmacyId, viablePharmacyPoolIds)),
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
      .where(inArray(pharmacySpecialHours.pharmacyId, viablePharmacyPoolIds)),
  ]);

  const businessHoursByPharmacy = groupByPharmacy(allBusinessHours);
  const specialHoursByPharmacy = groupByPharmacy(allSpecialHours);

  const deadStockByPharmacy = groupByPharmacy<DeadStockRow>(adjustedAllDeadStock);
  const usedMedsByPharmacy = groupByPharmacy<UsedMedRow>(allUsedMedRows);

  for (const sourcePharmacyId of existingSourcePharmacyIds) {
    const currentPharmacy = currentPharmacyById.get(sourcePharmacyId);
    if (!currentPharmacy) throw new Error('薬局が見つかりません');

    const myDeadStock = deadStockByPharmacy.get(sourcePharmacyId) ?? [];
    const myUsedMeds = usedMedsByPharmacy.get(sourcePharmacyId) ?? [];
    if (myDeadStock.length === 0 || myUsedMeds.length === 0) {
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

    const myUsedMedIndex = buildUsedMedIndex(myUsedMeds);
    const favoriteIds = favoriteIdsByPharmacy.get(sourcePharmacyId) ?? new Set<number>();
    const preparedDrugNameCache = new Map<string, PreparedDrugName>();
    const preparedMyDeadStock = myDeadStock.map((stock) => {
      const cached = preparedDrugNameCache.get(stock.drugName);
      if (cached) return { stock, preparedDrugName: cached };
      const preparedDrugName = prepareDrugName(stock.drugName);
      preparedDrugNameCache.set(stock.drugName, preparedDrugName);
      return { stock, preparedDrugName };
    });

    const pharmaciesWithDistance = viablePharmacies
      .map((pharmacy) => ({
        ...pharmacy,
        distance: (
          currentPharmacy.latitude !== null &&
          currentPharmacy.longitude !== null &&
          pharmacy.latitude !== null &&
          pharmacy.longitude !== null
        )
          ? haversineDistance(currentPharmacy.latitude, currentPharmacy.longitude, pharmacy.latitude, pharmacy.longitude)
          : 9999,
      }))
      .sort((a, b) => a.distance - b.distance || a.id - b.id);

    const candidates: MatchCandidate[] = [];

    for (const otherPharmacy of pharmaciesWithDistance) {
      const theirDeadStock = deadStockByPharmacy.get(otherPharmacy.id) ?? [];
      const theirUsedMeds = usedMedsByPharmacy.get(otherPharmacy.id) ?? [];
      if (theirDeadStock.length === 0 || theirUsedMeds.length === 0) continue;

      const theirUsedMedIndex = buildUsedMedIndex(theirUsedMeds);
      const myToTheirCache = new Map<string, DrugMatchResult>();
      const theirToMyCache = new Map<string, DrugMatchResult>();

      const itemsFromA = buildMatchItems(preparedMyDeadStock, theirUsedMedIndex, myToTheirCache);

      const preparedTheirDeadStock = theirDeadStock.map((stock) => {
        const cached = preparedDrugNameCache.get(stock.drugName);
        if (cached) return { stock, preparedDrugName: cached };
        const preparedDrugName = prepareDrugName(stock.drugName);
        preparedDrugNameCache.set(stock.drugName, preparedDrugName);
        return { stock, preparedDrugName };
      });
      const itemsFromB = buildMatchItems(preparedTheirDeadStock, myUsedMedIndex, theirToMyCache);

      if (itemsFromA.length === 0 || itemsFromB.length === 0) continue;

      const { balancedA, balancedB, totalA, totalB } = balanceValues(itemsFromA, itemsFromB);
      if (balancedA.length === 0 || balancedB.length === 0) continue;

      const minValue = Math.min(totalA, totalB);
      if (minValue < MIN_EXCHANGE_VALUE) continue;

      const diff = roundTo2(Math.abs(totalA - totalB));
      if (diff > VALUE_TOLERANCE) continue;

      const isFavorite = favoriteIds.has(otherPharmacy.id);
      const score = calculateCandidateScore(totalA, totalB, diff, otherPharmacy.distance, balancedA, balancedB, isFavorite);
      const matchRate = calculateMatchRate(balancedA, balancedB);

      const pharmacyHours = businessHoursByPharmacy.get(otherPharmacy.id) ?? [];
      const pharmacySpecialHours = specialHoursByPharmacy.get(otherPharmacy.id) ?? [];
      const businessStatus = getBusinessHoursStatus(pharmacyHours, pharmacySpecialHours, now);

      candidates.push({
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
      });
    }

    matchesByPharmacy.set(
      sourcePharmacyId,
      candidates
        .sort((a, b) => (
          (b.score ?? 0) - (a.score ?? 0) ||
          a.distance - b.distance ||
          a.pharmacyId - b.pharmacyId
        ))
        .slice(0, MAX_CANDIDATES),
    );
  }

  return matchesByPharmacy;
}

export async function findMatches(pharmacyId: number): Promise<MatchCandidate[]> {
  const [currentPharmacy] = await db.select({
    id: pharmacies.id,
    name: pharmacies.name,
    latitude: pharmacies.latitude,
    longitude: pharmacies.longitude,
  })
    .from(pharmacies)
    .where(eq(pharmacies.id, pharmacyId))
    .limit(1);

  if (!currentPharmacy) throw new Error('薬局が見つかりません');

  const [myDeadStock, myUsedMeds] = await Promise.all([
    db.select({
      id: deadStockItems.id,
      pharmacyId: deadStockItems.pharmacyId,
      drugName: deadStockItems.drugName,
      quantity: deadStockItems.quantity,
      unit: deadStockItems.unit,
      yakkaUnitPrice: deadStockItems.yakkaUnitPrice,
      expirationDate: deadStockItems.expirationDate,
    })
      .from(deadStockItems)
      .where(and(
        eq(deadStockItems.pharmacyId, pharmacyId),
        eq(deadStockItems.isAvailable, true),
      ))
      .orderBy(deadStockItems.id),
    db.select({
      pharmacyId: usedMedicationItems.pharmacyId,
      drugName: usedMedicationItems.drugName,
    })
      .from(usedMedicationItems)
      .where(eq(usedMedicationItems.pharmacyId, pharmacyId))
      .orderBy(usedMedicationItems.id),
  ]);

  if (myDeadStock.length === 0 || myUsedMeds.length === 0) {
    return [];
  }

  const now = new Date();
  const firstOfMonth = getFirstOfMonthIso(now);
  const favoriteRows = await db.select({
    targetPharmacyId: pharmacyRelationships.targetPharmacyId,
  })
    .from(pharmacyRelationships)
    .where(and(
      eq(pharmacyRelationships.pharmacyId, pharmacyId),
      eq(pharmacyRelationships.relationshipType, 'favorite'),
    ));
  const favoriteIds = new Set(favoriteRows.map((row) => row.targetPharmacyId));

  const viablePharmacies = await fetchViablePharmacies(pharmacyId, firstOfMonth);

  if (viablePharmacies.length === 0) return [];
  const viablePharmacyIds = viablePharmacies.map((pharmacy) => pharmacy.id);

  const [allOtherDeadStock, allOtherUsedMeds] = await Promise.all([
    db.select({
      id: deadStockItems.id,
      pharmacyId: deadStockItems.pharmacyId,
      drugName: deadStockItems.drugName,
      quantity: deadStockItems.quantity,
      unit: deadStockItems.unit,
      yakkaUnitPrice: deadStockItems.yakkaUnitPrice,
      expirationDate: deadStockItems.expirationDate,
    })
      .from(deadStockItems)
      .where(and(
        inArray(deadStockItems.pharmacyId, viablePharmacyIds),
        eq(deadStockItems.isAvailable, true),
      ))
      .orderBy(deadStockItems.id),
    db.select({
      pharmacyId: usedMedicationItems.pharmacyId,
      drugName: usedMedicationItems.drugName,
    })
      .from(usedMedicationItems)
      .where(inArray(usedMedicationItems.pharmacyId, viablePharmacyIds))
      .orderBy(usedMedicationItems.id),
  ]);

  const allDeadStockIds = [...new Set([...myDeadStock, ...allOtherDeadStock].map((row) => row.id))];
  const reservedByItemId = await fetchReservationMap(allDeadStockIds);

  const adjustedMyDeadStock = applyReservationsToStockRows(myDeadStock, reservedByItemId);
  if (adjustedMyDeadStock.length === 0) {
    return [];
  }
  const adjustedOtherDeadStock = applyReservationsToStockRows(allOtherDeadStock, reservedByItemId);

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
      .where(inArray(pharmacyBusinessHours.pharmacyId, viablePharmacyIds)),
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
      .where(inArray(pharmacySpecialHours.pharmacyId, viablePharmacyIds)),
  ]);

  const businessHoursByPharmacy = groupByPharmacy(allBusinessHours);
  const specialHoursByPharmacy = groupByPharmacy(allSpecialHours);

  const deadStockByPharmacy = groupByPharmacy<DeadStockRow>(adjustedOtherDeadStock);
  const usedMedsByPharmacy = groupByPharmacy<UsedMedRow>(allOtherUsedMeds);
  const myUsedMedIndex = buildUsedMedIndex(myUsedMeds);
  const preparedDrugNameCache = new Map<string, PreparedDrugName>();
  const preparedMyDeadStock = adjustedMyDeadStock.map((stock) => {
    const cached = preparedDrugNameCache.get(stock.drugName);
    if (cached) return { stock, preparedDrugName: cached };
    const preparedDrugName = prepareDrugName(stock.drugName);
    preparedDrugNameCache.set(stock.drugName, preparedDrugName);
    return { stock, preparedDrugName };
  });

  const pharmaciesWithDistance = viablePharmacies
    .map((pharmacy) => ({
      ...pharmacy,
      distance: (
        currentPharmacy.latitude !== null &&
        currentPharmacy.longitude !== null &&
        pharmacy.latitude !== null &&
        pharmacy.longitude !== null
      )
        ? haversineDistance(currentPharmacy.latitude, currentPharmacy.longitude, pharmacy.latitude, pharmacy.longitude)
        : 9999,
    }))
    .sort((a, b) => a.distance - b.distance || a.id - b.id);

  const candidates: MatchCandidate[] = [];

  for (const otherPharmacy of pharmaciesWithDistance) {
    const theirDeadStock = deadStockByPharmacy.get(otherPharmacy.id) ?? [];
    const theirUsedMeds = usedMedsByPharmacy.get(otherPharmacy.id) ?? [];
    if (theirDeadStock.length === 0 || theirUsedMeds.length === 0) continue;

    const theirUsedMedIndex = buildUsedMedIndex(theirUsedMeds);
    const myToTheirCache = new Map<string, DrugMatchResult>();
    const theirToMyCache = new Map<string, DrugMatchResult>();

    const itemsFromA = buildMatchItems(preparedMyDeadStock, theirUsedMedIndex, myToTheirCache);

    const preparedTheirDeadStock = theirDeadStock.map((stock) => {
      const cached = preparedDrugNameCache.get(stock.drugName);
      if (cached) return { stock, preparedDrugName: cached };
      const preparedDrugName = prepareDrugName(stock.drugName);
      preparedDrugNameCache.set(stock.drugName, preparedDrugName);
      return { stock, preparedDrugName };
    });
    const itemsFromB = buildMatchItems(preparedTheirDeadStock, myUsedMedIndex, theirToMyCache);

    if (itemsFromA.length === 0 || itemsFromB.length === 0) continue;

    const { balancedA, balancedB, totalA, totalB } = balanceValues(itemsFromA, itemsFromB);
    if (balancedA.length === 0 || balancedB.length === 0) continue;

    const minValue = Math.min(totalA, totalB);
    if (minValue < MIN_EXCHANGE_VALUE) continue;

    const diff = roundTo2(Math.abs(totalA - totalB));
    if (diff > VALUE_TOLERANCE) continue;

    const isFavorite = favoriteIds.has(otherPharmacy.id);
    const score = calculateCandidateScore(totalA, totalB, diff, otherPharmacy.distance, balancedA, balancedB, isFavorite);
    const matchRate = calculateMatchRate(balancedA, balancedB);

    const pharmacyHours = businessHoursByPharmacy.get(otherPharmacy.id) ?? [];
    const pharmacySpecialHours = specialHoursByPharmacy.get(otherPharmacy.id) ?? [];
    const businessStatus = {
      ...getBusinessHoursStatus(pharmacyHours, pharmacySpecialHours, now),
      isConfigured: pharmacyHours.length > 0 || pharmacySpecialHours.length > 0,
    };

    candidates.push({
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
    });
  }

  return candidates
    .sort((a, b) => (
      (b.score ?? 0) - (a.score ?? 0) ||
      a.distance - b.distance ||
      a.pharmacyId - b.pharmacyId
    ))
    .slice(0, MAX_CANDIDATES);
}
