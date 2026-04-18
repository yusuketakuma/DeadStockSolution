import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
  adminDashboardSnapshots,
  events,
  exchangeProposalItems,
  exchangeProposals,
  notifications,
  openclawRequestEvents,
  pharmacies,
  uploadJobs,
} from '../db/schema';
import { logger } from './logger';
import { rowCount } from '../utils/db-utils';

interface PostgresErrorLike {
  code?: string;
}

function isUndefinedTableError(err: unknown): err is PostgresErrorLike {
  return typeof err === 'object' && err !== null && (err as PostgresErrorLike).code === '42P01';
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function fetchAdminStatsSnapshot() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  const [
    [pharmacyCount],
    [activePharmacyCount],
    [uploadCount],
    [proposalCount],
    [historyCount],
    [pickupCount],
    [exchangeAmount],
    [activePharmacies30d],
    [monthlyExchangeValue],
  ] = await Promise.all([
    db.select({ count: rowCount }).from(pharmacies),
    db.select({ count: rowCount })
      .from(pharmacies)
      .where(eq(pharmacies.isActive, true)),
    db.select({ count: rowCount }).from(uploadJobs),
    db.select({ count: rowCount }).from(exchangeProposals),
    db.select({ count: rowCount }).from(exchangeProposals).where(eq(exchangeProposals.status, 'completed')),
    db.select({ count: rowCount })
      .from(exchangeProposalItems)
      .innerJoin(exchangeProposals, eq(exchangeProposalItems.proposalId, exchangeProposals.id))
      .where(eq(exchangeProposals.status, 'completed')),
    db.select({
      total: sql<number>`coalesce(sum(${exchangeProposals.completedTotalValue}), 0)`,
    }).from(exchangeProposals).where(eq(exchangeProposals.status, 'completed')),
    db.select({
      count: sql<number>`count(distinct ${events.pharmacyId})::int`,
    }).from(events).where(
      and(
        sql`${events.action} IN ('login', 'admin_login')`,
        gte(events.createdAt, thirtyDaysAgo),
      ),
    ),
    db.select({
      total: sql<number>`coalesce(sum(${exchangeProposals.completedTotalValue}), 0)`,
    }).from(exchangeProposals).where(
      and(
        eq(exchangeProposals.status, 'completed'),
        gte(exchangeProposals.completedAt, monthStart),
      ),
    ),
  ]);

  const totalPharmacies = pharmacyCount.count;
  const activeRate30d = totalPharmacies > 0 ? activePharmacies30d.count / totalPharmacies : 0;
  const proposalCompletionRate = proposalCount.count > 0 ? historyCount.count / proposalCount.count : 0;

  return {
    pharmacyCount: totalPharmacies,
    activePharmacyCount: activePharmacyCount.count,
    uploadCount: uploadCount.count,
    proposalCount: proposalCount.count,
    historyCount: historyCount.count,
    pickupCount: pickupCount.count,
    exchangeAmount: Number(exchangeAmount.total ?? 0),
    activeRate30d,
    proposalCompletionRate,
    monthlyExchangeValue: Number(monthlyExchangeValue.total ?? 0),
  };
}

export async function fetchAdminAlertSnapshot(since: string) {
  const [
    [failedUploadJobs],
    [stalledUploadJobs],
    [unreadNotificationsCount],
    [pendingProposalsCount],
    escalatedRequestsCount,
  ] = await Promise.all([
    db.select({ count: rowCount })
      .from(uploadJobs)
      .where(and(eq(uploadJobs.status, 'failed'), gte(uploadJobs.createdAt, since))),
    db.select({ count: rowCount })
      .from(uploadJobs)
      .where(and(eq(uploadJobs.status, 'pending'), gte(uploadJobs.createdAt, since))),
    db.select({ count: rowCount })
      .from(notifications)
      .where(eq(notifications.isRead, false)),
    db.select({ count: rowCount })
      .from(exchangeProposals)
      .where(and(
        gte(exchangeProposals.proposedAt, since),
        sql`${exchangeProposals.status} IN ('proposed', 'accepted_a', 'accepted_b')`,
      )),
    (async () => {
      try {
        const [row] = await db.select({ count: rowCount })
          .from(openclawRequestEvents)
          .where(and(
            eq(openclawRequestEvents.eventType, 'request_escalated'),
            gte(openclawRequestEvents.createdAt, since),
          ));
        return row ?? { count: 0 };
      } catch (err) {
        if (!isUndefinedTableError(err)) {
          logger.warn('openclaw_request_events query failed; continuing without escalated request counts', {
            since,
            error: getErrorMessage(err),
          });
        }
        return { count: 0 };
      }
    })(),
  ]);

  return {
    failedUploadJobs24h: failedUploadJobs.count,
    stalledUploadJobs24h: stalledUploadJobs.count,
    unreadNotifications: unreadNotificationsCount.count,
    pendingProposalActions24h: pendingProposalsCount.count,
    escalatedRequests24h: escalatedRequestsCount.count,
  };
}

export async function createAdminDashboardSnapshot(since: string) {
  const [statsSnapshot, alertSnapshot] = await Promise.all([
    fetchAdminStatsSnapshot(),
    fetchAdminAlertSnapshot(since),
  ]);
  const [row] = await db.insert(adminDashboardSnapshots).values({
    totalUploads: statsSnapshot.uploadCount,
    totalExchanges: statsSnapshot.historyCount,
    unreadNotifications: alertSnapshot.unreadNotifications,
    failedUploadJobs24h: alertSnapshot.failedUploadJobs24h,
    pendingProposalActions24h: alertSnapshot.pendingProposalActions24h,
    escalatedRequests24h: alertSnapshot.escalatedRequests24h ?? 0,
  }).returning();
  return row;
}
