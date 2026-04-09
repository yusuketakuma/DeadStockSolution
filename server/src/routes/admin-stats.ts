import { Router, Response } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../config/database';
import {
  adminDashboardSnapshots,
} from '../db/schema';
import { AuthRequest } from '../types';
import {
  createAdminDashboardSnapshot,
  fetchAdminAlertSnapshot,
  fetchAdminStatsSnapshot,
} from '../services/admin-dashboard-snapshot-service';
import { getObservabilitySnapshot } from '../services/observability-service';
import { getMonitoringKpiSnapshot } from '../services/monitoring-kpi-service';
import { getLogPushStats } from '../services/openclaw/log-push-service';
import { handleAdminError } from './admin-utils';

const router = Router();

function parseRequestedMinutes(rawValue: unknown, fallback = 60): number {
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : fallback;
}

router.get('/dashboard-trends', async (_req: AuthRequest, res: Response) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [statsSnapshot, alertSnapshot, latestRows] = await Promise.all([
      fetchAdminStatsSnapshot(),
      fetchAdminAlertSnapshot(since),
      db.select()
        .from(adminDashboardSnapshots)
        .orderBy(sql`${adminDashboardSnapshots.createdAt} desc`)
        .limit(8),
    ]);

    const current = {
      totalUploads: statsSnapshot.uploadCount,
      totalExchanges: statsSnapshot.historyCount,
      unreadNotifications: alertSnapshot.unreadNotifications,
      failedUploadJobs24h: alertSnapshot.failedUploadJobs24h,
      pendingProposalActions24h: alertSnapshot.pendingProposalActions24h,
      escalatedRequests24h: alertSnapshot.escalatedRequests24h ?? 0,
    };

    const latest = latestRows[0] ?? null;
    const previous = latestRows[1] ?? latestRows[0] ?? null;
    const latestAgeMs = latest?.createdAt ? Date.now() - Date.parse(latest.createdAt) : Number.POSITIVE_INFINITY;

    if (!latest || latestAgeMs > 30 * 60 * 1000) {
      await createAdminDashboardSnapshot(since);
    }

    const base = previous ?? latest;
    const historyRows = latestRows.slice(0, 7);
    const average = historyRows.length > 0 ? {
      totalUploads: Math.round(historyRows.reduce((sum, row) => sum + row.totalUploads, 0) / historyRows.length),
      totalExchanges: Math.round(historyRows.reduce((sum, row) => sum + row.totalExchanges, 0) / historyRows.length),
      unreadNotifications: Math.round(historyRows.reduce((sum, row) => sum + row.unreadNotifications, 0) / historyRows.length),
      failedUploadJobs24h: Math.round(historyRows.reduce((sum, row) => sum + row.failedUploadJobs24h, 0) / historyRows.length),
      pendingProposalActions24h: Math.round(historyRows.reduce((sum, row) => sum + row.pendingProposalActions24h, 0) / historyRows.length),
      escalatedRequests24h: Math.round(historyRows.reduce((sum, row) => sum + (row.escalatedRequests24h ?? 0), 0) / historyRows.length),
    } : null;
    res.json({
      current,
      previous: base ? {
        totalUploads: base.totalUploads,
        totalExchanges: base.totalExchanges,
        unreadNotifications: base.unreadNotifications,
        failedUploadJobs24h: base.failedUploadJobs24h,
        pendingProposalActions24h: base.pendingProposalActions24h,
        escalatedRequests24h: base.escalatedRequests24h,
        createdAt: base.createdAt,
      } : null,
      average,
      spikes: average ? {
        failedUploadJobs24h: current.failedUploadJobs24h >= Math.max(average.failedUploadJobs24h * 2, 3),
        pendingProposalActions24h: current.pendingProposalActions24h >= Math.max(average.pendingProposalActions24h * 2, 5),
        unreadNotifications: current.unreadNotifications >= Math.max(average.unreadNotifications * 2, 5),
      } : null,
    });
  } catch (err) {
    handleAdminError(err, 'Admin dashboard trends error', 'ダッシュボード差分の取得に失敗しました', res);
  }
});

router.get('/stats', async (_req: AuthRequest, res: Response) => {
  try {
    const snapshot = await fetchAdminStatsSnapshot();

    res.json({
      totalPharmacies: snapshot.pharmacyCount,
      activePharmacies: snapshot.activePharmacyCount,
      inactivePharmacies: snapshot.pharmacyCount - snapshot.activePharmacyCount,
      totalUploads: snapshot.uploadCount,
      totalProposals: snapshot.proposalCount,
      totalExchanges: snapshot.historyCount,
      totalPickupItems: snapshot.pickupCount,
      totalExchangeValue: snapshot.exchangeAmount,
      activeRate30d: snapshot.activeRate30d,
      proposalCompletionRate: snapshot.proposalCompletionRate,
      monthlyExchangeValue: snapshot.monthlyExchangeValue,
    });
  } catch (err) {
    handleAdminError(err, 'Admin stats error', '統計情報の取得に失敗しました', res);
  }
});


router.get('/alerts', async (_req: AuthRequest, res: Response) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    res.json(await fetchAdminAlertSnapshot(since));
  } catch (err) {
    handleAdminError(err, 'Admin alerts error', 'アラート集計の取得に失敗しました', res);
  }
});


router.get('/kpis', async (req: AuthRequest, res: Response) => {
  try {
    const minutes = parseRequestedMinutes(req.query.minutes);
    const snapshot = await getMonitoringKpiSnapshot(minutes);
    res.json(snapshot);
  } catch (err) {
    handleAdminError(err, 'Admin KPI snapshot error', 'KPI監視情報の取得に失敗しました', res);
  }
});

router.get('/observability', async (req: AuthRequest, res: Response) => {
  try {
    const minutes = parseRequestedMinutes(req.query.minutes);
    const snapshot = getObservabilitySnapshot(minutes);
    res.json({
      ...snapshot,
      logPush: getLogPushStats(),
    });
  } catch (err) {
    handleAdminError(err, 'Admin observability error', '監視情報の取得に失敗しました', res);
  }
});

export default router;
