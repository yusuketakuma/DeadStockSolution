import { Link } from 'react-router-dom';
import AppAlert from '../../components/ui/AppAlert';
import { Badge } from 'react-bootstrap';
import AppCard from '../../components/ui/AppCard';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';
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

export default function AdminOpenClawPage() {
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
    handoffingRequestId,
    setSelectedRequestId,
    handleRetryHandoff,
    handleIssueBootstrapToken,
    handleRotateControlToken,
  } = useAdminOpenClawData();

  return (
    <PageShell>
      <div className="dl-page-header">
        <div className="dl-page-header-copy">
          <h4 className="page-title mb-0">OpenClaw連携</h4>
        </div>
        <div className="dl-page-header-actions d-flex gap-2 flex-wrap">
          <Link to="/admin/openclaw-commands" className="btn btn-outline-secondary btn-sm">コマンド管理</Link>
        </div>
      </div>

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
      </ScrollArea>
    </PageShell>
  );
}
