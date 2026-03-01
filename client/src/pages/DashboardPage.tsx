import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTimeline } from '../contexts/TimelineContext';
import { api } from '../api/client';
import type { UploadStatus } from '../components/dashboard/types';
import DashboardStatusCards from '../components/dashboard/DashboardStatusCards';
import { useAsyncResource } from '../hooks/useAsyncResource';
import AppDataPanel from '../components/ui/AppDataPanel';
import AppKpiCard from '../components/ui/AppKpiCard';
import SmartDigest from '../components/timeline/SmartDigest';
import DashboardTimeline from '../components/timeline/DashboardTimeline';
import type { TimelineEvent } from '../types/timeline';

interface PharmacyRisk {
  totalItems: number;
  riskScore: number;
  bucketCounts: {
    expired: number;
    within30: number;
    within60: number;
    within90: number;
    within120: number;
    over120: number;
    unknown: number;
  };
  computedAt: string;
}

function isValidRisk(value: unknown): value is PharmacyRisk {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.riskScore === 'number'
    && typeof row.totalItems === 'number'
    && row.bucketCounts !== null
    && typeof row.bucketCounts === 'object';
}

interface StatusAndRiskData {
  status: UploadStatus | null;
  risk: PharmacyRisk | null;
  partialError: string;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const {
    events: rawEvents, total, hasMore, loading: timelineLoading, error: timelineError,
    digestEvents: rawDigestEvents, digestLoading,
    selectedPriority, setSelectedPriority,
    refreshTimeline, loadMore, markViewed,
  } = useTimeline();
  const events = rawEvents ?? [];
  const digestEvents = rawDigestEvents ?? [];
  const [status, setStatus] = useState<UploadStatus | null>(null);
  const [risk, setRisk] = useState<PharmacyRisk | null>(null);

  const fetchStatusAndRisk = useCallback(async (_signal: AbortSignal) => {
    const [nextStatus, nextRisk] = await Promise.allSettled([
      api.get<UploadStatus>('/upload/status', { signal: _signal }),
      api.get<PharmacyRisk>('/inventory/dead-stock/risk', { signal: _signal }),
    ]);

    if (nextStatus.status === 'rejected' && nextRisk.status === 'rejected') {
      throw new Error('ダッシュボードデータの取得に失敗しました');
    }

    const errors: string[] = [];
    if (nextStatus.status === 'rejected') {
      errors.push('アップロード状況の取得に失敗しました。');
    }
    if (nextRisk.status === 'rejected') {
      errors.push('期限リスクの取得に失敗しました。');
    }

    return {
      status: nextStatus.status === 'fulfilled' ? nextStatus.value : null,
      risk: nextRisk.status === 'fulfilled' && isValidRisk(nextRisk.value) ? nextRisk.value : null,
      partialError: errors.join(' ').trim(),
    };
  }, []);

  const { data, error } = useAsyncResource<StatusAndRiskData>(fetchStatusAndRisk);

  // data が更新されたら state に反映
  if (data) {
    if (data.status && data.status !== status) setStatus(data.status);
    if (data.risk && isValidRisk(data.risk) && data.risk !== risk) setRisk(data.risk);
  }

  const handleEventClick = useCallback((event: TimelineEvent) => {
    if (event.actionPath) {
      navigate(event.actionPath);
    }
    void markViewed();
  }, [navigate, markViewed]);

  return (
    <div>
      <h4 className="page-title mb-3">ダッシュボード</h4>

      <SmartDigest
        events={digestEvents}
        loading={digestLoading}
        onEventClick={handleEventClick}
      />

      <DashboardTimeline
        events={events}
        loading={timelineLoading}
        hasMore={hasMore}
        total={total}
        error={timelineError || (data?.partialError ?? '') || (error ?? '')}
        selectedPriority={selectedPriority}
        onPriorityChange={setSelectedPriority}
        onLoadMore={loadMore}
        onEventClick={handleEventClick}
        onRefresh={refreshTimeline}
      />

      <AppDataPanel title="期限切れリスク（自薬局）" className="mb-3">
        {risk ? (
          <div className="row g-3">
            <div className="col-md-3">
              <AppKpiCard value={risk.riskScore.toFixed(1)} label="リスクスコア" />
            </div>
            <div className="col-md-3">
              <AppKpiCard value={risk.bucketCounts.expired} label="期限切れ件数" />
            </div>
            <div className="col-md-3">
              <AppKpiCard value={risk.bucketCounts.within30} label="30日以内件数" />
            </div>
            <div className="col-md-3">
              <AppKpiCard value={risk.totalItems} label="対象在庫件数" />
            </div>
          </div>
        ) : (
          <div className="small text-muted">期限リスクデータはまだありません。</div>
        )}
      </AppDataPanel>

      <DashboardStatusCards status={status} userName={user?.name} />
    </div>
  );
}
