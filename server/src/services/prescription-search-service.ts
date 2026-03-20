import { db } from '../config/database';
import { drugMaster, drugEquivalences, deadStockItems, pharmacies, pharmacyRelationships, groupMembers } from '../db/schema';
import { eq, and, inArray, or, isNull, ne } from 'drizzle-orm';
import { haversineDistance } from '../utils/geo-utils';

// Types
interface DrugKey {
  drugMasterId: number;
  genericName: string | null;
  specification: string | null;
}

export interface DrugGroup {
  columnLabel: string;
  genericName: string | null;
  specification: string | null;
  drugMasterIds: number[];
}

// resolveDrugGroups: drugKeys から同一成分の全drugMasterIdを収集（バッチ化）
export async function resolveDrugGroups(drugKeys: DrugKey[]): Promise<DrugGroup[]> {
  if (drugKeys.length === 0) return [];

  // Batch: 全ソース drugMaster を一括取得
  const allSourceIds = drugKeys.map(k => k.drugMasterId);
  const sourceRows = await db.select().from(drugMaster).where(inArray(drugMaster.id, allSourceIds));
  const sourceMap = new Map(sourceRows.map(r => [r.id, r]));

  // Batch: 全ソースの drugName で drugEquivalences を一括取得
  const sourceNames = sourceRows.map(r => r.drugName);
  const allEquivRows = sourceNames.length > 0
    ? await db.select().from(drugEquivalences).where(
        or(
          inArray(drugEquivalences.drugNameA, sourceNames),
          inArray(drugEquivalences.drugNameB, sourceNames),
        )
      )
    : [];

  const groups: DrugGroup[] = [];

  for (const key of drugKeys) {
    const source = sourceMap.get(key.drugMasterId);
    if (!source) continue;

    const gn = key.genericName ?? source.genericName;
    const spec = key.specification ?? source.specification;
    let matchedIds: number[] = [source.id];

    // Pass 1: genericName + specification 完全一致
    if (gn) {
      const matches = await db.select({ id: drugMaster.id }).from(drugMaster).where(
        and(
          eq(drugMaster.genericName, gn),
          spec != null ? eq(drugMaster.specification, spec) : isNull(drugMaster.specification),
        )
      );
      matchedIds = [...new Set([...matchedIds, ...matches.map((m: { id: number }) => m.id)])];
    }

    // Pass 2: drugEquivalences テキストマッチ (genericName NULL or 少数マッチ時)
    if (!gn || matchedIds.length <= 1) {
      const relevantEquivs = allEquivRows.filter(
        r => r.drugNameA === source.drugName || r.drugNameB === source.drugName
      );
      if (relevantEquivs.length > 0) {
        const otherNames = relevantEquivs.map(r =>
          r.drugNameA === source.drugName ? r.drugNameB : r.drugNameA
        );
        const otherMasters = await db.select({ id: drugMaster.id }).from(drugMaster).where(
          inArray(drugMaster.drugName, otherNames)
        );
        matchedIds = [...new Set([...matchedIds, ...otherMasters.map((m: { id: number }) => m.id)])];
      }
    }

    groups.push({
      columnLabel: gn ? `${gn} ${spec ?? ''}`.trim() : source.drugName,
      genericName: gn,
      specification: spec,
      drugMasterIds: matchedIds,
    });
  }

  return groups;
}

export function scoreAndSortPharmacies<T extends { matchedCount: number; totalYakka: number; distance: number | null }>(
  pharmacyList: T[],
): T[] {
  return [...pharmacyList].sort((a, b) => {
    if (b.matchedCount !== a.matchedCount) return b.matchedCount - a.matchedCount;
    if (a.totalYakka !== b.totalYakka) return a.totalYakka - b.totalYakka;
    if (a.distance === null && b.distance === null) return 0;
    if (a.distance === null) return 1;
    if (b.distance === null) return -1;
    return a.distance - b.distance;
  });
}

// Types for searchPrescriptionInventory

interface PharmacyScore {
  pharmacyId: number;
  pharmacyName: string;
  matchedCount: number;
  totalDrugs: number;
  totalYakka: number;
  distance: number | null;
  isFavorite: boolean;
  isGroupMember: boolean;
  businessStatus: { isOpen: boolean; message: string; isConfigured: boolean };
}

interface MatrixCell {
  available: boolean;
  items: Array<{
    drugName: string;
    manufacturer: string | null;
    yakkaUnitPrice: number | null;
    quantity: number;
    unit: string | null;
  }>;
}

export interface PrescriptionSearchResult {
  summary: PharmacyScore[];
  matrix: {
    columns: Array<{ genericName: string | null; specification: string | null; columnLabel: string }>;
    rows: Array<{
      pharmacyId: number;
      pharmacyName: string;
      cells: MatrixCell[];
    }>;
  };
}

// Main search function

export async function searchPrescriptionInventory(
  pharmacyId: number,
  drugKeys: DrugKey[],
  filters: { groupOnly: boolean; openOnly: boolean; favoritePriority: boolean },
  coordinates: { latitude: number | null; longitude: number | null } | null,
): Promise<PrescriptionSearchResult> {
  // 1. Resolve drug groups
  const drugGroups = await resolveDrugGroups(drugKeys);

  // 2. Collect all drugMasterIds across groups
  const allDrugMasterIds = drugGroups.flatMap(g => g.drugMasterIds);

  if (allDrugMasterIds.length === 0) {
    return {
      summary: [],
      matrix: {
        columns: drugGroups.map(g => ({ genericName: g.genericName, specification: g.specification, columnLabel: g.columnLabel })),
        rows: [],
      },
    };
  }

  // 3. Fetch inventory (primary path: drugMasterId match)
  const inventory = await db
    .select({
      id: deadStockItems.id,
      pharmacyId: deadStockItems.pharmacyId,
      drugMasterId: deadStockItems.drugMasterId,
      drugName: deadStockItems.drugName,
      quantity: deadStockItems.quantity,
      unit: deadStockItems.unit,
      yakkaUnitPrice: deadStockItems.yakkaUnitPrice,
    })
    .from(deadStockItems)
    .where(
      and(
        eq(deadStockItems.isAvailable, true),
        ne(deadStockItems.pharmacyId, pharmacyId),
        inArray(deadStockItems.drugMasterId, allDrugMasterIds),
      )
    );

  // 4. Fetch pharmacy data only for relevant pharmacies (select only needed columns)
  const relevantPharmacyIds = [...new Set(inventory.map(i => i.pharmacyId))];
  const pharmacyRows = relevantPharmacyIds.length > 0
    ? await db.select({
        id: pharmacies.id,
        name: pharmacies.name,
        latitude: pharmacies.latitude,
        longitude: pharmacies.longitude,
      }).from(pharmacies).where(inArray(pharmacies.id, relevantPharmacyIds))
    : [];
  const pharmacyMap = new Map(pharmacyRows.map(p => [p.id, p]));

  // 5-8. Fetch blocked, group members, favorites, and manufacturers in parallel
  const [blockedRows, groupQueryResult, favoriteRows, masterRows] = await Promise.all([
    // 5. Blocked pharmacies
    db.select({ pharmacyId: pharmacyRelationships.pharmacyId, targetPharmacyId: pharmacyRelationships.targetPharmacyId })
      .from(pharmacyRelationships)
      .where(and(
        or(eq(pharmacyRelationships.pharmacyId, pharmacyId), eq(pharmacyRelationships.targetPharmacyId, pharmacyId)),
        eq(pharmacyRelationships.relationshipType, 'blocked'),
      )),
    // 6. Group members (only if groupOnly filter)
    filters.groupOnly
      ? db.select({ groupId: groupMembers.groupId }).from(groupMembers).where(eq(groupMembers.pharmacyId, pharmacyId))
          .then(async myGroups => {
            if (myGroups.length === 0) return new Set<number>();
            const memberRows = await db.select({ pharmacyId: groupMembers.pharmacyId }).from(groupMembers)
              .where(inArray(groupMembers.groupId, myGroups.map(g => g.groupId)));
            const ids = new Set(memberRows.map(m => m.pharmacyId));
            ids.delete(pharmacyId);
            return ids;
          })
      : Promise.resolve(null as Set<number> | null),
    // 7. Favorites
    db.select({ targetPharmacyId: pharmacyRelationships.targetPharmacyId })
      .from(pharmacyRelationships)
      .where(and(eq(pharmacyRelationships.pharmacyId, pharmacyId), eq(pharmacyRelationships.relationshipType, 'favorite'))),
    // 8. Manufacturer info
    db.select({ id: drugMaster.id, manufacturer: drugMaster.manufacturer })
      .from(drugMaster)
      .where(inArray(drugMaster.id, allDrugMasterIds)),
  ]);

  const blockedIds = new Set(blockedRows.flatMap(r => [r.pharmacyId, r.targetPharmacyId]));
  blockedIds.delete(pharmacyId);
  const groupMemberIds = groupQueryResult;
  const favoriteIds = new Set(favoriteRows.map(r => r.targetPharmacyId));
  const masterManufacturerMap = new Map(masterRows.map(m => [m.id, m.manufacturer]));

  // 9. Build per-pharmacy inventory map (apply blocked/groupOnly filters)
  const pharmacyInventory = new Map<number, typeof inventory>();
  for (const item of inventory) {
    if (blockedIds.has(item.pharmacyId)) continue;
    if (groupMemberIds !== null && !groupMemberIds.has(item.pharmacyId)) continue;

    if (!pharmacyInventory.has(item.pharmacyId)) {
      pharmacyInventory.set(item.pharmacyId, []);
    }
    pharmacyInventory.get(item.pharmacyId)!.push(item);
  }

  // Pre-compute Set for each drug group (avoid Array.includes in hot loop)
  const drugGroupSets = drugGroups.map(g => new Set(g.drugMasterIds));

  // 10. Build matrix and summary per pharmacy
  const summaryList: PharmacyScore[] = [];
  const matrixRows: PrescriptionSearchResult['matrix']['rows'] = [];

  for (const [phId, items] of pharmacyInventory) {
    const pharmacy = pharmacyMap.get(phId);
    if (!pharmacy) continue;

    // TODO: openOnly filter — integrate business-hours-service

    const cells: MatrixCell[] = drugGroups.map((_group, gi) => {
      const idSet = drugGroupSets[gi];
      const matchedItems = items.filter(item =>
        item.drugMasterId !== null && idSet.has(item.drugMasterId)
      );

      return {
        available: matchedItems.length > 0,
        items: matchedItems
          .map(item => ({
            drugName: item.drugName,
            manufacturer: item.drugMasterId ? (masterManufacturerMap.get(item.drugMasterId) ?? null) : null,
            yakkaUnitPrice: item.yakkaUnitPrice ? parseFloat(item.yakkaUnitPrice) : null,
            quantity: item.quantity,
            unit: item.unit,
          }))
          .sort((a, b) => (a.yakkaUnitPrice ?? Infinity) - (b.yakkaUnitPrice ?? Infinity)),
      };
    });

    const matchedCount = cells.filter(c => c.available).length;
    if (matchedCount === 0) continue;

    const totalYakka = cells.reduce((sum, cell) => {
      if (!cell.available || cell.items.length === 0) return sum;
      return sum + (cell.items[0].yakkaUnitPrice ?? 0);
    }, 0);

    const dist =
      coordinates?.latitude != null &&
      coordinates?.longitude != null &&
      pharmacy.latitude != null &&
      pharmacy.longitude != null
        ? haversineDistance(coordinates.latitude, coordinates.longitude, pharmacy.latitude, pharmacy.longitude)
        : null;

    summaryList.push({
      pharmacyId: phId,
      pharmacyName: pharmacy.name,
      matchedCount,
      totalDrugs: drugGroups.length,
      totalYakka: Math.round(totalYakka * 100) / 100,
      distance: dist !== null ? Math.round(dist * 10) / 10 : null,
      isFavorite: favoriteIds.has(phId),
      isGroupMember: groupMemberIds !== null ? groupMemberIds.has(phId) : false,
      businessStatus: { isOpen: true, message: '', isConfigured: false },
    });

    matrixRows.push({ pharmacyId: phId, pharmacyName: pharmacy.name, cells });
  }

  // 11. Sort + limit to 50 (use Map for O(1) matrix row lookup)
  const sortedSummary = scoreAndSortPharmacies(summaryList).slice(0, 50);
  const matrixRowMap = new Map(matrixRows.map(r => [r.pharmacyId, r]));
  const sortedMatrixRows = sortedSummary
    .map(s => matrixRowMap.get(s.pharmacyId))
    .filter((r): r is PrescriptionSearchResult['matrix']['rows'][number] => r !== undefined);

  return {
    summary: sortedSummary,
    matrix: {
      columns: drugGroups.map(g => ({ genericName: g.genericName, specification: g.specification, columnLabel: g.columnLabel })),
      rows: sortedMatrixRows,
    },
  };
}
