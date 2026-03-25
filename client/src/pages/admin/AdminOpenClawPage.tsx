import { useEffect, useState } from 'react';
import AppTable from '../../components/ui/AppTable';
import AppAlert from '../../components/ui/AppAlert';
import { Badge } from 'react-bootstrap';
import AppCard from '../../components/ui/AppCard';
import { api } from '../../api/client';
import AppSelect from '../../components/ui/AppSelect';
import InlineLoader from '../../components/ui/InlineLoader';
import LoadingButton from '../../components/ui/LoadingButton';
import AppControl from '../../components/ui/AppControl';
import AppMobileDataCard from '../../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../../components/ui/AppResponsiveSwitch';
import { useSseRefresh } from '../../hooks/useSseRefresh';
import { formatDateTimeJa } from '../../utils/formatters';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';

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
  const [statusFilter, setStatusFilter] = useState<'all' | 'queued' | 'analyzing' | 'awaiting_user' | 'implementing' | 'pr_opened' | 'completed' | 'failed'>('all');
  const [searchText, setSearchText] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

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

  const fetchRequests = async ({ background = false }: { background?: boolean } = {}) => {
    if (!background) {
      setLoading(true);
    }
    try {
      const data = await api.get<UserRequestsResponse>('/admin/requests?page=1&limit=50');
      setRequests(data.data);
      setConnectorMeta(data.connector ?? null);
      setSelectedRequestId((current) => {
        if (current && data.data.some((item) => item.id === current)) {
          return current;
        }
        return data.data[0]?.id ?? null;
      });
    } catch (err) {
      if (!background) {
        setError(err instanceof Error ? err.message : 'OpenClaw連携情報の取得に失敗しました');
      }
    } finally {
      if (!background) {
        setLoading(false);
      }
    }
  };

  const fetchThread = async (requestId: number, { background = false }: { background?: boolean } = {}) => {
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
  };

  useEffect(() => {
    void fetchRequests();
  }, []);

  useEffect(() => {
    if (!selectedRequestId) {
      setThread(null);
      return;
    }
    void fetchThread(selectedRequestId);
  }, [selectedRequestId]);

  useSseRefresh({
    enabled: true,
    streamPath: '/realtime/stream?topics=admin_requests',
    events: ['admin_requests.refresh'],
    onRefresh: async () => {
    await fetchRequests({ background: true });
    if (selectedRequestId) {
      await fetchThread(selectedRequestId, { background: true });
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

  return (
    <PageShell>
      <h4 className="page-title mb-3">OpenClaw連携</h4>

      {message && <AppAlert variant="success" onClose={() => setMessage('')} dismissible>{message}</AppAlert>}
      {error && <AppAlert variant="danger" onClose={() => setError('')} dismissible>{error}</AppAlert>}

      <ScrollArea>
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
      </ScrollArea>
    </PageShell>
  );
}
