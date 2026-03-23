import { useEffect, useState } from 'react';
import AppTable from '../../components/ui/AppTable';
import AppAlert from '../../components/ui/AppAlert';
import { Badge, ListGroup } from 'react-bootstrap';
import AppCard from '../../components/ui/AppCard';
import { api } from '../../api/client';
import AppSelect from '../../components/ui/AppSelect';
import InlineLoader from '../../components/ui/InlineLoader';
import LoadingButton from '../../components/ui/LoadingButton';
import AppControl from '../../components/ui/AppControl';
import AppMobileDataCard from '../../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../../components/ui/AppResponsiveSwitch';
import { formatDateTimeJa } from '../../utils/formatters';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';

interface UserRequestItem {
  id: number;
  pharmacyId: number;
  pharmacyName: string;
  requestText: string;
  openclawStatus: string;
  openclawThreadId: string | null;
  openclawSummary: string | null;
  createdAt: string | null;
  retryJob: {
    id: number;
    status: string;
    attemptCount: number;
    maxAttempts: number;
    nextRetryAt: string | null;
    lastAttemptAt: string | null;
    completedAt: string | null;
    lastError: string | null;
    triggerReason: string | null;
    updatedAt: string | null;
  } | null;
  recentEvents: Array<{
    id: number;
    eventType: string;
    fromStatus: string | null;
    toStatus: string | null;
    threadId: string | null;
    summary: string | null;
    note: string | null;
    createdAt: string | null;
  }>;
}

interface UserRequestsResponse {
  data: UserRequestItem[];
  connector?: {
    configured: boolean;
    webhookConfigured: boolean;
    implementationBranch: string;
  };
}

interface RequestHandoffResponse {
  message: string;
  handoff: {
    accepted: boolean;
    connectorConfigured: boolean;
    implementationBranch: string;
    status: string;
    note: string;
  };
}

interface RetryQueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

interface RetryJobItem {
  id: number;
  requestId: number;
  pharmacyId: number;
  pharmacyName: string;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  lastAttemptAt: string | null;
  completedAt: string | null;
  lastError: string | null;
  triggerReason: string | null;
  createdAt: string;
  updatedAt: string;
  requestText: string;
}

interface RetryJobsResponse {
  data: RetryJobItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  stats: RetryQueueStats;
}

interface RequestEventItem {
  id: number;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  threadId: string | null;
  summary: string | null;
  note: string | null;
  createdAt: string | null;
}

interface RequestEventsResponse {
  events: RequestEventItem[];
}

function openclawStatusMeta(status: string): { label: string; bg: 'secondary' | 'primary' | 'warning' | 'success' } {
  switch (status) {
    case 'in_dialogue':
      return { label: '対話中', bg: 'primary' };
    case 'implementing':
      return { label: '実装中', bg: 'warning' };
    case 'completed':
      return { label: '完了', bg: 'success' };
    case 'pending_handoff':
    default:
      return { label: '連携待ち', bg: 'secondary' };
  }
}

export default function AdminOpenClawPage() {
  const [requests, setRequests] = useState<UserRequestItem[]>([]);
  const [connectorMeta, setConnectorMeta] = useState<{
    configured: boolean;
    webhookConfigured: boolean;
    implementationBranch: string;
  } | null>(null);
  const [handoffingRequestId, setHandoffingRequestId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending_handoff' | 'in_dialogue' | 'implementing' | 'completed'>('all');
  const [searchText, setSearchText] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [expandedTimelineId, setExpandedTimelineId] = useState<number | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<RequestEventItem[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);

  // Retry queue state
  const [retryStats, setRetryStats] = useState<RetryQueueStats | null>(null);
  const [retryJobs, setRetryJobs] = useState<RetryJobItem[]>([]);
  const [retryTotal, setRetryTotal] = useState(0);
  const [retryStatusFilter, setRetryStatusFilter] = useState<'all' | 'pending' | 'processing' | 'completed' | 'failed'>('all');
  const [retryLoading, setRetryLoading] = useState(false);

  const statusCount = requests.reduce<Record<string, number>>((acc, item) => {
    acc[item.openclawStatus] = (acc[item.openclawStatus] ?? 0) + 1;
    return acc;
  }, {});

  const normalizedQuery = searchText.trim().toLowerCase();
  const filteredRequests = requests.filter((item) => {
    if (statusFilter !== 'all' && item.openclawStatus !== statusFilter) {
      return false;
    }
    if (!normalizedQuery) return true;
    const haystack = `${item.pharmacyName} ${item.requestText} ${item.openclawSummary ?? ''}`.toLowerCase();
    return haystack.includes(normalizedQuery);
  });

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const data = await api.get<UserRequestsResponse>('/admin/requests?page=1&limit=50');
      setRequests(data.data);
      setConnectorMeta(data.connector ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OpenClaw連携情報の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const fetchRetryJobs = async (statusParam: string = retryStatusFilter) => {
    setRetryLoading(true);
    try {
      const qs = statusParam !== 'all' ? `?status=${statusParam}&limit=20` : '?limit=20';
      const data = await api.get<RetryJobsResponse>(`/admin/openclaw-retries${qs}`);
      setRetryStats(data.stats);
      setRetryJobs(data.data);
      setRetryTotal(data.pagination.total);
    } catch {
      // silently fail — stats section is secondary
    } finally {
      setRetryLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
    fetchRetryJobs('all');
  }, []);

  const handleRetryStatusFilterChange = (value: string) => {
    const next = value as typeof retryStatusFilter;
    setRetryStatusFilter(next);
    fetchRetryJobs(next);
  };

  const handleRetryHandoff = async (requestId: number) => {
    setError('');
    setMessage('');
    setHandoffingRequestId(requestId);
    try {
      const result = await api.post<RequestHandoffResponse>(`/admin/requests/${requestId}/handoff`);
      setMessage(`${result.message} ${result.handoff.note}`);
      await fetchRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OpenClaw再連携に失敗しました');
    } finally {
      setHandoffingRequestId(null);
    }
  };

  const handleToggleTimeline = async (requestId: number) => {
    if (expandedTimelineId === requestId) {
      setExpandedTimelineId(null);
      setTimelineEvents([]);
      return;
    }
    setExpandedTimelineId(requestId);
    setTimelineEvents([]);
    setTimelineLoading(true);
    try {
      const result = await api.get<RequestEventsResponse>(`/admin/user-requests/${requestId}/events`);
      setTimelineEvents(result.events);
    } catch {
      setTimelineEvents([]);
    } finally {
      setTimelineLoading(false);
    }
  };

  return (
    <PageShell>
      <h4 className="page-title mb-3">OpenClaw連携</h4>

      {message && <AppAlert variant="success" onClose={() => setMessage('')} dismissible>{message}</AppAlert>}
      {error && <AppAlert variant="danger" onClose={() => setError('')} dismissible>{error}</AppAlert>}

      <ScrollArea>

      {/* リトライキュー統計カード */}
      <AppCard className="mb-3">
        <AppCard.Header>
          <div className="d-flex justify-content-between align-items-center">
            <span>リトライキュー</span>
            <LoadingButton
              size="sm"
              variant="outline-secondary"
              onClick={() => fetchRetryJobs(retryStatusFilter)}
              loading={retryLoading}
              loadingLabel="更新中..."
            >
              更新
            </LoadingButton>
          </div>
        </AppCard.Header>
        <AppCard.Body>
          {retryStats && (
            <div className="d-flex gap-2 align-items-center flex-wrap mb-3">
              <Badge bg="secondary">待機中: {retryStats.pending}</Badge>
              <Badge bg="primary">実行中: {retryStats.processing}</Badge>
              <Badge bg="success">完了: {retryStats.completed}</Badge>
              <Badge bg="danger">失敗: {retryStats.failed}</Badge>
              <span className="text-muted small">合計: {retryTotal}件</span>
            </div>
          )}

          <div className="mb-3">
            <AppSelect
              size="sm"
              value={retryStatusFilter}
              ariaLabel="リトライジョブ状態で絞り込み"
              onChange={handleRetryStatusFilterChange}
              className="filter-select-compact"
              options={[
                { value: 'all', label: 'すべて' },
                { value: 'pending', label: '待機中' },
                { value: 'processing', label: '実行中' },
                { value: 'completed', label: '完了' },
                { value: 'failed', label: '失敗' },
              ]}
            />
          </div>

          {retryLoading ? (
            <InlineLoader text="読み込み中..." className="text-muted small" />
          ) : retryJobs.length === 0 ? (
            <div className="text-muted small">リトライジョブはありません。</div>
          ) : (
            <div className="table-responsive">
              <AppTable size="sm" className="mb-0">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>要望ID</th>
                    <th>薬局</th>
                    <th>状態</th>
                    <th>試行</th>
                    <th>次回予定</th>
                    <th>最終エラー</th>
                    <th>更新日時</th>
                  </tr>
                </thead>
                <tbody>
                  {retryJobs.map((job) => {
                    const meta = retryStatusMeta(job.status);
                    return (
                      <tr key={job.id}>
                        <td>{job.id}</td>
                        <td>{job.requestId}</td>
                        <td className="small">{job.pharmacyName}</td>
                        <td><Badge bg={meta.bg}>{meta.label}</Badge></td>
                        <td className="small">{job.attemptCount}/{job.maxAttempts}</td>
                        <td className="small">
                          {job.nextRetryAt ? formatDateTimeJa(job.nextRetryAt) : '-'}
                        </td>
                        <td className="small text-danger">
                          {job.lastError ? (
                            <span title={job.lastError}>
                              {job.lastError.length > 60 ? `${job.lastError.slice(0, 60)}…` : job.lastError}
                            </span>
                          ) : '-'}
                        </td>
                        <td className="small">{formatDateTimeJa(job.updatedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </AppTable>
            </div>
          )}
        </AppCard.Body>
      </AppCard>

      <AppCard>
        <AppCard.Header>要望一覧（管理者専用）</AppCard.Header>
        <AppCard.Body>
          <div className="small text-muted mb-2">
            Connector: {connectorMeta?.configured ? '接続済み' : '未接続'} /
            Webhook: {connectorMeta?.webhookConfigured ? '設定済み' : '未設定'} /
            実装許可ブランチ: <code>{connectorMeta?.implementationBranch ?? 'review'}</code>
          </div>

          <div className="d-flex gap-2 align-items-center flex-wrap mb-3">
            <Badge bg="secondary">連携待ち: {statusCount.pending_handoff ?? 0}</Badge>
            <Badge bg="primary">対話中: {statusCount.in_dialogue ?? 0}</Badge>
            <Badge bg="warning" text="dark">実装中: {statusCount.implementing ?? 0}</Badge>
            <Badge bg="success">完了: {statusCount.completed ?? 0}</Badge>
          </div>

          <div className="d-flex gap-2 flex-wrap mb-3">
            <AppSelect
              size="sm"
              value={statusFilter}
              ariaLabel="OpenClaw状態で絞り込み"
              onChange={(value) => setStatusFilter(value as typeof statusFilter)}
              className="filter-select-compact"
              options={[
                { value: 'all', label: 'すべての状態' },
                { value: 'pending_handoff', label: '連携待ち' },
                { value: 'in_dialogue', label: '対話中' },
                { value: 'implementing', label: '実装中' },
                { value: 'completed', label: '完了' },
              ]}
            />
            <AppControl
              size="sm"
              placeholder="薬局名・要望内容で検索"
              value={searchText}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchText(e.target.value)}
              className="filter-input-compact"
            />
          </div>

          {loading ? (
            <InlineLoader text="読み込み中..." className="text-muted small" />
          ) : filteredRequests.length === 0 ? (
            <div className="text-muted small">
              {requests.length === 0 ? '受信した要望はまだありません。' : '条件に一致する要望はありません。'}
            </div>
          ) : (
            <AppResponsiveSwitch
              desktop={() => (
                <div className="table-responsive">
                  <AppTable striped size="sm" className="mobile-table mb-0">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>薬局</th>
                        <th>要望内容</th>
                        <th>OpenClaw状態</th>
                        <th>Retry</th>
                        <th>受付日時</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRequests.map((item) => {
                        const status = openclawStatusMeta(item.openclawStatus);
                        const isTimelineExpanded = expandedTimelineId === item.id;
                        return (
                          <>
                            <tr key={item.id}>
                              <td>{item.id}</td>
                              <td>{item.pharmacyName} (ID: {item.pharmacyId})</td>
                              <td className="small">
                                <div>{item.requestText}</div>
                                {item.openclawSummary && <div className="text-muted mt-1">要約: {item.openclawSummary}</div>}
                                {item.openclawThreadId && <div className="text-muted mt-1">Thread: {item.openclawThreadId}</div>}
                                {item.recentEvents.length > 0 && (
                                  <div className="text-muted mt-2">
                                    {item.recentEvents.slice(0, 3).map((event) => (
                                      <div key={event.id}>
                                        {formatDateTimeJa(event.createdAt)} {eventTypeLabel(event.eventType)}
                                        {event.note ? `: ${event.note}` : ''}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </td>
                              <td><Badge bg={status.bg}>{status.label}</Badge></td>
                              <td className="small">
                                {item.retryJob ? (
                                  <>
                                    <Badge bg={retryStatusMeta(item.retryJob.status).bg}>
                                      {retryStatusMeta(item.retryJob.status).label}
                                    </Badge>
                                    <div className="text-muted mt-1">
                                      {item.retryJob.attemptCount}/{item.retryJob.maxAttempts}
                                    </div>
                                    {item.retryJob.nextRetryAt && (
                                      <div className="text-muted">次回: {formatDateTimeJa(item.retryJob.nextRetryAt)}</div>
                                    )}
                                    {item.retryJob.lastError && (
                                      <div className="text-danger mt-1">{item.retryJob.lastError}</div>
                                    )}
                                  </>
                                ) : (
                                  <span className="text-muted small">-</span>
                                )}
                              </td>
                              <td>{formatDateTimeJa(item.createdAt)}</td>
                              <td>
                                <div className="d-flex flex-column gap-1">
                                  {item.openclawStatus === 'pending_handoff' && (
                                    <LoadingButton
                                      size="sm"
                                      variant="outline-primary"
                                      disabled={handoffingRequestId !== null && handoffingRequestId !== item.id}
                                      onClick={() => handleRetryHandoff(item.id)}
                                      loading={handoffingRequestId === item.id}
                                      loadingLabel="再連携中..."
                                    >
                                      再連携
                                    </LoadingButton>
                                  )}
                                  <LoadingButton
                                    size="sm"
                                    variant={isTimelineExpanded ? 'secondary' : 'outline-secondary'}
                                    onClick={() => handleToggleTimeline(item.id)}
                                    loading={timelineLoading && isTimelineExpanded}
                                    loadingLabel="読込中..."
                                  >
                                    {isTimelineExpanded ? '閉じる' : 'タイムライン'}
                                  </LoadingButton>
                                </div>
                              </td>
                            </tr>
                            {isTimelineExpanded && (
                              <tr key={`${item.id}-timeline`}>
                                <td colSpan={7} className="p-2 bg-light">
                                  {timelineLoading ? (
                                    <InlineLoader text="タイムライン読み込み中..." className="text-muted small" />
                                  ) : timelineEvents.length === 0 ? (
                                    <div className="text-muted small px-2">イベントはありません。</div>
                                  ) : (
                                    <ListGroup variant="flush" className="small">
                                      {timelineEvents.map((event) => (
                                        <ListGroup.Item key={event.id} className="px-2 py-1 bg-light">
                                          <span className="text-muted me-2">{formatDateTimeJa(event.createdAt)}</span>
                                          <Badge bg="secondary" className="me-2">{eventTypeLabel(event.eventType)}</Badge>
                                          {event.fromStatus && event.toStatus && (
                                            <span className="text-muted me-2">{event.fromStatus} → {event.toStatus}</span>
                                          )}
                                          {event.note && <span>{event.note}</span>}
                                        </ListGroup.Item>
                                      ))}
                                    </ListGroup>
                                  )}
                                </td>
                              </tr>
                            )}
                          </>
                        );
                      })}
                    </tbody>
                  </AppTable>
                </div>
              )}
              mobile={() => (
                <div className="dl-mobile-data-list">
                  {filteredRequests.map((item) => {
                    const status = openclawStatusMeta(item.openclawStatus);
                    return (
                      <AppMobileDataCard
                        key={item.id}
                        title={`${item.pharmacyName} (ID: ${item.pharmacyId})`}
                        subtitle={`要望ID: ${item.id}`}
                        badges={<Badge bg={status.bg}>{status.label}</Badge>}
                        fields={[
                          { label: '要望内容', value: item.requestText },
                          { label: '要約', value: item.openclawSummary || '-' },
                          { label: 'Thread', value: item.openclawThreadId || '-' },
                          { label: 'Retry', value: item.retryJob ? `${retryStatusMeta(item.retryJob.status).label} (${item.retryJob.attemptCount}/${item.retryJob.maxAttempts})` : '-' },
                          { label: 'Retry詳細', value: item.retryJob?.lastError || item.retryJob?.triggerReason || '-' },
                          { label: '履歴', value: item.recentEvents.slice(0, 3).map((event) => `${formatDateTimeJa(event.createdAt)} ${eventTypeLabel(event.eventType)}`).join(' / ') || '-' },
                          { label: '受付日時', value: formatDateTimeJa(item.createdAt) },
                        ]}
                        actions={item.openclawStatus === 'pending_handoff' ? (
                          <LoadingButton
                            size="sm"
                            variant="outline-primary"
                            disabled={handoffingRequestId !== null && handoffingRequestId !== item.id}
                            onClick={() => handleRetryHandoff(item.id)}
                            loading={handoffingRequestId === item.id}
                            loadingLabel="再連携中..."
                          >
                            再連携
                          </LoadingButton>
                        ) : (
                          <span className="text-muted small">操作不要</span>
                        )}
                      />
                    );
                  })}
                </div>
              )}
            />
          )}
        </AppCard.Body>
      </AppCard>
      </ScrollArea>
    </PageShell>
  );
}

function eventTypeLabel(eventType: string): string {
  switch (eventType) {
    case 'created':
      return '受付';
    case 'handoff_accepted':
      return '初回連携成功';
    case 'handoff_deferred':
      return '初回連携保留';
    case 'retry_scheduled':
      return '再試行予約';
    case 'retry_started':
      return '再試行開始';
    case 'retry_succeeded':
      return '再試行成功';
    case 'retry_failed':
      return '再試行失敗';
    case 'status_updated':
      return '状態更新';
    default:
      return eventType;
  }
}

function retryStatusMeta(status: string): { label: string; bg: 'secondary' | 'primary' | 'warning' | 'success' | 'danger' } {
  switch (status) {
    case 'pending':
      return { label: '待機中', bg: 'secondary' };
    case 'processing':
      return { label: '実行中', bg: 'primary' };
    case 'completed':
      return { label: '完了', bg: 'success' };
    case 'failed':
      return { label: '失敗', bg: 'danger' };
    default:
      return { label: status, bg: 'warning' };
  }
}
