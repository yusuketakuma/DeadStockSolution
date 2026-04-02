import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AppTable from '../../components/ui/AppTable';
import AppAlert from '../../components/ui/AppAlert';
import { Badge } from 'react-bootstrap';
import AppCard from '../../components/ui/AppCard';
import { api, ApiError } from '../../api/client';
import AppSelect from '../../components/ui/AppSelect';
import InlineLoader from '../../components/ui/InlineLoader';
import LoadingButton from '../../components/ui/LoadingButton';
import AppControl from '../../components/ui/AppControl';
import AppMobileDataCard from '../../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../../components/ui/AppResponsiveSwitch';
import { useSseRefresh } from '../../hooks/useSseRefresh';
import { formatDateTimeJa } from '../../utils/formatters';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';

function isNotConfiguredError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 503;
}

const LIVE_REFRESH_INTERVAL_MS = 60_000;

interface UserRequestItem {
  id: number;
  pharmacyId: number;
  pharmacyName: string;
  requestText: string;
  openclawStatus: string;
  openclawThreadId: string | null;
  openclawSummary: string | null;
  workflowStatus: string | null;
  latestSummary: string | null;
  branchName: string | null;
  prUrl: string | null;
  prNumber: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface RequestMessageItem {
  id: number;
  authorType: 'user' | 'openclaw_agent' | 'system' | 'admin';
  messageType: 'message' | 'question' | 'status_update' | 'pr_report';
  body: string;
  createdAt: string | null;
}

interface RequestThreadResponse {
  request: UserRequestItem & {
    lastQuestion?: string | null;
    lastError?: string | null;
  };
  messages: RequestMessageItem[];
}

interface RequestEventItem {
  id: number;
  eventType: string;
  createdAt: string | null;
  summary: string | null;
  note: string | null;
}

interface UserRequestsResponse {
  data: UserRequestItem[];
  connector?: {
    configured: boolean;
    webhookConfigured: boolean;
    implementationBranch: string;
  };
}

interface OpenClawRetryItem {
  id: number;
  requestId: number;
  pharmacyId: number;
  pharmacyName: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attemptCount: number;
  maxAttempts: number;
  nextRetryAt: string | null;
  lastAttemptAt: string | null;
  completedAt: string | null;
  lastError: string | null;
  triggerReason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  requestText: string | null;
}

interface OpenClawRetryResponse {
  data: OpenClawRetryItem[];
  pagination: { page: number; totalPages: number; total: number };
  stats?: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  };
}

interface OpenClawHealthSnapshot {
  status: 'ok' | 'degraded';
  timestamp: string;
  connector: { configured: boolean; mode: string };
  webhook: { configured: boolean };
  commands: { enabled: boolean };
  logPush: { enabled: boolean };
  autoFix: { enabled: boolean };
  autoEscalate: { enabled: boolean };
  retryQueue: { pending: number; processing: number; completed: number; failed: number };
  handoffSuccessRate: number | null;
  lastHandoffAt: string | null;
  ddsAgent: {
    connected: boolean;
    agentId: string | null;
    lastSeenAt: string | null;
    queuedJobs: number;
    awaitingUser: number;
  };
}

interface DdsAgentStatus {
  environment: string;
  connected: boolean;
  agentId: string | null;
  agentName: string | null;
  lastSeenAt: string | null;
  queuedJobs: number;
  awaitingUser: number;
  latestPrUrl: string | null;
}

interface BootstrapTokenResponse {
  data: {
    token: string;
    expiresAt: string;
    environment: string;
    registerUrl: string;
    callbackUrl: string;
    reportUrl: string;
    commandsUrl: string;
    healthUrl: string;
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

function workflowStatusMeta(status: string | null): { label: string; bg: 'secondary' | 'primary' | 'warning' | 'success' | 'danger' } {
  switch (status) {
    case 'awaiting_user':
      return { label: '回答待ち', bg: 'primary' };
    case 'implementing':
      return { label: '実装中', bg: 'warning' };
    case 'pr_opened':
      return { label: 'PR作成済み', bg: 'warning' };
    case 'completed':
      return { label: '完了', bg: 'success' };
    case 'failed':
      return { label: '失敗', bg: 'danger' };
    case 'analyzing':
      return { label: '解析中', bg: 'secondary' };
    case 'queued':
    default:
      return { label: '受付済み', bg: 'secondary' };
  }
}

export default function AdminOpenClawPage() {
  const [requests, setRequests] = useState<UserRequestItem[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
  const [thread, setThread] = useState<RequestThreadResponse | null>(null);
  const [connectorMeta, setConnectorMeta] = useState<{
    configured: boolean;
    webhookConfigured: boolean;
    implementationBranch: string;
  } | null>(null);
  const [handoffingRequestId, setHandoffingRequestId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [events, setEvents] = useState<RequestEventItem[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'queued' | 'analyzing' | 'awaiting_user' | 'implementing' | 'pr_opened' | 'completed' | 'failed'>('all');
  const [retryStatusFilter, setRetryStatusFilter] = useState<'all' | 'pending' | 'processing' | 'completed' | 'failed'>('all');
  const [searchText, setSearchText] = useState('');
  const [retryItems, setRetryItems] = useState<OpenClawRetryItem[]>([]);
  const [retryStats, setRetryStats] = useState<OpenClawRetryResponse['stats'] | null>(null);
  const [retryLoading, setRetryLoading] = useState(false);
  const [health, setHealth] = useState<OpenClawHealthSnapshot | null>(null);
  const [ddsStatus, setDdsStatus] = useState<DdsAgentStatus | null>(null);
  const [bootstrapToken, setBootstrapToken] = useState<BootstrapTokenResponse['data'] | null>(null);
  const [issuingBootstrapToken, setIssuingBootstrapToken] = useState(false);
  const [rotatingControlToken, setRotatingControlToken] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [notConfigured, setNotConfigured] = useState(false);

  const workflowCount = requests.reduce<Record<string, number>>((acc, item) => {
    const key = item.workflowStatus ?? 'queued';
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const normalizedQuery = searchText.trim().toLowerCase();
  const filteredRequests = requests.filter((item) => {
    if (statusFilter !== 'all' && item.workflowStatus !== statusFilter) {
      return false;
    }
    if (!normalizedQuery) return true;
    const haystack = `${item.pharmacyName} ${item.requestText} ${item.latestSummary ?? ''} ${item.openclawSummary ?? ''}`.toLowerCase();
    return haystack.includes(normalizedQuery);
  });

  const fetchRequests = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (!background) {
      setLoading(true);
    }
    try {
      const data = await api.get<UserRequestsResponse>('/admin/requests?page=1&limit=50');
      setRequests(data.data);
      setConnectorMeta(data.connector ?? null);
      setNotConfigured(false);
      setSelectedRequestId((current) => {
        if (current && data.data.some((item) => item.id === current)) {
          return current;
        }
        return data.data[0]?.id ?? null;
      });
    } catch (err) {
      if (isNotConfiguredError(err)) {
        if (!background) setNotConfigured(true);
      } else if (!background) {
        setError(err instanceof Error ? err.message : 'OpenClaw連携情報の取得に失敗しました');
      }
    } finally {
      if (!background) {
        setLoading(false);
      }
    }
  }, []);

  const fetchThread = useCallback(async (requestId: number, { background = false }: { background?: boolean } = {}) => {
    if (!background) {
      setThreadLoading(true);
    }

    try {
      const data = await api.get<RequestThreadResponse>(`/admin/requests/${requestId}/messages`);
      setThread(data);
    } catch (err) {
      if (!background) {
        setError(err instanceof Error ? err.message : '会話履歴の取得に失敗しました');
      }
    } finally {
      if (!background) {
        setThreadLoading(false);
      }
    }
  }, []);

  const fetchEvents = useCallback(async (requestId: number, { background = false }: { background?: boolean } = {}) => {
    if (!background) {
      setEventsLoading(true);
    }
    try {
      const data = await api.get<{ events: RequestEventItem[] }>(`/admin/user-requests/${requestId}/events`);
      setEvents(data.events);
    } catch (err) {
      if (!background) {
        setError(err instanceof Error ? err.message : 'イベント履歴の取得に失敗しました');
      }
    } finally {
      if (!background) {
        setEventsLoading(false);
      }
    }
  }, []);

  const fetchRetryQueue = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (!background) {
      setRetryLoading(true);
    }
    try {
      const suffix = retryStatusFilter === 'all' ? '' : `&status=${retryStatusFilter}`;
      const data = await api.get<OpenClawRetryResponse>(`/admin/openclaw-retries?page=1&limit=20${suffix}`);
      setRetryItems(data.data);
      setRetryStats(data.stats ?? null);
    } catch (err) {
      if (isNotConfiguredError(err)) {
        // リトライキューは未設定時も503を返す — エラーバナーは出さない
      } else if (!background) {
        setError(err instanceof Error ? err.message : 'リトライキューの取得に失敗しました');
      }
    } finally {
      if (!background) {
        setRetryLoading(false);
      }
    }
  }, [retryStatusFilter]);

  const fetchHealth = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    try {
      const [healthData, ddsData] = await Promise.all([
        api.get<OpenClawHealthSnapshot>('/health/openclaw'),
        api.get<{ data: DdsAgentStatus }>('/admin/openclaw/dds-agent'),
      ]);
      setHealth(healthData);
      setDdsStatus(ddsData.data);
      setNotConfigured(false);
    } catch (err) {
      if (isNotConfiguredError(err)) {
        if (!background) setNotConfigured(true);
      } else if (!background) {
        setError(err instanceof Error ? err.message : 'OpenClawヘルス情報の取得に失敗しました');
      }
    }
  }, []);

  useEffect(() => {
    void fetchRequests();
    void fetchRetryQueue();
    void fetchHealth();
  }, [fetchHealth, fetchRequests, fetchRetryQueue]);

  useEffect(() => {
    if (!selectedRequestId) {
      setThread(null);
      setEvents([]);
      return;
    }
    void fetchThread(selectedRequestId);
    void fetchEvents(selectedRequestId);
  }, [fetchEvents, fetchThread, selectedRequestId]);

  useEffect(() => {
    void fetchRetryQueue();
  }, [fetchRetryQueue]);

  useSseRefresh({
    enabled: true,
    streamPath: '/realtime/stream?topics=admin_requests',
    events: ['admin_requests.refresh'],
    onRefresh: async () => {
    await fetchRequests({ background: true });
    await fetchRetryQueue({ background: true });
    await fetchHealth({ background: true });
    if (selectedRequestId) {
      await fetchThread(selectedRequestId, { background: true });
      await fetchEvents(selectedRequestId, { background: true });
    }
    },
    fallbackIntervalMs: LIVE_REFRESH_INTERVAL_MS,
    minFetchIntervalMs: 4_000,
  });

  const handleRetryHandoff = async (requestId: number) => {
    setError('');
    setMessage('');
    setHandoffingRequestId(requestId);
    try {
      const result = await api.post<RequestHandoffResponse>(`/admin/requests/${requestId}/handoff`);
      setMessage(`${result.message} ${result.handoff.note}`);
      await fetchRequests();
      if (selectedRequestId === requestId) {
        const threadData = await api.get<RequestThreadResponse>(`/admin/requests/${requestId}/messages`);
        setThread(threadData);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OpenClaw再連携に失敗しました');
    } finally {
      setHandoffingRequestId(null);
    }
  };

  const handleIssueBootstrapToken = async () => {
    setIssuingBootstrapToken(true);
    setError('');
    try {
      const result = await api.post<BootstrapTokenResponse>('/admin/openclaw/bootstrap-token', {});
      setBootstrapToken(result.data);
      setMessage('DDS bootstrap token を発行しました');
      await fetchHealth({ background: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'bootstrap token の発行に失敗しました');
    } finally {
      setIssuingBootstrapToken(false);
    }
  };

  const handleRotateControlToken = async () => {
    setRotatingControlToken(true);
    setError('');
    try {
      const result = await api.post<{ message: string }>('/admin/openclaw/control-token/rotate', {});
      setMessage(result.message);
      await fetchHealth({ background: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'control token のローテーションに失敗しました');
    } finally {
      setRotatingControlToken(false);
    }
  };

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
      <AppCard className="mb-3">
        <AppCard.Header>DDS / OpenClaw ヘルス</AppCard.Header>
        <AppCard.Body>
          <div className="d-flex gap-2 flex-wrap mb-3">
            <Badge bg={health?.status === 'ok' ? 'success' : 'warning'}>{health?.status === 'ok' ? '稼働中' : '要確認'}</Badge>
            <Badge bg={health?.connector.configured ? 'success' : 'secondary'}>Connector {health?.connector.configured ? '接続済み' : '未接続'}</Badge>
            <Badge bg={health?.webhook.configured ? 'success' : 'secondary'}>Webhook {health?.webhook.configured ? '設定済み' : '未設定'}</Badge>
            <Badge bg={ddsStatus?.connected ? 'success' : 'secondary'}>DDS {ddsStatus?.connected ? '接続中' : '未接続'}</Badge>
          </div>
          <div className="small text-muted mb-3">
            最終 handoff: {formatDateTimeJa(health?.lastHandoffAt)} / 成功率: {health?.handoffSuccessRate != null ? `${Math.round(health.handoffSuccessRate * 100)}%` : '-'}
          </div>
          <div className="row g-2 mb-3">
            <div className="col-md-3 col-6"><AppMobileDataCard title="保留ジョブ" fields={[{ label: 'pending', value: health?.retryQueue.pending ?? 0 }, { label: 'processing', value: health?.retryQueue.processing ?? 0 }]} /></div>
            <div className="col-md-3 col-6"><AppMobileDataCard title="DDS状態" fields={[{ label: 'agentId', value: ddsStatus?.agentId ?? '-' }, { label: 'lastSeen', value: formatDateTimeJa(ddsStatus?.lastSeenAt) }]} /></div>
            <div className="col-md-3 col-6"><AppMobileDataCard title="待機ジョブ" fields={[{ label: 'queued', value: ddsStatus?.queuedJobs ?? 0 }, { label: 'awaiting', value: ddsStatus?.awaitingUser ?? 0 }]} /></div>
            <div className="col-md-3 col-6"><AppMobileDataCard title="feature flags" fields={[{ label: 'commands', value: health?.commands.enabled ? 'ON' : 'OFF' }, { label: 'autoFix', value: health?.autoFix.enabled ? 'ON' : 'OFF' }]} /></div>
          </div>
          <div className="d-flex gap-2 flex-wrap">
            <LoadingButton
              size="sm"
              variant="outline-primary"
              onClick={() => void handleIssueBootstrapToken()}
              loading={issuingBootstrapToken}
              loadingLabel="発行中..."
            >
              bootstrap token 発行
            </LoadingButton>
            <LoadingButton
              size="sm"
              variant="outline-secondary"
              onClick={() => void handleRotateControlToken()}
              loading={rotatingControlToken}
              loadingLabel="更新中..."
            >
              control token ローテーション
            </LoadingButton>
          </div>
          {bootstrapToken ? (
            <div className="mt-3 small">
              <div className="fw-semibold">最新 bootstrap token</div>
              <div className="text-break"><code>{bootstrapToken.token}</code></div>
              <div className="text-muted">有効期限: {formatDateTimeJa(bootstrapToken.expiresAt)}</div>
              <div className="text-muted text-break">register: {bootstrapToken.registerUrl}</div>
              <div className="text-muted text-break">health: {bootstrapToken.healthUrl}</div>
            </div>
          ) : null}
        </AppCard.Body>
      </AppCard>

      <AppCard className="mb-3">
        <AppCard.Header>Retry Queue</AppCard.Header>
        <AppCard.Body>
          <div className="d-flex gap-2 align-items-center flex-wrap mb-3">
            <Badge bg="secondary">pending: {retryStats?.pending ?? 0}</Badge>
            <Badge bg="primary">processing: {retryStats?.processing ?? 0}</Badge>
            <Badge bg="success">completed: {retryStats?.completed ?? 0}</Badge>
            <Badge bg="danger">failed: {retryStats?.failed ?? 0}</Badge>
            <AppSelect
              size="sm"
              value={retryStatusFilter}
              ariaLabel="retry status"
              onChange={(value) => setRetryStatusFilter(value as typeof retryStatusFilter)}
              className="filter-select-compact"
              options={[
                { value: 'all', label: 'すべて' },
                { value: 'pending', label: 'pending' },
                { value: 'processing', label: 'processing' },
                { value: 'completed', label: 'completed' },
                { value: 'failed', label: 'failed' },
              ]}
            />
          </div>
          {retryLoading ? (
            <InlineLoader text="リトライキューを読み込み中..." className="text-muted small" />
          ) : retryItems.length === 0 ? (
            <div className="text-muted small">対象のリトライジョブはありません。</div>
          ) : (
            <div className="table-responsive">
              <AppTable striped size="sm" className="mobile-table mb-0">
                <thead>
                  <tr>
                    <th>request</th>
                    <th>薬局</th>
                    <th>状態</th>
                    <th>attempt</th>
                    <th>次回</th>
                    <th>失敗理由</th>
                  </tr>
                </thead>
                <tbody>
                  {retryItems.map((item) => (
                    <tr key={item.id}>
                      <td>#{item.requestId}</td>
                      <td>{item.pharmacyName}</td>
                      <td><Badge bg={item.status === 'failed' ? 'danger' : item.status === 'completed' ? 'success' : item.status === 'processing' ? 'primary' : 'secondary'}>{item.status}</Badge></td>
                      <td>{item.attemptCount}/{item.maxAttempts}</td>
                      <td>{formatDateTimeJa(item.nextRetryAt ?? item.lastAttemptAt)}</td>
                      <td className="small text-muted">{item.lastError ?? item.triggerReason ?? '-'}</td>
                    </tr>
                  ))}
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
          <div className="small text-muted mb-3">
            OpenClaw から反映された状態を SSE で自動更新し、接続できない場合は約1分ごとに再取得します。
          </div>

          <div className="d-flex gap-2 align-items-center flex-wrap mb-3">
            <Badge bg="secondary">受付済み: {workflowCount.queued ?? 0}</Badge>
            <Badge bg="secondary">解析中: {workflowCount.analyzing ?? 0}</Badge>
            <Badge bg="primary">回答待ち: {workflowCount.awaiting_user ?? 0}</Badge>
            <Badge bg="warning" text="dark">実装中: {(workflowCount.implementing ?? 0) + (workflowCount.pr_opened ?? 0)}</Badge>
            <Badge bg="success">完了: {workflowCount.completed ?? 0}</Badge>
            <Badge bg="danger">失敗: {workflowCount.failed ?? 0}</Badge>
          </div>

          <div className="d-flex gap-2 flex-wrap mb-3">
            <AppSelect
              size="sm"
              value={statusFilter}
              ariaLabel="DSS状態で絞り込み"
              onChange={(value) => setStatusFilter(value as typeof statusFilter)}
              className="filter-select-compact"
              options={[
                { value: 'all', label: 'すべての状態' },
                { value: 'queued', label: '受付済み' },
                { value: 'analyzing', label: '解析中' },
                { value: 'awaiting_user', label: '回答待ち' },
                { value: 'implementing', label: '実装中' },
                { value: 'pr_opened', label: 'PR作成済み' },
                { value: 'completed', label: '完了' },
                { value: 'failed', label: '失敗' },
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
                        <th>受付日時</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRequests.map((item) => {
                        const status = openclawStatusMeta(item.openclawStatus);
                        const workflow = workflowStatusMeta(item.workflowStatus);
                        return (
                          <tr key={item.id}>
                            <td>
                              <button
                                type="button"
                                className="btn btn-link p-0 text-decoration-none"
                                onClick={() => setSelectedRequestId(item.id)}
                              >
                                {item.id}
                              </button>
                            </td>
                            <td>{item.pharmacyName} (ID: {item.pharmacyId})</td>
                            <td className="small">
                              <div>{item.requestText}</div>
                              {(item.latestSummary ?? item.openclawSummary) && <div className="text-muted mt-1">要約: {item.latestSummary ?? item.openclawSummary}</div>}
                              {item.openclawThreadId && <div className="text-muted mt-1">Thread: {item.openclawThreadId}</div>}
                              {item.prUrl && <div className="text-muted mt-1">PR: {item.prUrl}</div>}
                            </td>
                            <td>
                              <div className="d-flex flex-wrap gap-1">
                                <Badge bg={status.bg}>{status.label}</Badge>
                                <Badge bg={workflow.bg}>{workflow.label}</Badge>
                              </div>
                            </td>
                            <td>{formatDateTimeJa(item.createdAt)}</td>
                            <td>
                              {item.openclawStatus === 'pending_handoff' || item.workflowStatus === 'failed' ? (
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
                                <span className="text-muted small">-</span>
                              )}
                            </td>
                          </tr>
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
                    const workflow = workflowStatusMeta(item.workflowStatus);
                    return (
                      <AppMobileDataCard
                        key={item.id}
                        title={`${item.pharmacyName} (ID: ${item.pharmacyId})`}
                        subtitle={`要望ID: ${item.id}`}
                        badges={(
                          <div className="d-flex gap-1 flex-wrap">
                            <Badge bg={status.bg}>{status.label}</Badge>
                            <Badge bg={workflow.bg}>{workflow.label}</Badge>
                          </div>
                        )}
                        fields={[
                          { label: '要望内容', value: item.requestText },
                          { label: '要約', value: item.latestSummary ?? item.openclawSummary ?? '-' },
                          { label: 'Thread', value: item.openclawThreadId || '-' },
                          { label: 'PR', value: item.prUrl || '-' },
                          { label: '受付日時', value: formatDateTimeJa(item.createdAt) },
                        ]}
                        actions={(
                          <div className="d-flex gap-2 align-items-center">
                            <LoadingButton
                              size="sm"
                              variant="outline-secondary"
                              onClick={() => setSelectedRequestId(item.id)}
                              loading={false}
                              loadingLabel="読み込み中..."
                            >
                              詳細
                            </LoadingButton>
                            {item.openclawStatus === 'pending_handoff' || item.workflowStatus === 'failed' ? (
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
                          </div>
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

      <AppCard className="mt-3">
        <AppCard.Header>DSS会話履歴</AppCard.Header>
        <AppCard.Body>
          {!selectedRequestId ? (
            <div className="text-muted small">要望を選択すると詳細が表示されます。</div>
          ) : threadLoading ? (
            <InlineLoader text="会話履歴を読み込み中..." className="text-muted small" />
          ) : !thread ? (
            <div className="text-muted small">会話履歴を取得できませんでした。</div>
          ) : (
            <div className="d-flex flex-column gap-3">
              <div className="d-flex flex-wrap gap-2">
                <Badge bg={openclawStatusMeta(thread.request.openclawStatus).bg}>
                  {openclawStatusMeta(thread.request.openclawStatus).label}
                </Badge>
                <Badge bg={workflowStatusMeta(thread.request.workflowStatus).bg}>
                  {workflowStatusMeta(thread.request.workflowStatus).label}
                </Badge>
                {thread.request.prUrl && (
                  <a href={thread.request.prUrl} target="_blank" rel="noreferrer" className="small">
                    PR #{thread.request.prNumber ?? '-'} を開く
                  </a>
                )}
                {thread.request.branchName && <span className="text-muted small text-wrap-anywhere">branch: {thread.request.branchName}</span>}
              </div>

              <div className="small text-muted">
                {thread.request.pharmacyName} / 要望 #{thread.request.id}
              </div>

              <div className="d-flex flex-column gap-2">
                {thread.messages.map((entry) => (
                  <div key={entry.id} className={`border rounded p-3 ${entry.authorType === 'user' ? 'bg-light' : 'bg-white'}`}>
                    <div className="d-flex justify-content-between align-items-center mb-1">
                      <strong className="small">
                        {entry.authorType === 'user'
                          ? 'ユーザー'
                          : entry.authorType === 'openclaw_agent'
                            ? 'DSS Manager'
                            : entry.authorType === 'admin'
                              ? 'Admin'
                              : 'System'}
                      </strong>
                      <span className="text-muted small">{formatDateTimeJa(entry.createdAt)}</span>
                    </div>
                    <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{entry.body}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </AppCard.Body>
      </AppCard>

      <AppCard className="mt-3">
        <AppCard.Header>Request Event Timeline</AppCard.Header>
        <AppCard.Body>
          {!selectedRequestId ? (
            <div className="text-muted small">要望を選択するとイベント履歴を確認できます。</div>
          ) : eventsLoading ? (
            <InlineLoader text="イベント履歴を読み込み中..." className="text-muted small" />
          ) : events.length === 0 ? (
            <div className="text-muted small">イベント履歴はまだありません。</div>
          ) : (
            <div className="d-flex flex-column gap-2">
              {events.map((event) => (
                <div key={event.id} className="border rounded p-3 bg-light">
                  <div className="d-flex justify-content-between align-items-center gap-3 flex-wrap">
                    <div className="fw-semibold">{event.summary ?? event.eventType}</div>
                    <Badge bg="secondary">{event.eventType}</Badge>
                  </div>
                  {event.note ? <div className="small mt-2" style={{ whiteSpace: 'pre-wrap' }}>{event.note}</div> : null}
                  <div className="text-muted small mt-2">{formatDateTimeJa(event.createdAt)}</div>
                </div>
              ))}
            </div>
          )}
        </AppCard.Body>
      </AppCard>
      </ScrollArea>
    </PageShell>
  );
}
