import { and, eq, exists, gte, inArray, or } from 'drizzle-orm';
import { db } from '../config/database';
import {
  deadStockItems,
  groupMembers,
  pharmacies,
  pharmacyRelationships,
  uploads,
  usedMedicationItems,
} from '../db/schema';
import { MatchCandidate } from '../types';
import type { DeadStockRow, MatchingRuleProfile, UsedMedRow, ViablePharmacyRow } from '../types/matching';
import { groupByPharmacy } from './matching-filter-service';
import { getActiveMatchingRuleProfile } from './matching-rule-service';
import {
  buildPharmaciesWithDistance,
  collectCandidates,
} from './matching/matching-candidate-builder';
import {
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
import { fetchEquivalenceMap } from './drug-equivalence-service';

type PharmacyLocation = {
  id: number;
  name: string;
  latitude: number | null;
  longitude: number | null;
};

type FavoriteRow = {
  pharmacyId: number;
  targetPharmacyId: number;
};

type GroupMembershipRow = {
  pharmacyId: number;
  groupId: number;
};

type GroupMemberRow = {
  groupId: number;
  pharmacyId: number;
};

type MatchingIndexes = ReturnType<typeof buildMatchingIndexes>;

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)];
}

function buildCurrentPharmacyById(currentPharmacies: PharmacyLocation[]): Map<number, PharmacyLocation> {
  return new Map(currentPharmacies.map((pharmacy) => [pharmacy.id, pharmacy]));
}

function resolveExistingSourcePharmacyIds(
  sourcePharmacyIds: number[],
  currentPharmacyById: Map<number, PharmacyLocation>,
  matchesByPharmacy: Map<number, MatchCandidate[]>,
): number[] {
  const existingSourcePharmacyIds: number[] = [];
  for (const pharmacyId of sourcePharmacyIds) {
    if (currentPharmacyById.has(pharmacyId)) {
      existingSourcePharmacyIds.push(pharmacyId);
    } else {
      matchesByPharmacy.set(pharmacyId, []);
    }
  }
  return existingSourcePharmacyIds;
}

function buildFavoriteIdsByPharmacy(favoriteRows: FavoriteRow[]): Map<number, Set<number>> {
  const favoriteIdsByPharmacy = new Map<number, Set<number>>();
  for (const row of favoriteRows) {
    const favorites = favoriteIdsByPharmacy.get(row.pharmacyId) ?? new Set<number>();
    favorites.add(row.targetPharmacyId);
    favoriteIdsByPharmacy.set(row.pharmacyId, favorites);
  }
  return favoriteIdsByPharmacy;
}

function buildGroupIdsByPharmacy(sourceGroupRows: GroupMembershipRow[]): Map<number, Set<number>> {
  const sourceGroupIdsByPharmacy = new Map<number, Set<number>>();
  for (const row of sourceGroupRows) {
    const groupIds = sourceGroupIdsByPharmacy.get(row.pharmacyId) ?? new Set<number>();
    groupIds.add(row.groupId);
    sourceGroupIdsByPharmacy.set(row.pharmacyId, groupIds);
  }
  return sourceGroupIdsByPharmacy;
}

function buildMemberIdsByGroup(rows: GroupMemberRow[]): Map<number, Set<number>> {
  const memberIdsByGroup = new Map<number, Set<number>>();
  for (const row of rows) {
    const memberIds = memberIdsByGroup.get(row.groupId) ?? new Set<number>();
    memberIds.add(row.pharmacyId);
    memberIdsByGroup.set(row.groupId, memberIds);
  }
  return memberIdsByGroup;
}

function buildGroupMemberIdsByPharmacy(
  sourcePharmacyIds: number[],
  sourceGroupIdsByPharmacy: Map<number, Set<number>>,
  memberIdsByGroup: Map<number, Set<number>>,
): Map<number, Set<number>> {
  const groupMemberIdsByPharmacy = new Map<number, Set<number>>();

  for (const sourcePharmacyId of sourcePharmacyIds) {
    const groupMemberIds = new Set<number>();
    const groupIds = sourceGroupIdsByPharmacy.get(sourcePharmacyId) ?? new Set<number>();
    for (const groupId of groupIds) {
      const memberIds = memberIdsByGroup.get(groupId);
      if (!memberIds) continue;
      for (const memberPharmacyId of memberIds) {
        if (memberPharmacyId !== sourcePharmacyId) {
          groupMemberIds.add(memberPharmacyId);
        }
      }
    }
    groupMemberIdsByPharmacy.set(sourcePharmacyId, groupMemberIds);
  }

  return groupMemberIdsByPharmacy;
}

async function fetchFavoriteIdsByPharmacy(sourcePharmacyIds: number[]): Promise<Map<number, Set<number>>> {
  const favoriteRows = await db.select({
    pharmacyId: pharmacyRelationships.pharmacyId,
    targetPharmacyId: pharmacyRelationships.targetPharmacyId,
  })
    .from(pharmacyRelationships)
    .where(and(
      inArray(pharmacyRelationships.pharmacyId, sourcePharmacyIds),
      eq(pharmacyRelationships.relationshipType, 'favorite'),
    ));

  return buildFavoriteIdsByPharmacy(favoriteRows);
}

async function fetchGroupMemberIdsByPharmacy(sourcePharmacyIds: number[]): Promise<Map<number, Set<number>>> {
  const sourceGroupRowsRaw = await db.select({
    pharmacyId: groupMembers.pharmacyId,
    groupId: groupMembers.groupId,
  })
    .from(groupMembers)
    .where(inArray(groupMembers.pharmacyId, sourcePharmacyIds));
  const sourceGroupRows = Array.isArray(sourceGroupRowsRaw) ? sourceGroupRowsRaw : [];
  const sourceGroupIdsByPharmacy = buildGroupIdsByPharmacy(sourceGroupRows);

  const allSourceGroupIds = uniqueNumbers(sourceGroupRows.map((row) => row.groupId));
  const allGroupMemberRowsRaw = allSourceGroupIds.length > 0
    ? await db.select({
      groupId: groupMembers.groupId,
      pharmacyId: groupMembers.pharmacyId,
    })
      .from(groupMembers)
      .where(inArray(groupMembers.groupId, allSourceGroupIds))
    : [];
  const allGroupMemberRows = Array.isArray(allGroupMemberRowsRaw) ? allGroupMemberRowsRaw : [];

  return buildGroupMemberIdsByPharmacy(
    sourcePharmacyIds,
    sourceGroupIdsByPharmacy,
    buildMemberIdsByGroup(allGroupMemberRows),
  );
}

async function fetchBatchSourceContext(sourcePharmacyIds: number[]) {
  const [favoriteIdsByPharmacy, groupMemberIdsByPharmacy] = await Promise.all([
    fetchFavoriteIdsByPharmacy(sourcePharmacyIds),
    fetchGroupMemberIdsByPharmacy(sourcePharmacyIds),
  ]);

  return {
    favoriteIdsByPharmacy,
    groupMemberIdsByPharmacy,
  };
}

async function fetchBlockedPairsForSources(
  sourcePharmacyIds: number[],
  viablePharmacyIds: number[],
) {
  const blockedRelationshipRows = sourcePharmacyIds.length > 0 && viablePharmacyIds.length > 0
    ? await db.select({
      pharmacyId: pharmacyRelationships.pharmacyId,
      targetPharmacyId: pharmacyRelationships.targetPharmacyId,
    })
      .from(pharmacyRelationships)
      .where(and(
        eq(pharmacyRelationships.relationshipType, 'blocked'),
        or(
          and(
            inArray(pharmacyRelationships.pharmacyId, sourcePharmacyIds),
            inArray(pharmacyRelationships.targetPharmacyId, viablePharmacyIds),
          ),
          and(
            inArray(pharmacyRelationships.pharmacyId, viablePharmacyIds),
            inArray(pharmacyRelationships.targetPharmacyId, sourcePharmacyIds),
          ),
        ),
      ))
    : [];

  return buildBlockedPairSet(blockedRelationshipRows);
}

async function buildBatchMatchingIndexes(
  allRelevantPharmacyIds: number[],
  viablePharmacyIds: number[],
): Promise<MatchingIndexes & {
  businessHoursByPharmacy: Awaited<ReturnType<typeof fetchBusinessHoursMaps>>['businessHoursByPharmacy'];
  specialHoursByPharmacy: Awaited<ReturnType<typeof fetchBusinessHoursMaps>>['specialHoursByPharmacy'];
}> {
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

  const allDeadStockIds = uniqueNumbers(allDeadStockRows.map((row) => row.id));
  const [reservedByItemId, { businessHoursByPharmacy, specialHoursByPharmacy }] = await Promise.all([
    fetchReservationMap(allDeadStockIds),
    fetchBusinessHoursMaps(viablePharmacyIds),
  ]);
  const adjustedAllDeadStock = applyReservationsToStockRows(allDeadStockRows, reservedByItemId);

  return {
    ...buildMatchingIndexes(
      groupByPharmacy<DeadStockRow>(adjustedAllDeadStock),
      groupByPharmacy<UsedMedRow>(allUsedMedRows),
    ),
    businessHoursByPharmacy,
    specialHoursByPharmacy,
  };
}

function buildCandidatesForSource(params: {
  currentPharmacy: PharmacyLocation;
  sourcePharmacyId: number;
  viablePharmacies: ViablePharmacyRow[];
  favoriteIds: Set<number>;
  groupMemberIds: Set<number>;
  preparedDeadStockByPharmacy: MatchingIndexes['preparedDeadStockByPharmacy'];
  usedMedIndexByPharmacy: MatchingIndexes['usedMedIndexByPharmacy'];
  businessHoursByPharmacy: Awaited<ReturnType<typeof fetchBusinessHoursMaps>>['businessHoursByPharmacy'];
  specialHoursByPharmacy: Awaited<ReturnType<typeof fetchBusinessHoursMaps>>['specialHoursByPharmacy'];
  matchingRuleProfile: MatchingRuleProfile;
  now: Date;
  includeIsConfiguredInBusinessStatus: boolean;
  equivalenceMap: Map<string, string[]>;
}): MatchCandidate[] {
  const sourcePreparedData = getSourcePreparedData(
    params.sourcePharmacyId,
    params.preparedDeadStockByPharmacy,
    params.usedMedIndexByPharmacy,
  );
  if (!sourcePreparedData || params.viablePharmacies.length === 0) {
    return [];
  }

  const pharmaciesWithDistance = buildPharmaciesWithDistance(
    params.currentPharmacy,
    params.viablePharmacies,
    params.favoriteIds,
  );

  const candidates = collectCandidates({
    pharmaciesWithDistance,
    myPreparedDeadStock: sourcePreparedData.myPreparedDeadStock,
    myUsedMedIndex: sourcePreparedData.myUsedMedIndex,
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
  });

  return sortAndLimitCandidates(candidates, params.matchingRuleProfile, params.now);
}

async function fetchSingleGroupMemberIds(pharmacyId: number): Promise<Set<number>> {
  const sourceGroupIdSubquery = db.select({
    groupId: groupMembers.groupId,
  })
    .from(groupMembers)
    .where(eq(groupMembers.pharmacyId, pharmacyId));
  const groupMemberRowsRaw = await db.select({
    pharmacyId: groupMembers.pharmacyId,
  })
    .from(groupMembers)
    .where(inArray(groupMembers.groupId, sourceGroupIdSubquery));
  const groupMemberRows = Array.isArray(groupMemberRowsRaw) ? groupMemberRowsRaw : [];

  return new Set(
    groupMemberRows
      .map((row) => row.pharmacyId)
      .filter((memberPharmacyId) => memberPharmacyId !== pharmacyId),
  );
}

async function buildSingleMatchingIndexes(
  pharmacyId: number,
  viablePharmacyIds: number[],
  myDeadStock: DeadStockRow[],
  myUsedMeds: UsedMedRow[],
): Promise<(MatchingIndexes & {
  businessHoursByPharmacy: Awaited<ReturnType<typeof fetchBusinessHoursMaps>>['businessHoursByPharmacy'];
  specialHoursByPharmacy: Awaited<ReturnType<typeof fetchBusinessHoursMaps>>['specialHoursByPharmacy'];
}) | null> {
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

  const allDeadStockIds = uniqueNumbers([...myDeadStock, ...allOtherDeadStock].map((row) => row.id));
  const [reservedByItemId, { businessHoursByPharmacy, specialHoursByPharmacy }] = await Promise.all([
    fetchReservationMap(allDeadStockIds),
    fetchBusinessHoursMaps(viablePharmacyIds),
  ]);

  const adjustedMyDeadStock = applyReservationsToStockRows(myDeadStock, reservedByItemId);
  if (adjustedMyDeadStock.length === 0) {
    return null;
  }

  const adjustedOtherDeadStock = applyReservationsToStockRows(allOtherDeadStock, reservedByItemId);
  const allDeadStockByPharmacy = new Map(groupByPharmacy<DeadStockRow>(adjustedOtherDeadStock));
  allDeadStockByPharmacy.set(pharmacyId, adjustedMyDeadStock);

  const allUsedMedsByPharmacy = new Map(groupByPharmacy<UsedMedRow>(allOtherUsedMeds));
  allUsedMedsByPharmacy.set(pharmacyId, myUsedMeds);

  return {
    ...buildMatchingIndexes(allDeadStockByPharmacy, allUsedMedsByPharmacy),
    businessHoursByPharmacy,
    specialHoursByPharmacy,
  };
}

export async function findMatchesBatch(pharmacyIds: number[]): Promise<Map<number, MatchCandidate[]>> {
  const sourcePharmacyIds = uniqueNumbers(pharmacyIds);
  const matchesByPharmacy = new Map<number, MatchCandidate[]>();
  if (sourcePharmacyIds.length === 0) return matchesByPharmacy;

  const now = new Date();
  const firstOfMonth = getFirstOfMonthIso(now);
  const [matchingRuleProfile, equivalenceMap] = await Promise.all([
    getActiveMatchingRuleProfile(),
    fetchEquivalenceMap(),
  ]);

  const currentPharmacies = await db.select({
    id: pharmacies.id,
    name: pharmacies.name,
    latitude: pharmacies.latitude,
    longitude: pharmacies.longitude,
  })
    .from(pharmacies)
    .where(inArray(pharmacies.id, sourcePharmacyIds));

  const currentPharmacyById = buildCurrentPharmacyById(currentPharmacies);
  const existingSourcePharmacyIds = resolveExistingSourcePharmacyIds(
    sourcePharmacyIds,
    currentPharmacyById,
    matchesByPharmacy,
  );
  if (existingSourcePharmacyIds.length === 0) return matchesByPharmacy;

  const { favoriteIdsByPharmacy, groupMemberIdsByPharmacy } = await fetchBatchSourceContext(existingSourcePharmacyIds);

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
  const blockedPairs = await fetchBlockedPairsForSources(existingSourcePharmacyIds, viablePharmacyPoolIds);
  const {
    preparedDeadStockByPharmacy,
    usedMedIndexByPharmacy,
    businessHoursByPharmacy,
    specialHoursByPharmacy,
  } = await buildBatchMatchingIndexes(
    uniqueNumbers([...existingSourcePharmacyIds, ...viablePharmacyPoolIds]),
    viablePharmacyPoolIds,
  );

  for (const sourcePharmacyId of existingSourcePharmacyIds) {
    const currentPharmacy = currentPharmacyById.get(sourcePharmacyId);
    if (!currentPharmacy) throw new Error('薬局が見つかりません');

    const viablePharmacies = viablePharmacyPool.filter((pharmacy) => (
      pharmacy.id !== sourcePharmacyId &&
      !isBlockedPair(blockedPairs, sourcePharmacyId, pharmacy.id)
    ));

    matchesByPharmacy.set(sourcePharmacyId, buildCandidatesForSource({
      currentPharmacy,
      sourcePharmacyId,
      viablePharmacies,
      favoriteIds: favoriteIdsByPharmacy.get(sourcePharmacyId) ?? new Set<number>(),
      groupMemberIds: groupMemberIdsByPharmacy.get(sourcePharmacyId) ?? new Set<number>(),
      preparedDeadStockByPharmacy,
      usedMedIndexByPharmacy,
      businessHoursByPharmacy,
      specialHoursByPharmacy,
      matchingRuleProfile,
      now,
      includeIsConfiguredInBusinessStatus: false,
      equivalenceMap,
    }));
  }

  return matchesByPharmacy;
}

export async function findMatches(pharmacyId: number): Promise<MatchCandidate[]> {
  const [matchingRuleProfile, [currentPharmacy], equivalenceMap] = await Promise.all([
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
    fetchEquivalenceMap(),
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
  const [favoriteRows, viablePharmacies, groupMemberIds] = await Promise.all([
    db.select({
      targetPharmacyId: pharmacyRelationships.targetPharmacyId,
    })
      .from(pharmacyRelationships)
      .where(and(
        eq(pharmacyRelationships.pharmacyId, pharmacyId),
        eq(pharmacyRelationships.relationshipType, 'favorite'),
      )),
    fetchViablePharmacies(pharmacyId, firstOfMonth),
    fetchSingleGroupMemberIds(pharmacyId),
  ]);

  if (viablePharmacies.length === 0) return [];

  const favoriteIds = new Set(favoriteRows.map((row) => row.targetPharmacyId));
  const matchingIndexes = await buildSingleMatchingIndexes(
    pharmacyId,
    viablePharmacies.map((pharmacy) => pharmacy.id),
    myDeadStock,
    myUsedMeds,
  );
  if (!matchingIndexes) {
    return [];
  }

  return buildCandidatesForSource({
    currentPharmacy,
    sourcePharmacyId: pharmacyId,
    viablePharmacies,
    favoriteIds,
    groupMemberIds,
    preparedDeadStockByPharmacy: matchingIndexes.preparedDeadStockByPharmacy,
    usedMedIndexByPharmacy: matchingIndexes.usedMedIndexByPharmacy,
    businessHoursByPharmacy: matchingIndexes.businessHoursByPharmacy,
    specialHoursByPharmacy: matchingIndexes.specialHoursByPharmacy,
    matchingRuleProfile,
    now,
    includeIsConfiguredInBusinessStatus: true,
    equivalenceMap,
  });
}
