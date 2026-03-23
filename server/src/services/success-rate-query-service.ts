import { and, eq, or, sql } from 'drizzle-orm';
import { exchangeProposals } from '../db/schema';
import { getServiceDeps, type ServiceDependencies } from './service-container';

/**
 * 薬局ペア単位の成約数を集計する。
 * A↔B は同一ペアとして扱う（対称的な集計）。
 *
 * @param pharmacyId 自薬局ID
 * @param deps サービス依存関係
 * @returns 相手薬局ID → 成約数 の Map
 */
export async function getPharmacyPairSuccessCounts(
  pharmacyId: number,
  deps: ServiceDependencies = getServiceDeps(),
): Promise<Map<number, number>> {
  const rows = await deps.db
    .select({
      pharmacyAId: exchangeProposals.pharmacyAId,
      pharmacyBId: exchangeProposals.pharmacyBId,
      count: sql<number>`count(*)::int`,
    })
    .from(exchangeProposals)
    .where(
      and(
        eq(exchangeProposals.status, 'completed'),
        or(
          eq(exchangeProposals.pharmacyAId, pharmacyId),
          eq(exchangeProposals.pharmacyBId, pharmacyId),
        ),
      ),
    )
    .groupBy(exchangeProposals.pharmacyAId, exchangeProposals.pharmacyBId);

  const result = new Map<number, number>();
  for (const row of rows) {
    // 相手薬局IDを特定する（A↔B のどちらでも同一ペア）
    const counterpartyId =
      row.pharmacyAId === pharmacyId ? row.pharmacyBId : row.pharmacyAId;
    const existing = result.get(counterpartyId) ?? 0;
    result.set(counterpartyId, existing + row.count);
  }

  return result;
}
