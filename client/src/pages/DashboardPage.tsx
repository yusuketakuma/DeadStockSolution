import { lazy, Suspense, useCallback, useMemo } from 'react';
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
import DashboardNextAction from '../components/dashboard/DashboardNextAction';
import OnboardingGuide from '../components/onboarding/OnboardingGuide';
import { useOnboardingVisibility } from '../hooks/useOnboardingVisibility';
import { useRecentWorkList } from '../hooks/useRecentWork';
import type { TimelineEvent } from '../types/timeline';
import PageShell, { ScrollArea } from '../components/ui/PageShell';
import { sanitizeInternalPath } from '../utils/navigation';
import AppDropdownMenu from '../components/ui/AppDropdownMenu';

const RiskBucketBarChart = lazy(() => import('../components/charts/RiskBucketBarChart'));

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

interface AlertStatsData {
  unresolvedCount: number;
  byType: Record<string, number>;
}

interface StatusAndRiskData {
  status: UploadStatus | null;
  risk: PharmacyRisk | null;
  alertStats: AlertStatsData | null;
  partialError: string;
}

const DASHBOARD_SHORTCUT_GROUPS = [
  {
    title: 'アップロード・在庫',
    description: '在庫更新と品質確認をここから進めます。',
    primary: { to: '/upload', label: 'アップロード' },
    links: [
      { to: '/upload-quality', label: '品質を確認' },
      { to: '/inventory/browse', label: '在庫を確認' },
      { to: '/inventory/search', label: '検索条件を確認' },
      { to: '/statistics', label: '統計を確認' },
    ],
  },
  {
    title: 'マッチング・対応',
    description: '候補確認から連絡対応までをまとめています。',
    primary: { to: '/matching', label: '候補を確認' },
    links: [
      { to: '/proposals', label: '提案状況を確認' },
      { to: '/exchange-history', label: '交換履歴を確認' },
      { to: '/notifications', label: '通知を確認' },
      { to: '/requests', label: '要望を確認' },
      { to: '/bookmarks', label: 'ブックマークを確認' },
    ],
  },
  {
    title: 'ネットワーク・設定',
    description: '薬局間のつながりとアカウント設定を確認します。',
    primary: { to: '/groups', label: 'グループを確認' },
    links: [
      { to: '/pharmacies', label: '薬局を確認' },
      { to: '/account', label: '薬局設定を確認' },
    ],
  },
] as const;

function resolveSettledValue<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === 'fulfilled' ? result.value : null;
}

function buildDashboardPartialError(results: {
  nextStatus: PromiseSettledResult<UploadStatus>;
  nextRisk: PromiseSettledResult<PharmacyRisk>;
}): string {
  const errors: string[] = [];
  if (results.nextStatus.status === 'rejected') {
    errors.push('アップロード状況の取得に失敗しました。');
  }
  if (results.nextRisk.status === 'rejected') {
    errors.push('期限リスクの取得に失敗しました。');
  }
  return errors.join(' ').trim();
}

function ChartFallback({ text }: { text: string }) {
  return <div className="small text-muted py-4">{text}</div>;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const recentWork = useRecentWorkList(5);
  const {
    events, total, hasMore, loading: timelineLoading, error: timelineError,
    digestEvents, digestLoading,
    selectedPriority, setSelectedPriority,
    refreshTimeline, loadMore, markViewed,
  } = useTimeline();

  const fetchStatusAndRisk = useCallback(async (_signal: AbortSignal) => {
    const [nextStatus, nextRisk, nextAlertStats] = await Promise.allSettled([
      api.get<UploadStatus>('/upload/status', { signal: _signal }),
      api.get<PharmacyRisk>('/inventory/dead-stock/risk', { signal: _signal }),
      api.get<AlertStatsData>('/alerts/stats', { signal: _signal }),
    ]);

    if (nextStatus.status === 'rejected' && nextRisk.status === 'rejected') {
      throw new Error('ダッシュボードデータの取得に失敗しました');
    }

    return {
      status: resolveSettledValue(nextStatus),
      risk: nextRisk.status === 'fulfilled' && isValidRisk(nextRisk.value) ? nextRisk.value : null,
      alertStats: resolveSettledValue(nextAlertStats),
      partialError: buildDashboardPartialError({ nextStatus, nextRisk }),
    };
  }, []);

  const { data, error } = useAsyncResource<StatusAndRiskData>(fetchStatusAndRisk);
  const status = data?.status ?? null;
  const risk = data?.risk ?? null;
  const alertStats = data?.alertStats ?? null;
  const dashboardError = useMemo(
    () => timelineError || (data?.partialError ?? '') || (error ?? ''),
    [data?.partialError, error, timelineError],
  );
  const nextAction = useMemo(() => {
    if (!status?.deadStockUploaded) {
      return {
        title: 'まずはデッドストックをアップロード',
        description: '一覧と品質確認がそろうと、後続の在庫確認とマッチング準備が進めやすくなります。',
        primaryLabel: 'アップロード',
        primaryPath: '/upload',
        secondaryLabel: '品質を確認',
        secondaryPath: '/upload-quality',
        badge: 'warning' as const,
      };
    }
    if (!status?.usedMedicationUploaded) {
      return {
        title: '当月の使用量リストを更新',
        description: 'マッチング候補の精度を出すため、今月の使用量データを先に入れてください。',
        primaryLabel: 'アップロード',
        primaryPath: '/upload',
        secondaryLabel: '統計を確認',
        secondaryPath: '/statistics',
        badge: 'warning' as const,
      };
    }
    if ((alertStats?.unresolvedCount ?? 0) > 0) {
      return {
        title: '未解決アラートを先に確認',
        description: '期限切迫や過剰在庫の整理を優先すると、後続の提案確認がしやすくなります。',
        primaryLabel: 'アラートを確認',
        primaryPath: '/alerts',
        secondaryLabel: '在庫を確認',
        secondaryPath: '/inventory/browse',
        badge: 'primary' as const,
      };
    }
    return {
      title: '候補を確認して交換を進める',
      description: 'アップロードが揃っているので、候補確認から提案・交換履歴の確認へ進めます。',
      primaryLabel: '候補を確認',
      primaryPath: '/matching',
      secondaryLabel: '提案状況を確認',
      secondaryPath: '/proposals',
      badge: 'success' as const,
    };
  }, [alertStats?.unresolvedCount, status?.deadStockUploaded, status?.usedMedicationUploaded]);

  const { shouldShow: showOnboarding, dismiss: dismissOnboarding } = useOnboardingVisibility(status);

  const handleEventClick = useCallback((event: TimelineEvent) => {
    const safePath = sanitizeInternalPath(event.actionPath ?? '', '');
    if (safePath) {
      navigate(safePath);
    }
    void markViewed();
  }, [navigate, markViewed]);

  const handleDigestActionPath = useCallback((path: string) => {
    const safePath = sanitizeInternalPath(path, '');
    if (safePath) {
      navigate(safePath);
    }
  }, [navigate]);

  const handleRiskBucketClick = useCallback((bucket: 'expired' | 'within30' | 'within60' | 'within90' | 'within120' | 'over120' | 'unknown') => {
    if (bucket === 'expired' || bucket === 'within30') {
      navigate('/alerts?tab=unresolved&type=near_expiry');
      return;
    }
    navigate(`/inventory/dead-stock?riskBucket=${bucket}`);
  }, [navigate]);

  return (
    <PageShell>
      <ScrollArea>
      {showOnboarding && (
        <OnboardingGuide status={status} onDismiss={dismissOnboarding} />
      )}

      <div className="dl-page-header">
        <div className="dl-page-header-copy">
          <h4 className="page-title mb-0">ダッシュボード</h4>
          <small className="text-muted">ようこそ、{user?.name} さん</small>
        </div>
      </div>

      {!showOnboarding && (
        <DashboardNextAction nextAction={nextAction} />
      )}

      {recentWork.length > 0 && (
        <AppDataPanel title="作業再開" className="mb-2">
          <div className="dl-action-row mobile-stack">
            <Link to={recentWork[0].to} className="btn btn-outline-primary btn-sm">
              {recentWork[0].label}
            </Link>
            {recentWork.length > 1 ? (
              <AppDropdownMenu
                label="ほかの作業"
                size="sm"
                variant="outline-secondary"
                items={recentWork.slice(1).map((item) => ({
                  key: item.id,
                  to: item.to,
                  label: item.label,
                }))}
              />
            ) : null}
          </div>
        </AppDataPanel>
      )}

      <AppDataPanel title="機能ショートカット" className="mb-2">
        <Row className="g-3">
          {DASHBOARD_SHORTCUT_GROUPS.map((group) => (
            <Col key={group.title} md={4}>
              <div className="border rounded-3 p-3 h-100">
                <div className="fw-semibold mb-1">{group.title}</div>
                <div className="small text-muted mb-2">{group.description}</div>
                <div className="dl-action-row mobile-stack">
                  <Link to={group.primary.to} className="btn btn-primary btn-sm">
                    {group.primary.label}
                  </Link>
                  <AppDropdownMenu
                    label="関連画面"
                    variant="outline-secondary"
                    items={group.links.map((shortcut) => ({
                      key: shortcut.to,
                      to: shortcut.to,
                      label: shortcut.label,
                    }))}
                  />
                </div>
              </div>
            </Col>
          ))}
        </Row>
      </AppDataPanel>

      {/* Top row: SmartDigest (left) + Risk & Status (right) */}
      <Row className="g-3 mb-2">
        <Col xl={7}>
          <SmartDigest
            events={digestEvents}
            status={status}
            loading={digestLoading}
            onEventClick={handleEventClick}
            onActionPathClick={handleDigestActionPath}
            className="h-100"
            maxItems={2}
          />
        </Col>
        <Col xl={5} className="d-flex flex-column gap-3">
          {/* Risk KPIs */}
          <AppDataPanel title="期限切れリスク（自薬局）">
            {risk ? (
              <>
                <Row className="g-2">
                  <Col xs={6} md={3}>
                    <div className="dl-kpi-tile">
                      <div className="dl-kpi-value">{risk.riskScore.toFixed(1)}</div>
                      <div className="dl-kpi-label">リスクスコア</div>
                    </div>
                  </Col>
                  <Col xs={6} md={3}>
                    <div className={`dl-kpi-tile${risk.bucketCounts.expired > 0 ? ' dl-kpi-tile--danger' : ''}`}>
                      <div className="dl-kpi-value">{risk.bucketCounts.expired}</div>
                      <div className="dl-kpi-label">期限切れ</div>
                    </div>
                  </Col>
                  <Col xs={6} md={3}>
                    <div className="dl-kpi-tile">
                      <div className="dl-kpi-value">{risk.bucketCounts.within30}</div>
                      <div className="dl-kpi-label">30日以内</div>
                    </div>
                  </Col>
                  <Col xs={6} md={3}>
                    <div className="dl-kpi-tile">
                      <div className="dl-kpi-value">{risk.totalItems}</div>
                      <div className="dl-kpi-label">在庫数</div>
                    </div>
                  </Col>
                </Row>
                <div className="mt-2">
                  <Suspense fallback={<ChartFallback text="期限リスクグラフを読み込み中..." />}>
                    <RiskBucketBarChart bucketCounts={risk.bucketCounts} onBucketClick={handleRiskBucketClick} />
                  </Suspense>
                </div>
              </>
            ) : (
              <div className="small text-muted">期限リスクデータはまだありません。</div>
            )}
          </AppDataPanel>

          {/* Compact status strip */}
          <AppDataPanel title="アップロード状況">
            <Row className="g-2 mb-2 small">
              <Col xs={6} sm={4}>
                <div className="dl-kpi-tile">
                  <div className="fw-semibold mb-1">デッドストックリスト</div>
                  {status?.deadStockUploaded
                    ? <Badge bg="success">アップロード済み</Badge>
                    : <Badge bg="secondary">未アップロード</Badge>}
                </div>
              </Col>
              <Col xs={6} sm={4}>
                <div className="dl-kpi-tile">
                  <div className="fw-semibold mb-1">医薬品使用量リスト</div>
                  {status?.usedMedicationUploaded
                    ? <Badge bg="success">当月アップロード済み</Badge>
                    : <Badge bg="warning" text="dark">当月未アップロード</Badge>}
                </div>
              </Col>
              <Col xs={12} sm={4}>
                <div className="dl-kpi-tile">
                  <div className="fw-semibold mb-1">マッチング</div>
                  {status?.usedMedicationUploaded
                    ? <span className="text-success">交換先を検索できます</span>
                    : <span className="text-muted">使用量リストが必要です</span>}
                </div>
              </Col>
            </Row>
            <div className="dl-action-row mobile-stack">
              <Link to="/upload" className="btn btn-outline-primary btn-sm">アップロード</Link>
              <AppDropdownMenu
                label="関連操作"
                variant="outline-secondary"
                items={[
                  { key: 'quality', to: '/upload-quality', label: '品質を確認' },
                  { key: 'browse', to: '/inventory/browse', label: '在庫を確認' },
                ]}
              />
            </div>
            {!status?.usedMedicationUploaded && (
              <div className="text-info mt-1 small">
                マッチング機能を利用するには、当月の医薬品使用量Excelをアップロードしてください。
              </div>
            )}
          </AppDataPanel>
        </Col>
      </Row>

      {/* Alert widget — below risk KPIs */}
      {alertStats && alertStats.unresolvedCount > 0 && (
        <AppDataPanel
          title="予兆アラート"
          actions={<Link to="/alerts" className="btn btn-outline-primary btn-sm py-0">アラートを確認</Link>}
          className="mb-2"
        >
          <Row className="g-2">
            <Col xs={4}>
              <div className="dl-kpi-tile dl-kpi-tile--danger">
                <div className="dl-kpi-value">{alertStats.unresolvedCount}</div>
                <div className="dl-kpi-label">未解決アラート</div>
              </div>
            </Col>
            <Col xs={8}>
              <div className="dl-badge-row h-100">
                {alertStats.byType.near_expiry ? (
                  <Link to="/alerts?tab=unresolved&type=near_expiry" className="text-decoration-none">
                    <Badge bg="danger">{`期限切迫 ${alertStats.byType.near_expiry}`}</Badge>
                  </Link>
                ) : null}
                {alertStats.byType.excess_stock ? (
                  <Link to="/alerts?tab=unresolved&type=excess_stock" className="text-decoration-none">
                    <Badge bg="warning" text="dark">{`過剰在庫 ${alertStats.byType.excess_stock}`}</Badge>
                  </Link>
                ) : null}
              </div>
            </Col>
          </Row>
        </AppDataPanel>
      )}

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
        onRefresh={refreshTimeline}
        className="flex-grow-1"
      />
      </ScrollArea>
    </PageShell>
  );
}
