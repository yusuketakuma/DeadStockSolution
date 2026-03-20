import { db } from '../config/database';
import { drugMaster, drugEquivalences } from '../db/schema';
import { eq, and, inArray, or, isNull } from 'drizzle-orm';

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
  drugNames: string[];
}

// resolveDrugGroups: drugKeys から同一成分の全drugMasterIdを収集
export async function resolveDrugGroups(drugKeys: DrugKey[]): Promise<DrugGroup[]> {
  const groups: DrugGroup[] = [];

  for (const key of drugKeys) {
    // Source drug master を取得
    const [source] = await db.select().from(drugMaster).where(eq(drugMaster.id, key.drugMasterId));
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
      matchedIds = [...new Set([...matchedIds, ...matches.map(m => m.id)])];
    }

    // Pass 2: drugEquivalences テキストマッチ (genericName NULL or 少数マッチ時)
    if (!gn || matchedIds.length <= 1) {
      const equivRows = await db.select().from(drugEquivalences).where(
        or(
          eq(drugEquivalences.drugNameA, source.drugName),
          eq(drugEquivalences.drugNameB, source.drugName),
        )
      );
      for (const row of equivRows) {
        const otherName = row.drugNameA === source.drugName ? row.drugNameB : row.drugNameA;
        const otherMasters = await db.select({ id: drugMaster.id }).from(drugMaster).where(eq(drugMaster.drugName, otherName));
        matchedIds = [...new Set([...matchedIds, ...otherMasters.map(m => m.id)])];
      }
    }

    // Pass 3 は T905 で実装（Jaccard フォールバック）

    // drugNames を取得
    const matchedDrugNames = matchedIds.length > 0
      ? (await db.select({ drugName: drugMaster.drugName }).from(drugMaster).where(inArray(drugMaster.id, matchedIds))).map(r => r.drugName)
      : [source.drugName];

    groups.push({
      columnLabel: gn ? `${gn} ${spec ?? ''}`.trim() : source.drugName,
      genericName: gn,
      specification: spec,
      drugMasterIds: matchedIds,
      drugNames: matchedDrugNames,
    });
  }

  return groups;
}

export function scoreAndSortPharmacies<T extends { matchedCount: number; totalYakka: number; distance: number | null }>(
  pharmacies: T[],
): T[] {
  return [...pharmacies].sort((a, b) => {
    if (b.matchedCount !== a.matchedCount) return b.matchedCount - a.matchedCount;
    if (a.totalYakka !== b.totalYakka) return a.totalYakka - b.totalYakka;
    if (a.distance === null && b.distance === null) return 0;
    if (a.distance === null) return 1;
    if (b.distance === null) return -1;
    return a.distance - b.distance;
  });
}
