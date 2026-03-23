import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../config/database';
import { events, pharmacies, uploadJobs, exchangeProposals } from '../db/schema';

export async function getPharmacyHealthSummary() {
  const [activityByPharmacy, trustScores, uploadActivity, lastLogins, proposalActivity] = await Promise.all([
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
    db.select({
      pharmacyId: uploadJobs.pharmacyId,
      pharmacyName: pharmacies.name,
      totalUploads: sql<number>`count(*)`.as('total_uploads'),
      lastUploadAt: sql<string | null>`max(${uploadJobs.createdAt})`.as('last_upload_at'),
      completedCount: sql<number>`count(*) filter (where ${uploadJobs.status} = 'completed')`.as('completed_count'),
    })
      .from(uploadJobs)
      .leftJoin(pharmacies, eq(uploadJobs.pharmacyId, pharmacies.id))
      .groupBy(uploadJobs.pharmacyId, pharmacies.name)
      .orderBy(sql`count(*) desc`)
      .limit(50),
    db.select({
      pharmacyId: events.pharmacyId,
      pharmacyName: pharmacies.name,
      lastLoginAt: sql<string | null>`max(${events.createdAt})`.as('last_login_at'),
    })
      .from(events)
      .leftJoin(pharmacies, eq(events.pharmacyId, pharmacies.id))
      .where(eq(events.action, 'login'))
      .groupBy(events.pharmacyId, pharmacies.name)
      .orderBy(sql`max(${events.createdAt}) desc`)
      .limit(50),
    db.select({
      pharmacyId: pharmacies.id,
      pharmacyName: pharmacies.name,
      sent: sql<number>`count(*) filter (where ${exchangeProposals.pharmacyAId} = ${pharmacies.id})`.as('sent'),
      received: sql<number>`count(*) filter (where ${exchangeProposals.pharmacyBId} = ${pharmacies.id})`.as('received'),
      completed: sql<number>`count(*) filter (where (${exchangeProposals.pharmacyAId} = ${pharmacies.id} or ${exchangeProposals.pharmacyBId} = ${pharmacies.id}) and ${exchangeProposals.status} = 'completed')`.as('completed'),
    })
      .from(pharmacies)
      .leftJoin(
        exchangeProposals,
        sql`${exchangeProposals.pharmacyAId} = ${pharmacies.id} or ${exchangeProposals.pharmacyBId} = ${pharmacies.id}`,
      )
      .groupBy(pharmacies.id, pharmacies.name)
      .orderBy(sql`count(*) desc`)
      .limit(50),
  ]);

  const uploadActivityResult = uploadActivity.map((row) => ({
    pharmacyId: row.pharmacyId,
    pharmacyName: row.pharmacyName,
    totalUploads: row.totalUploads,
    lastUploadAt: row.lastUploadAt,
    successRate: row.totalUploads > 0 ? row.completedCount / row.totalUploads : 0,
  }));

  return {
    activityByPharmacy,
    trustScores,
    uploadActivity: uploadActivityResult,
    lastLogins,
    proposalActivity,
  };
}
