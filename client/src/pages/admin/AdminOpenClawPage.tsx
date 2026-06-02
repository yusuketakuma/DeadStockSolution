import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AppAlert from '../../components/ui/AppAlert';
import { Badge } from 'react-bootstrap';
import AppCard from '../../components/ui/AppCard';
import AppDropdownMenu from '../../components/ui/AppDropdownMenu';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';
import SavedViewsPanel from '../../components/ui/SavedViewsPanel';
import WorkContextBar from '../../components/ui/WorkContextBar';
import { useListDetailRouteState } from '../../hooks/useListDetailRouteState';
import { useSavedViews } from '../../hooks/useSavedViews';
import { useTrackRecentWork } from '../../hooks/useRecentWork';
import AdminNavigationLinks, { type AdminNavigationLinkGroup } from './components/AdminNavigationLinks';
import OpenClawRuntimeDigestCard from '../../components/admin/openclaw/OpenClawRuntimeDigestCard';
import OpenClawHealthCard from '../../components/admin/openclaw/OpenClawHealthCard';
import OpenClawRetryQueueCard from '../../components/admin/openclaw/OpenClawRetryQueueCard';
import OpenClawRequestListCard from '../../components/admin/openclaw/OpenClawRequestListCard';
import OpenClawThreadCard from '../../components/admin/openclaw/OpenClawThreadCard';
import OpenClawEventTimelineCard from '../../components/admin/openclaw/OpenClawEventTimelineCard';
import { useAdminOpenClawData } from './useAdminOpenClawData';

const OPENCLAW_LINK_GROUPS: readonly AdminNavigationLinkGroup[] = [
  {
    title: '要望対応',
    description: '要望の一次確認と会話履歴の近接導線です。',
    links: [
      { to: '/admin/user-requests', label: 'ユーザーリクエスト管理' },
      { to: '/admin/openclaw-commands', label: 'コマンド管理' },
      { to: '/admin/log-center', label: 'ログセンター' },
    ],
  },
  {
    title: '周辺運用',
    description: '通知異常や監査に戻るときに使います。',
    links: [
      { to: '/admin/notifications', label: '通知・配信状況' },
      { to: '/admin/audit', label: '監査ログ' },
      { to: '/admin/rate-limits', label: 'レート制限設定' },
    ],
  },
] as const;
const ADMIN_OPENCLAW_SAVED_VIEWS_KEY = 'admin-openclaw:saved-views';

interface AdminOpenClawSavedFilters {
  statusFilter: string;
  retryStatusFilter: string;
  searchText: string;
}

export default function AdminOpenClawPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    requestedSelectedValue: requestedRequestValue,
    updateListDetailRouteState,
  } = useListDetailRouteState(searchParams, setSearchParams, { selectedParam: 'requestId', pageParam: 'page' });
  const {
    connectorMeta,
    requests,
    filteredRequests,
    workflowCount,
    loading,
    selectedRequestId,
    thread,
    threadLoading,
    events,
    eventsLoading,
    statusFilter,
    setStatusFilter,
    searchText,
    setSearchText,
    retryItems,
    retryStats,
    retryLoading,
    retryStatusFilter,
    setRetryStatusFilter,
    health,
    ddsStatus,
    bootstrapToken,
    issuingBootstrapToken,
    rotatingControlToken,
    message,
    setMessage,
    error,
    setError,
    notConfigured,
    runbookLogs,
    handoffingRequestId,
    setSelectedRequestId,
    handleRetryHandoff,
    handleIssueBootstrapToken,
    handleRotateControlToken,
    appendRunbookLog,
    updateRunbookLog,
  } = useAdminOpenClawData();
  const { savedViews, createSavedView, deleteSavedView } = useSavedViews<AdminOpenClawSavedFilters>(ADMIN_OPENCLAW_SAVED_VIEWS_KEY);
  const [wizardStep, setWizardStep] = useState(0);
  const requestedStatusFilter = searchParams.get('status') ?? 'all';
  const requestedRetryStatusFilter = searchParams.get('retryStatus') ?? 'all';
  const requestedSearchText = searchParams.get('search') ?? '';
  const requestedRequestId = Number(requestedRequestValue ?? '');
  const selectedRequest = filteredRequests.find((request) => request.id === selectedRequestId)
    ?? requests.find((request) => request.id === selectedRequestId)
    ?? null;
  const runbookActions: Array<{ title: string; description: string; to: string; tone: 'danger' | 'warning' | 'info' }> = [];
  if (!health?.connector.configured || !health?.webhook.configured) {
    runbookActions.push({
      title: '接続設定を確認',
      description: 'connector または webhook が未設定です。環境変数と接続モードを確認してください。',
      to: '/admin/log-center',
      tone: 'danger',
    });
  }
  if (ddsStatus && !ddsStatus.connected) {
    runbookActions.push({
      title: 'DDS Agent を再確認',
      description: 'bootstrap token の再発行、register URL、heartbeat の到達を確認してください。',
      to: '/admin/openclaw',
      tone: 'danger',
    });
  }
  if ((retryStats?.failed ?? 0) > 0 || (retryStats?.pending ?? 0) > 0) {
    runbookActions.push({
      title: 'retry queue を解消',
      description: `pending ${retryStats?.pending ?? 0} / failed ${retryStats?.failed ?? 0} 件があります。失敗理由と再試行条件を確認してください。`,
      to: '/admin/openclaw',
      tone: 'warning',
    });
  }
  if ((ddsStatus?.awaitingUser ?? 0) > 0) {
    runbookActions.push({
      title: '回答待ち案件を片付ける',
      description: `${ddsStatus?.awaitingUser ?? 0} 件の user 待ち案件があります。必要なら管理者返信で unblock してください。`,
      to: '/admin/user-requests',
      tone: 'info',
    });
  }
  const runbookWizardSteps = useMemo(() => [
    {
      title: '1. 状態確認',
      description: 'connector / webhook / DDS / retry queue の現在値を確認します。',
      action: 'HealthCard / RuntimeDigest / RetryQueue を確認',
    },
    {
      title: '2. 接続回復',
      description: 'DDS 未接続なら bootstrap token を発行し、register / heartbeat を確認します。',
      action: '必要なら bootstrap token を発行',
    },
    {
      title: '3. 詰まり解消',
      description: 'retry queue と awaiting user を request list で解消します。',
      action: '対象 request を選んで thread / timeline を確認',
    },
    {
      title: '4. 結果記録',
      description: 'runbook log に成功/失敗と結果要約を残します。',
      action: 'runbook 実行履歴を更新',
    },
  ], []);

  useEffect(() => {
    if (requestedStatusFilter !== statusFilter) {
      setStatusFilter(requestedStatusFilter as typeof statusFilter);
    }
    if (requestedRetryStatusFilter !== retryStatusFilter) {
      setRetryStatusFilter(requestedRetryStatusFilter as typeof retryStatusFilter);
    }
    if (requestedSearchText !== searchText) {
      setSearchText(requestedSearchText);
    }
    if (Number.isInteger(requestedRequestId) && requestedRequestId > 0 && requestedRequestId !== selectedRequestId) {
      setSelectedRequestId(requestedRequestId);
    }
  }, [requestedRequestId, requestedRetryStatusFilter, requestedSearchText, requestedStatusFilter, retryStatusFilter, searchText, selectedRequestId, setRetryStatusFilter, setSearchText, setSelectedRequestId, setStatusFilter, statusFilter]);

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams);
    if (statusFilter !== 'all') nextParams.set('status', statusFilter);
    else nextParams.delete('status');
    if (retryStatusFilter !== 'all') nextParams.set('retryStatus', retryStatusFilter);
    else nextParams.delete('retryStatus');
    if (searchText) nextParams.set('search', searchText);
    else nextParams.delete('search');
    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [retryStatusFilter, searchParams, searchText, setSearchParams, statusFilter]);

  useEffect(() => {
    updateListDetailRouteState({ selected: selectedRequestId });
  }, [selectedRequestId, updateListDetailRouteState]);

  useTrackRecentWork(selectedRequest ? {
    id: `openclaw-request-${selectedRequest.id}`,
    label: `OpenClaw request #${selectedRequest.id}`,
    to: `/admin/openclaw?requestId=${selectedRequest.id}${statusFilter !== 'all' ? `&status=${encodeURIComponent(statusFilter)}` : ''}`,
    section: 'OpenClaw',
    subtitle: selectedRequest.latestSummary ?? selectedRequest.openclawSummary ?? selectedRequest.workflowStatus ?? selectedRequest.requestText,
  } : null);

  return (
    <PageShell>
      <div className="dl-page-header">
        <div className="dl-page-header-copy">
          <h4 className="page-title mb-0">OpenClaw連携</h4>
        </div>
        <div className="dl-action-row mobile-stack">
          <Link to="/admin/openclaw-commands" className="btn btn-outline-primary btn-sm">コマンド管理</Link>
          <AppDropdownMenu
            label="関連"
            size="sm"
            variant="outline-secondary"
            items={[
              { label: 'ログセンター', to: '/admin/log-center' },
              { label: 'レート制限設定', to: '/admin/rate-limits' },
            ]}
          />
        </div>
      </div>

      <WorkContextBar
        title={selectedRequest ? `OpenClaw request #${selectedRequest.id} を処理中` : 'OpenClaw 運用キューを確認中'}
        currentLabel={selectedRequest ? selectedRequest.latestSummary ?? selectedRequest.openclawSummary ?? selectedRequest.workflowStatus ?? selectedRequest.requestText : 'retry queue / DDS / request handoff を横断して確認'}
        description="状態確認、runbook 実行、retry queue、thread 参照をひとつの流れで進めます。"
        backTo="/admin"
        backLabel="管理ダッシュボードへ"
        badges={[
          { label: `workflow ${requests.length}`, bg: 'secondary' },
          retryStats ? { label: `retry failed ${retryStats.failed}`, bg: retryStats.failed > 0 ? 'danger' : 'secondary' } : null,
          ddsStatus?.connected ? { label: 'DDS 接続中', bg: 'success' } : { label: 'DDS 要確認', bg: 'warning', text: 'dark' },
        ]}
        nextActions={[
          { to: '/admin/user-requests', label: '要望一覧', variant: 'outline-primary' },
          { to: '/admin/log-center', label: 'ログセンター', variant: 'outline-secondary' },
          { to: '/admin/openclaw-commands', label: 'コマンド管理', variant: 'outline-secondary' },
        ]}
      />

      {message && <AppAlert variant="success" onClose={() => setMessage('')} dismissible>{message}</AppAlert>}
      {error && <AppAlert variant="danger" onClose={() => setError('')} dismissible>{error}</AppAlert>}

      {notConfigured && (
        <AppCard className="mb-3">
          <AppCard.Body>
            <div className="d-flex align-items-center gap-2 mb-2">
              <Badge bg="secondary">未設定</Badge>
              <span className="fw-semibold">OpenClaw 連携は設定されていません</span>
            </div>
            <div className="text-muted small">
              OpenClaw 連携を有効にするには、サーバー側で
              <code className="mx-1">OPENCLAW_WEBHOOK_SECRET</code>
              などの環境変数を設定してください。設定後にページを再読み込みすると連携状態が反映されます。
            </div>
          </AppCard.Body>
        </AppCard>
      )}

      <ScrollArea>
      <AdminNavigationLinks groups={OPENCLAW_LINK_GROUPS} />
      <SavedViewsPanel
        description="状態フィルタと検索条件を保存できます。"
        shareUrl={typeof window !== 'undefined' ? window.location.href : null}
        savedViews={savedViews}
        presets={[
          {
            key: 'openclaw-all',
            name: '全体監視',
            description: '全 request / retry を表示します。',
            filters: { statusFilter: 'all', retryStatusFilter: 'all', searchText: '' },
          },
          {
            key: 'openclaw-failed',
            name: '失敗/再試行',
            description: '失敗や retry を優先します。',
            filters: { statusFilter: 'failed', retryStatusFilter: 'failed', searchText: '' },
          },
          {
            key: 'openclaw-awaiting-user',
            name: '回答待ち',
            description: 'ユーザー回答待ちの案件に絞ります。',
            filters: { statusFilter: 'awaiting_user', retryStatusFilter: 'all', searchText: '' },
          },
        ]}
        onSave={() => {
          const name = window.prompt('保存ビュー名を入力してください');
          if (!name) return;
          createSavedView(name, {
            statusFilter,
            retryStatusFilter,
            searchText,
          });
        }}
        onApply={(filters) => {
          setStatusFilter(filters.statusFilter as typeof statusFilter);
          setRetryStatusFilter(filters.retryStatusFilter as typeof retryStatusFilter);
          setSearchText(filters.searchText);
        }}
        onDelete={deleteSavedView}
      />

      <AppCard className="mb-3">
        <AppCard.Header>step-by-step runbook</AppCard.Header>
        <AppCard.Body className="d-flex flex-column gap-3">
          <div className="dl-action-row">
            {runbookWizardSteps.map((step, index) => (
              <button
                key={step.title}
                type="button"
                className={`btn btn-sm ${wizardStep === index ? 'btn-primary' : 'btn-outline-secondary'}`}
                onClick={() => setWizardStep(index)}
              >
                {step.title}
              </button>
            ))}
          </div>
          <div className="border rounded p-3">
            <div className="fw-semibold">{runbookWizardSteps[wizardStep]?.title}</div>
            <div className="small text-muted mt-2">{runbookWizardSteps[wizardStep]?.description}</div>
            <div className="small mt-2">次の操作: {runbookWizardSteps[wizardStep]?.action}</div>
          </div>
          <div className="dl-action-row mobile-stack">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => setWizardStep((current) => Math.max(0, current - 1))}
              disabled={wizardStep === 0}
            >
              前へ
            </button>
            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              onClick={() => setWizardStep((current) => Math.min(runbookWizardSteps.length - 1, current + 1))}
              disabled={wizardStep === runbookWizardSteps.length - 1}
            >
              次へ
            </button>
          </div>
        </AppCard.Body>
      </AppCard>

      {runbookActions.length > 0 && (
        <AppCard className="mb-3">
          <AppCard.Header>対処テンプレ</AppCard.Header>
          <AppCard.Body className="d-flex flex-column gap-2">
            {runbookActions.map((action) => (
              <div key={action.title} className="border rounded p-3">
                <div className="d-flex justify-content-between align-items-start gap-2 flex-wrap">
                  <div>
                    <div className="fw-semibold">{action.title}</div>
                    <div className="small text-muted mt-1">{action.description}</div>
                  </div>
                  <span className={`badge ${
                    action.tone === 'danger'
                      ? 'bg-danger'
                      : action.tone === 'warning'
                        ? 'bg-warning text-dark'
                        : 'bg-info text-dark'
                  }`}
                  >
                    {action.tone === 'danger' ? '優先' : action.tone === 'warning' ? '確認' : '運用'}
                  </span>
                </div>
                <div className="mt-2">
                  <div className="dl-action-row mobile-stack">
                    <Link to={action.to} className="btn btn-sm btn-outline-primary">対応画面を開く</Link>
                    <AppDropdownMenu
                      label="その他"
                      size="sm"
                      variant="outline-secondary"
                      items={[
                        action.title === 'DDS Agent を再確認'
                          ? {
                              key: 'bootstrap-token',
                              label: 'bootstrap token を発行',
                              onClick: () => {
                                void (async () => {
                                  const log = await appendRunbookLog('bootstrap token 発行', 'runbook から DDS agent の bootstrap token を発行', 'started');
                                  try {
                                    await handleIssueBootstrapToken();
                                    await updateRunbookLog(log.id, {
                                      status: 'success',
                                      resultSummary: 'bootstrap token 発行完了',
                                    });
                                  } catch (err) {
                                    await updateRunbookLog(log.id, {
                                      status: 'failed',
                                      resultSummary: err instanceof Error ? err.message : 'bootstrap token 発行失敗',
                                    });
                                  }
                                })();
                              },
                            }
                          : {
                              key: 'record-start',
                              label: '実行開始を記録',
                              onClick: () => {
                                void appendRunbookLog(`${action.title} を開始`, action.description, 'started');
                              },
                            },
                      ]}
                    />
                  </div>
                </div>
              </div>
            ))}
          </AppCard.Body>
        </AppCard>
      )}

      <AppCard className="mb-3">
        <AppCard.Header>action catalog</AppCard.Header>
        <AppCard.Body className="d-flex flex-column gap-2 small">
          <div className="border rounded p-3">
            <div className="fw-semibold">1. connector / webhook を確認</div>
            <div className="text-muted">設定不備がある場合は最初に `/admin/log-center` と環境変数設定を確認します。</div>
          </div>
          <div className="border rounded p-3">
            <div className="fw-semibold">2. DDS Agent を再接続</div>
            <div className="text-muted">未接続なら bootstrap token を発行し、register / heartbeat が通るか確認します。</div>
          </div>
          <div className="border rounded p-3">
            <div className="fw-semibold">3. retry queue と waiting user を確認</div>
            <div className="text-muted">pending/failed queue と awaiting user 件数を見て、詰まりを request 側で解消します。</div>
          </div>
        </AppCard.Body>
      </AppCard>

      {runbookLogs.length > 0 && (
        <AppCard className="mb-3">
          <AppCard.Header>runbook 実行履歴</AppCard.Header>
          <AppCard.Body className="d-flex flex-column gap-2">
            {runbookLogs.map((entry) => (
              <div key={entry.id} className="small border-bottom pb-2">
                <div className="fw-semibold">{entry.action}</div>
                {entry.detail ? <div className="text-muted">{entry.detail}</div> : null}
                <div className="text-muted">status: {entry.status}</div>
                {entry.resultSummary ? <div className="text-muted">{entry.resultSummary}</div> : null}
                <div className="text-muted">{entry.createdAt}</div>
              </div>
            ))}
          </AppCard.Body>
        </AppCard>
      )}
      <OpenClawHealthCard
        health={health}
        ddsStatus={ddsStatus}
        bootstrapToken={bootstrapToken}
        issuingBootstrapToken={issuingBootstrapToken}
        rotatingControlToken={rotatingControlToken}
        onIssueBootstrapToken={() => void handleIssueBootstrapToken()}
        onRotateControlToken={() => void handleRotateControlToken()}
      />

      <OpenClawRuntimeDigestCard digest={ddsStatus?.runtimeDigest ?? null} />

      <OpenClawRetryQueueCard
        retryItems={retryItems}
        retryStats={retryStats}
        retryLoading={retryLoading}
        retryStatusFilter={retryStatusFilter}
        onRetryStatusFilterChange={(value) => setRetryStatusFilter(value as typeof retryStatusFilter)}
      />
      <div className={`dl-two-pane-grid${selectedRequestId ? ' dl-pane-detail-active' : ''}`}>
        <div className="dl-stack-gap-md">
          <OpenClawRequestListCard
            connectorMeta={connectorMeta}
            requests={requests}
            filteredRequests={filteredRequests}
            workflowCount={workflowCount}
            loading={loading}
            statusFilter={statusFilter}
            searchText={searchText}
            handoffingRequestId={handoffingRequestId}
            onStatusFilterChange={(value) => setStatusFilter(value as typeof statusFilter)}
            onSearchTextChange={(e) => setSearchText(e.target.value)}
            onSelectRequest={setSelectedRequestId}
            onRetryHandoff={handleRetryHandoff}
          />
        </div>
        <div className="dl-stack-gap-md">
          <OpenClawThreadCard
            selectedRequestId={selectedRequestId}
            threadLoading={threadLoading}
            thread={thread}
          />

          <OpenClawEventTimelineCard
            selectedRequestId={selectedRequestId}
            eventsLoading={eventsLoading}
            events={events}
          />
        </div>
      </div>
      </ScrollArea>
    </PageShell>
  );
}
