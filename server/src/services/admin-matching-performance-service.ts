import { sql } from 'drizzle-orm';
import { db } from '../config/database';
import { exchangeProposals, matchCandidateSnapshots } from '../db/schema';
import { getMatchingRefreshStats } from './matching-refresh-service';

export async function getMatchingPerformance() {
  const [statusBreakdown, candidateDistribution, refreshStats] = await Promise.all([
    db.select({
      status: exchangeProposals.status,
      count: sql<number>`count(*)`.as('count'),
    })
      .from(exchangeProposals)
      .groupBy(exchangeProposals.status),
    db.select({
      pharmacyId: matchCandidateSnapshots.pharmacyId,
      candidateCount: matchCandidateSnapshots.candidateCount,
      updatedAt: matchCandidateSnapshots.updatedAt,
    })
      .from(matchCandidateSnapshots)
      .orderBy(sql`${matchCandidateSnapshots.candidateCount} desc`)
      .limit(50),
    getMatchingRefreshStats(),
  ]);

  const totalProposals = statusBreakdown.reduce((sum, row) => sum + row.count, 0);
  const completedCount = statusBreakdown.find((r) => r.status === 'completed')?.count ?? 0;
  const successRate = totalProposals > 0 ? (completedCount / totalProposals * 100) : 0;

  return {
    statusBreakdown,
    candidateDistribution,
    refreshStats,
    summary: {
      totalProposals,
      completedCount,
      successRate: Math.round(successRate * 10) / 10,
    },
  };
}
