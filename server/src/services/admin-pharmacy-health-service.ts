import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { events, pharmacies } from '../db/schema';

export async function getPharmacyHealthSummary() {
  const [activityByPharmacy, trustScores] = await Promise.all([
    db.select({
      pharmacyId: events.pharmacyId,
      pharmacyName: pharmacies.name,
      actionCount: sql<number>`count(*)`.as('action_count'),
      lastActivity: sql<string>`max(${events.createdAt})`.as('last_activity'),
    })
      .from(events)
      .leftJoin(pharmacies, eq(events.pharmacyId, pharmacies.id))
      .groupBy(events.pharmacyId, pharmacies.name)
      .orderBy(sql`count(*) desc`)
      .limit(50),
    db.select({
      pharmacyId: pharmacies.id,
      pharmacyName: pharmacies.name,
      trustScore: pharmacies.trustScore,
      ratingCount: pharmacies.ratingCount,
      positiveRate: pharmacies.positiveRate,
      updatedAt: pharmacies.updatedAt,
    })
      .from(pharmacies)
      .orderBy(desc(pharmacies.updatedAt))
      .limit(50),
  ]);

  return { activityByPharmacy, trustScores };
}
