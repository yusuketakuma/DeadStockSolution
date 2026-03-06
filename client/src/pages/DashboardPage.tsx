import { useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, Row, Col } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { useTimeline } from '../contexts/TimelineContext';
import { api } from '../api/client';
import type { UploadStatus } from '../components/dashboard/types';
import { useAsyncResource } from '../hooks/useAsyncResource';
import AppDataPanel from '../components/ui/AppDataPanel';
import SmartDigest from '../components/timeline/SmartDigest';
import DashboardTimeline from '../components/timeline/DashboardTimeline';
import OnboardingGuide from '../components/onboarding/OnboardingGuide';
import { useOnboardingVisibility } from '../hooks/useOnboardingVisibility';
import type { TimelineEvent } from '../types/timeline';
import PageShell from '../components/ui/PageShell';

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
    events, total, hasMore, loading: timelineLoading, error: timelineError,
    digestEvents, digestLoading,
    selectedPriority, setSelectedPriority,
    refreshTimeline, loadMore, markViewed,
  } = useTimeline();

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
  const status = data?.status ?? null;
  const risk = data?.risk ?? null;
  const dashboardError = useMemo(
    () => timelineError || (data?.partialError ?? '') || (error ?? ''),
    [data?.partialError, error, timelineError],
  );

  const { shouldShow: showOnboarding, dismiss: dismissOnboarding } = useOnboardingVisibility(status);

  const handleEventClick = useCallback((event: TimelineEvent) => {
    if (event.actionPath) {
      navigate(event.actionPath);
    }
    void markViewed();
  }, [navigate, markViewed]);

  const handleDigestActionPath = useCallback((path: string) => {
    navigate(path);
  }, [navigate]);

  return (
    <PageShell>
      {showOnboarding && (
        <OnboardingGuide status={status} onDismiss={dismissOnboarding} />
      )}

      {/* Title row */}
      <div className="d-flex align-items-center justify-content-between mb-2 flex-shrink-0">
        <h4 className="page-title mb-0">ダッシュボード</h4>
        <small className="text-muted">ようこそ、{user?.name} さん</small>
      </div>

      {/* Top row: SmartDigest (left) + Risk & Status (right) */}
      <Row className="g-2 mb-2 flex-shrink-0">
        <Col lg={7}>
          <SmartDigest
            events={digestEvents}
            status={status}
            loading={digestLoading}
            onEventClick={handleEventClick}
            onActionPathClick={handleDigestActionPath}
            className="h-100"
          />
        </Col>
        <Col lg={5} className="d-flex flex-column gap-2">
          {/* Risk KPIs */}
          <AppDataPanel title="期限切れリスク（自薬局）" className="flex-shrink-0">
            {risk ? (
              <Row className="g-2">
                <Col xs={3}>
                  <div className="dl-kpi-tile">
                    <div className="dl-kpi-value">{risk.riskScore.toFixed(1)}</div>
                    <div className="dl-kpi-label">リスクスコア</div>
                  </div>
                </Col>
                <Col xs={3}>
                  <div className={`dl-kpi-tile${risk.bucketCounts.expired > 0 ? ' dl-kpi-tile--danger' : ''}`}>
                    <div className="dl-kpi-value">{risk.bucketCounts.expired}</div>
                    <div className="dl-kpi-label">期限切れ</div>
                  </div>
                </Col>
                <Col xs={3}>
                  <div className="dl-kpi-tile">
                    <div className="dl-kpi-value">{risk.bucketCounts.within30}</div>
                    <div className="dl-kpi-label">30日以内</div>
                  </div>
                </Col>
                <Col xs={3}>
                  <div className="dl-kpi-tile">
                    <div className="dl-kpi-value">{risk.totalItems}</div>
                    <div className="dl-kpi-label">在庫数</div>
                  </div>
                </Col>
              </Row>
            ) : (
              <div className="small text-muted">期限リスクデータはまだありません。</div>
            )}
          </AppDataPanel>

          {/* Compact status strip */}
          <AppDataPanel title="アップロード状況" className="flex-shrink-0">
            <Row className="g-2 mb-2 small">
              <Col xs={4}>
                <div className="dl-kpi-tile">
                  <div className="fw-semibold mb-1">デッドストックリスト</div>
                  {status?.deadStockUploaded
                    ? <Badge bg="success">アップロード済み</Badge>
                    : <Badge bg="secondary">未アップロード</Badge>}
                </div>
              </Col>
              <Col xs={4}>
                <div className="dl-kpi-tile">
                  <div className="fw-semibold mb-1">医薬品使用量リスト</div>
                  {status?.usedMedicationUploaded
                    ? <Badge bg="success">当月アップロード済み</Badge>
                    : <Badge bg="warning" text="dark">当月未アップロード</Badge>}
                </div>
              </Col>
              <Col xs={4}>
                <div className="dl-kpi-tile">
                  <div className="fw-semibold mb-1">マッチング</div>
                  {status?.usedMedicationUploaded
                    ? <span className="text-success">交換先を検索できます</span>
                    : <span className="text-muted">使用量リストが必要です</span>}
                </div>
              </Col>
            </Row>
            <div className="d-flex gap-1 flex-wrap">
              <Link to="/upload" className="btn btn-outline-primary btn-sm py-0">アップロード</Link>
              <Link to="/matching" className="btn btn-outline-primary btn-sm py-0">マッチングを実行</Link>
              <Link to="/inventory/browse" className="btn btn-outline-secondary btn-sm py-0">在庫参照</Link>
              <Link to="/proposals" className="btn btn-outline-secondary btn-sm py-0">マッチング状況</Link>
              <Link to="/exchange-history" className="btn btn-outline-secondary btn-sm py-0">交換履歴</Link>
            </div>
            {!status?.usedMedicationUploaded && (
              <div className="text-info mt-1 small">
                マッチング機能を利用するには、当月の医薬品使用量Excelをアップロードしてください。
              </div>
            )}
          </AppDataPanel>
        </Col>
      </Row>

      {/* Timeline: fills remaining viewport space */}
      <DashboardTimeline
        events={events}
        loading={timelineLoading}
        hasMore={hasMore}
        total={total}
        error={dashboardError}
        selectedPriority={selectedPriority}
        onPriorityChange={setSelectedPriority}
        onLoadMore={loadMore}
        onEventClick={handleEventClick}
        onRefresh={refreshTimeline}
        className="flex-grow-1"
      />
    </PageShell>
  );
}
