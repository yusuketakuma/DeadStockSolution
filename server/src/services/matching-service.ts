import { and, eq, exists, gte, inArray, or, sql } from 'drizzle-orm';
import {
  deadStockItems,
  groupMembers,
  pharmacies,
  pharmacyRelationships,
  uploadJobs,
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
  fetchAvailableDeadStockByPharmacy,
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
import { getPharmacyPairSuccessCounts } from './success-rate-query-service';
import { getServiceDeps, type ServiceDependencies } from './service-container';

type PharmacyLocation = {
  id: number;
  name: string;
  latitude: number | null;
  longitude: number | null;
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
type BlockedPairSet = ReturnType<typeof buildBlockedPairSet>;
type BatchSourceContext = {
  favoriteIdsByPharmacy: Map<number, Set<number>>;
  groupMemberIdsByPharmacy: Map<number, Set<number>>;
};

type PreparedPharmacyLocationById = {
  execute(params: { pharmacyId: number }): Promise<PharmacyLocation[]>;
};

let preparedPharmacyLocationById: PreparedPharmacyLocationById | null = null;

const PHARMACY_LOCATION_SELECT_FIELDS = {
  id: pharmacies.id,
  name: pharmacies.name,
  latitude: pharmacies.latitude,
  longitude: pharmacies.longitude,
} as const;

function bindParam<T>(name: string): T {
  const placeholderFn = (sql as typeof sql & { placeholder?: (placeholderName: string) => unknown }).placeholder;
  if (typeof placeholderFn === 'function') {
    return placeholderFn(name) as T;
  }
  return name as T;
}

function getPreparedPharmacyLocationById(deps: ServiceDependencies): PreparedPharmacyLocationById | null {
  const placeholderFn = (sql as (typeof sql | undefined) & { placeholder?: unknown })?.placeholder;
  if (process.env.NODE_ENV === 'test' || typeof placeholderFn !== 'function') {
    return null;
  }
  if (deps.db !== getServiceDeps().db) {
    return null;
  }
  if (preparedPharmacyLocationById) {
    return preparedPharmacyLocationById;
  }

  const query = deps.db.select({
    ...PHARMACY_LOCATION_SELECT_FIELDS,
  })
    .from(pharmacies)
    .where(eq(pharmacies.id, bindParam<number>('pharmacyId')))
    .limit(1);

  if (typeof (query as { prepare?: unknown }).prepare === 'function') {
    preparedPharmacyLocationById = (query as { prepare(name: string): PreparedPharmacyLocationById })
      .prepare('prepared_pharmacy_location_by_id');
  }

  return preparedPharmacyLocationById;
}

async function fetchPharmacyLocationById(
  pharmacyId: number,
  deps: ServiceDependencies = getServiceDeps(),
): Promise<PharmacyLocation[]> {
  const prepared = getPreparedPharmacyLocationById(deps);
  if (prepared) {
    return prepared.execute({ pharmacyId });
  }

  return deps.db.select({
    ...PHARMACY_LOCATION_SELECT_FIELDS,
  })
    .from(pharmacies)
    .where(eq(pharmacies.id, pharmacyId))
    .limit(1);
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)];
}

function groupToSet<T>(
  rows: T[],
  keyFn: (row: T) => number,
  valueFn: (row: T) => number,
): Map<number, Set<number>> {
  const grouped = new Map<number, Set<number>>();
  for (const row of rows) {
    const key = keyFn(row);
    const values = grouped.get(key) ?? new Set<number>();
    values.add(valueFn(row));
    grouped.set(key, values);
  }
  return grouped;
}

async function fetchActiveDeadStockRowsByPharmacyIds(
  pharmacyIds: number[],
  deps: ServiceDependencies,
): Promise<DeadStockRow[]> {
  if (pharmacyIds.length === 0) {
    return [];
  }

  return deps.db.select(DEAD_STOCK_SELECT_FIELDS)
    .from(deadStockItems)
    .where(and(
      inArray(deadStockItems.pharmacyId, pharmacyIds),
      eq(deadStockItems.isAvailable, true),
    ))
    .orderBy(deadStockItems.id);
}

async function fetchUsedMedRowsByPharmacyIds(
  pharmacyIds: number[],
  deps: ServiceDependencies,
): Promise<UsedMedRow[]> {
  if (pharmacyIds.length === 0) {
    return [];
  }

  return deps.db.select(USED_MED_SELECT_FIELDS)
    .from(usedMedicationItems)
    .where(inArray(usedMedicationItems.pharmacyId, pharmacyIds))
    .orderBy(usedMedicationItems.id);
}

function ensureMapKeysWithEmptySets(
  groupedMap: Map<number, Set<number>>,
  keys: number[],
): Map<number, Set<number>> {
  for (const key of keys) {
    if (!groupedMap.has(key)) {
      groupedMap.set(key, new Set<number>());
    }
  }
  return groupedMap;
}

async function fetchGroupMembershipRowsByPharmacyIds(
  pharmacyIds: number[],
  deps: ServiceDependencies,
): Promise<GroupMembershipRow[]> {
  if (pharmacyIds.length === 0) {
    return [];
  }

  const rows = await deps.db.select({
    pharmacyId: groupMembers.pharmacyId,
    groupId: groupMembers.groupId,
  })
    .from(groupMembers)
    .where(inArray(groupMembers.pharmacyId, pharmacyIds));

  return Array.isArray(rows) ? rows : [];
}

async function fetchGroupMemberRowsByGroupIds(
  groupIds: number[],
  deps: ServiceDependencies,
): Promise<GroupMemberRow[]> {
  if (groupIds.length === 0) {
    return [];
  }

  const rows = await deps.db.select({
    groupId: groupMembers.groupId,
    pharmacyId: groupMembers.pharmacyId,
  })
    .from(groupMembers)
    .where(inArray(groupMembers.groupId, groupIds));

  return Array.isArray(rows) ? rows : [];
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

async function fetchFavoriteIdsByPharmacy(
  sourcePharmacyIds: number[],
  deps: ServiceDependencies,
): Promise<Map<number, Set<number>>> {
  const favoriteRows = await deps.db.select({
    pharmacyId: pharmacyRelationships.pharmacyId,
    targetPharmacyId: pharmacyRelationships.targetPharmacyId,
  })
    .from(pharmacyRelationships)
    .where(and(
      inArray(pharmacyRelationships.pharmacyId, sourcePharmacyIds),
      eq(pharmacyRelationships.relationshipType, 'favorite'),
    ));

  return groupToSet(
    favoriteRows,
    (row) => row.pharmacyId,
    (row) => row.targetPharmacyId,
  );
}

async function fetchGroupMemberIdsByPharmacy(
  sourcePharmacyIds: number[],
  deps: ServiceDependencies,
): Promise<Map<number, Set<number>>> {
  if (sourcePharmacyIds.length === 0) {
    return new Map<number, Set<number>>();
  }

  const sourceGroupRows = await fetchGroupMembershipRowsByPharmacyIds(sourcePharmacyIds, deps);
  const sourceGroupIdsByPharmacy = groupToSet(
    sourceGroupRows,
    (row) => row.pharmacyId,
    (row) => row.groupId,
  );

  const allSourceGroupIds = uniqueNumbers(sourceGroupRows.map((row) => row.groupId));
  const allGroupMemberRows = await fetchGroupMemberRowsByGroupIds(allSourceGroupIds, deps);
  const memberIdsByGroup = groupToSet(
    allGroupMemberRows,
    (row) => row.groupId,
    (row) => row.pharmacyId,
  );

  const groupMemberRowsBySource: Array<{ pharmacyId: number; memberPharmacyId: number }> = [];
  for (const sourcePharmacyId of sourcePharmacyIds) {
    const sourceGroupIds = sourceGroupIdsByPharmacy.get(sourcePharmacyId);
    if (!sourceGroupIds) {
      continue;
    }

    for (const sourceGroupId of sourceGroupIds) {
      const memberPharmacyIds = memberIdsByGroup.get(sourceGroupId);
      if (!memberPharmacyIds) {
        continue;
      }
      for (const memberPharmacyId of memberPharmacyIds) {
        if (memberPharmacyId !== sourcePharmacyId) {
          groupMemberRowsBySource.push({ pharmacyId: sourcePharmacyId, memberPharmacyId });
        }
      }
    }
  }

  return ensureMapKeysWithEmptySets(
    groupToSet(
      groupMemberRowsBySource,
      (row) => row.pharmacyId,
      (row) => row.memberPharmacyId,
    ),
    sourcePharmacyIds,
  );
}

async function fetchBatchSourceContext(
  sourcePharmacyIds: number[],
  deps: ServiceDependencies = getServiceDeps(),
): Promise<BatchSourceContext> {
  const [favoriteIdsByPharmacy, groupMemberIdsByPharmacy] = await Promise.all([
    fetchFavoriteIdsByPharmacy(sourcePharmacyIds, deps),
    fetchGroupMemberIdsByPharmacy(sourcePharmacyIds, deps),
  ]);

  return {
    favoriteIdsByPharmacy,
    groupMemberIdsByPharmacy,
  };
}

async function fetchBlockedPairsForSources(
  sourcePharmacyIds: number[],
  viablePharmacyIds: number[],
  deps: ServiceDependencies = getServiceDeps(),
): Promise<BlockedPairSet> {
  if (sourcePharmacyIds.length === 0 || viablePharmacyIds.length === 0) {
    return buildBlockedPairSet([]);
  }

  const blockedRelationshipRows = await deps.db.select({
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
    ));

  return buildBlockedPairSet(blockedRelationshipRows);
}

async function buildBatchMatchingIndexes(
  allRelevantPharmacyIds: number[],
  viablePharmacyIds: number[],
  deps: ServiceDependencies = getServiceDeps(),
): Promise<MatchingIndexes & {
  businessHoursByPharmacy: Awaited<ReturnType<typeof fetchBusinessHoursMaps>>['businessHoursByPharmacy'];
  specialHoursByPharmacy: Awaited<ReturnType<typeof fetchBusinessHoursMaps>>['specialHoursByPharmacy'];
}> {
  const [allDeadStockRows, allUsedMedRows] = await Promise.all([
    fetchActiveDeadStockRowsByPharmacyIds(allRelevantPharmacyIds, deps),
    fetchUsedMedRowsByPharmacyIds(allRelevantPharmacyIds, deps),
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
  successCountByPharmacy: Map<number, number>;
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
    successCountByPharmacy: params.successCountByPharmacy,
  });

  return sortAndLimitCandidates(candidates, params.matchingRuleProfile, params.now);
}

async function fetchSingleGroupMemberIds(
  pharmacyId: number,
  deps: ServiceDependencies = getServiceDeps(),
): Promise<Set<number>> {
  const sourceGroupIdSubquery = deps.db.select({
    groupId: groupMembers.groupId,
  })
    .from(groupMembers)
    .where(eq(groupMembers.pharmacyId, pharmacyId));
  const groupMemberRowsRaw = await deps.db.select({
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
  deps: ServiceDependencies = getServiceDeps(),
): Promise<(MatchingIndexes & {
  businessHoursByPharmacy: Awaited<ReturnType<typeof fetchBusinessHoursMaps>>['businessHoursByPharmacy'];
  specialHoursByPharmacy: Awaited<ReturnType<typeof fetchBusinessHoursMaps>>['specialHoursByPharmacy'];
}) | null> {
  const [allOtherDeadStock, allOtherUsedMeds] = await Promise.all([
    fetchActiveDeadStockRowsByPharmacyIds(viablePharmacyIds, deps),
    fetchUsedMedRowsByPharmacyIds(viablePharmacyIds, deps),
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

export async function findMatchesBatch(
  pharmacyIds: number[],
  deps: ServiceDependencies = getServiceDeps(),
): Promise<Map<number, MatchCandidate[]>> {
  const sourcePharmacyIds = uniqueNumbers(pharmacyIds);
  const matchesByPharmacy = new Map<number, MatchCandidate[]>();
  if (sourcePharmacyIds.length === 0) return matchesByPharmacy;

  const now = new Date();
  const firstOfMonth = getFirstOfMonthIso(now);
  const [matchingRuleProfile, equivalenceMap] = await Promise.all([
    getActiveMatchingRuleProfile(),
    fetchEquivalenceMap(),
  ]);

  const currentPharmacies = await deps.db.select({
    ...PHARMACY_LOCATION_SELECT_FIELDS,
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

  const { favoriteIdsByPharmacy, groupMemberIdsByPharmacy } = await fetchBatchSourceContext(existingSourcePharmacyIds, deps);

  const viablePharmacyPool = await deps.db.select({
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
        deps.db.select({ id: uploadJobs.id })
          .from(uploadJobs)
          .where(and(
            eq(uploadJobs.pharmacyId, pharmacies.id),
            eq(uploadJobs.uploadType, 'used_medication'),
            gte(uploadJobs.createdAt, firstOfMonth),
          )),
      ),
      exists(
        deps.db.select({ id: deadStockItems.id })
          .from(deadStockItems)
          .where(and(
            eq(deadStockItems.pharmacyId, pharmacies.id),
            eq(deadStockItems.isAvailable, true),
          )),
      ),
      exists(
        deps.db.select({ id: usedMedicationItems.id })
          .from(usedMedicationItems)
          .where(eq(usedMedicationItems.pharmacyId, pharmacies.id)),
      ),
    ));

  const viablePharmacyPoolIds = viablePharmacyPool.map((pharmacy) => pharmacy.id);
  const blockedPairs = await fetchBlockedPairsForSources(existingSourcePharmacyIds, viablePharmacyPoolIds, deps);
  const {
    preparedDeadStockByPharmacy,
    usedMedIndexByPharmacy,
    businessHoursByPharmacy,
    specialHoursByPharmacy,
  } = await buildBatchMatchingIndexes(
    uniqueNumbers([...existingSourcePharmacyIds, ...viablePharmacyPoolIds]),
    viablePharmacyPoolIds,
    deps,
  );

  const successCountsByPharmacy = await Promise.all(
    existingSourcePharmacyIds.map(async (id) => [id, await getPharmacyPairSuccessCounts(id, deps)] as const),
  );
  const successCountsByPharmacyMap = new Map(successCountsByPharmacy);

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
      successCountByPharmacy: successCountsByPharmacyMap.get(sourcePharmacyId) ?? new Map<number, number>(),
    }));
  }

  return matchesByPharmacy;
}

export async function findMatches(
  pharmacyId: number,
  options: { groupOnly?: boolean } = {},
  deps: ServiceDependencies = getServiceDeps(),
): Promise<MatchCandidate[]> {
  const [matchingRuleProfile, [currentPharmacy], equivalenceMap] = await Promise.all([
    getActiveMatchingRuleProfile(),
    fetchPharmacyLocationById(pharmacyId, deps),
    fetchEquivalenceMap(),
  ]);

  if (!currentPharmacy) throw new Error('薬局が見つかりません');

  const [myDeadStock, myUsedMeds] = await Promise.all([
    fetchAvailableDeadStockByPharmacy(pharmacyId),
    fetchUsedMedRowsByPharmacyIds([pharmacyId], deps),
  ]);

  if (myDeadStock.length === 0 || myUsedMeds.length === 0) {
    return [];
  }

  const now = new Date();
  const firstOfMonth = getFirstOfMonthIso(now);
  const [favoriteRows, viablePharmacies, groupMemberIds] = await Promise.all([
    deps.db.select({
      targetPharmacyId: pharmacyRelationships.targetPharmacyId,
    })
      .from(pharmacyRelationships)
      .where(and(
        eq(pharmacyRelationships.pharmacyId, pharmacyId),
        eq(pharmacyRelationships.relationshipType, 'favorite'),
      )),
    fetchViablePharmacies(pharmacyId, firstOfMonth),
    fetchSingleGroupMemberIds(pharmacyId, deps),
  ]);

  if (viablePharmacies.length === 0) return [];

  let filteredViablePharmacies = viablePharmacies;
  if (options.groupOnly) {
    filteredViablePharmacies = viablePharmacies.filter((p) => groupMemberIds.has(p.id));
    if (filteredViablePharmacies.length === 0) return [];
  }

  const favoriteIds = new Set(favoriteRows.map((row) => row.targetPharmacyId));
  const [matchingIndexes, successCountByPharmacy] = await Promise.all([
    buildSingleMatchingIndexes(
      pharmacyId,
      filteredViablePharmacies.map((pharmacy) => pharmacy.id),
      myDeadStock,
      myUsedMeds,
      deps,
    ),
    getPharmacyPairSuccessCounts(pharmacyId, deps),
  ]);
  if (!matchingIndexes) {
    return [];
  }

  return buildCandidatesForSource({
    currentPharmacy,
    sourcePharmacyId: pharmacyId,
    viablePharmacies: filteredViablePharmacies,
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
    successCountByPharmacy,
  });
}

export function createMatchingService(
  deps: ServiceDependencies = getServiceDeps(),
): {
  findMatchesBatch: (pharmacyIds: number[]) => Promise<Map<number, MatchCandidate[]>>;
  findMatches: (pharmacyId: number) => Promise<MatchCandidate[]>;
} {
  return {
    findMatchesBatch: (pharmacyIds: number[]) => findMatchesBatch(pharmacyIds, deps),
    findMatches: (pharmacyId: number) => findMatches(pharmacyId, {}, deps),
  };
}
