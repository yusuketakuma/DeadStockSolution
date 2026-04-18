export interface AdminDashboardPriorityAction {
  id: string;
  title: string;
  description: string;
  to: string;
  tone: 'danger' | 'warning' | 'info';
}

interface AdminDashboardPrioritySources {
  alertsSummary: {
    failedUploadJobs24h: number;
    stalledUploadJobs24h: number;
    unreadNotifications: number;
    pendingProposalActions24h: number;
    escalatedRequests24h?: number;
  } | null;
  monitoringKpis: {
    status: 'healthy' | 'warning';
    breaches: {
      errorRate5xx: boolean;
      uploadFailureRate: boolean;
      pendingStaleCount: boolean;
    };
  } | null;
  openClawHealth: {
    status: 'ok' | 'degraded';
    retryQueue: {
      pending: number;
      failed: number;
    };
    ddsAgent: {
      connected: boolean;
      queuedJobs: number;
      awaitingUser: number;
    };
  } | null;
  sloBreaches: {
    total: number;
  } | null;
  cronStatus: Array<{
    label: string;
    lastActivityAt: string | null;
  }>;
}

export function deriveAdminPriorityActions(
  sources: AdminDashboardPrioritySources,
): AdminDashboardPriorityAction[] {
  const actions: Array<AdminDashboardPriorityAction & { priority: number }> = [];

  if (sources.openClawHealth && (!sources.openClawHealth.ddsAgent.connected || sources.openClawHealth.status !== 'ok')) {
    const retrySummary = `pending ${sources.openClawHealth.retryQueue.pending} / failed ${sources.openClawHealth.retryQueue.failed}`;
    actions.push({
      id: 'openclaw',
      title: 'OpenClaw / DDS を確認',
      description: `連携状態が不安定です。DDS 接続と retry queue を確認してください。${retrySummary}`,
      to: '/admin/openclaw',
      tone: 'danger',
      priority: 0,
    });
  }

  if (sources.alertsSummary && (sources.alertsSummary.failedUploadJobs24h > 0 || sources.alertsSummary.stalledUploadJobs24h > 0)) {
    actions.push({
      id: 'upload-jobs',
      title: '取込ジョブを整理',
      description: `失敗 ${sources.alertsSummary.failedUploadJobs24h} 件 / 保留 ${sources.alertsSummary.stalledUploadJobs24h} 件があります。`,
      to: '/admin/upload-jobs',
      tone: 'danger',
      priority: 1,
    });
  }

  if (sources.monitoringKpis?.status === 'warning') {
    const breachReasons = [
      sources.monitoringKpis.breaches.errorRate5xx ? '5xx' : null,
      sources.monitoringKpis.breaches.uploadFailureRate ? '取込失敗率' : null,
      sources.monitoringKpis.breaches.pendingStaleCount ? '滞留ジョブ' : null,
    ].filter(Boolean);

    actions.push({
      id: 'monitoring',
      title: '監視アラートを掘る',
      description: `監視 KPI が警告状態です。${breachReasons.join(' / ') || '異常値'} を確認してください。`,
      to: '/admin/log-center',
      tone: 'warning',
      priority: 2,
    });
  }

  if (sources.alertsSummary?.pendingProposalActions24h && sources.alertsSummary.pendingProposalActions24h > 0) {
    actions.push({
      id: 'requests',
      title: '要対応案件を片付ける',
      description: `${sources.alertsSummary.pendingProposalActions24h} 件の対応待ち案件があります。`,
      to: '/admin/user-requests',
      tone: 'warning',
      priority: 3,
    });
  }

  if (sources.alertsSummary?.escalatedRequests24h && sources.alertsSummary.escalatedRequests24h > 0) {
    actions.push({
      id: 'request-escalations',
      title: '再催促エスカレーションを確認',
      description: `${sources.alertsSummary.escalatedRequests24h} 件の再催促案件があります。先に詰まりを解消してください。`,
      to: '/admin/user-requests',
      tone: 'warning',
      priority: 3,
    });
  }

  if (sources.sloBreaches?.total && sources.sloBreaches.total > 0) {
    actions.push({
      id: 'slo',
      title: 'SLO breach を確認',
      description: `${sources.sloBreaches.total} 件の breach 記録があります。原因の切り分けを進めてください。`,
      to: '/admin/log-center',
      tone: 'warning',
      priority: 4,
    });
  }

  const missingCronProof = sources.cronStatus.filter((cron) => !cron.lastActivityAt).slice(0, 2);
  if (missingCronProof.length > 0) {
    actions.push({
      id: 'cron',
      title: 'cron 証跡を確認',
      description: `${missingCronProof.map((cron) => cron.label).join(' / ')} の直近証跡がありません。`,
      to: '/admin/log-center',
      tone: 'info',
      priority: 5,
    });
  }

  if (sources.alertsSummary?.unreadNotifications && sources.alertsSummary.unreadNotifications > 0) {
    actions.push({
      id: 'notifications',
      title: '通知・配信状況を確認',
      description: `${sources.alertsSummary.unreadNotifications} 件の未処理通知があります。`,
      to: '/admin/notifications',
      tone: 'info',
      priority: 6,
    });
  }

  return actions
    .sort((left, right) => left.priority - right.priority)
    .slice(0, 4)
    .map(({ priority: _priority, ...action }) => action);
}
