import { and, eq, exists, gte, inArray, or } from 'drizzle-orm';
import { db } from '../config/database';
import {
  deadStockItems,
  pharmacies,
  pharmacyRelationships,
  uploads,
  usedMedicationItems,
} from '../db/schema';
import { MatchCandidate } from '../types';
import { groupByPharmacy } from './matching-filter-service';
import { getActiveMatchingRuleProfile } from './matching-rule-service';
import { UsedMedRow } from './matching-score-service';
import {
  buildPharmaciesWithDistance,
  collectCandidates,
} from './matching/matching-candidate-builder';
import {
  DeadStockRow,
  DEAD_STOCK_SELECT_FIELDS,
  fetchBusinessHoursMaps,
  fetchReservationMap,
  fetchViablePharmacies,
  USED_MED_SELECT_FIELDS,
} from './matching/matching-data-fetcher';
import {
  applyReservationsToStockRows,
  buildBlockedPairSet,
  buildMatchingIndexes,
  getFirstOfMonthIso,
  getSourcePreparedData,
  isBlockedPair,
} from './matching/matching-data-preparer';
import { sortAndLimitCandidates } from './matching/matching-ranker';

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
