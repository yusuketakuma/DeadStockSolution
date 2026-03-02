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

  useEffect(() => {
    fetchRequests();
  }, []);

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
                        <th>受付日時</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRequests.map((item) => {
                        const status = openclawStatusMeta(item.openclawStatus);
                        return (
                          <tr key={item.id}>
                            <td>{item.id}</td>
                            <td>{item.pharmacyName} (ID: {item.pharmacyId})</td>
                            <td className="small">
                              <div>{item.requestText}</div>
                              {item.openclawSummary && <div className="text-muted mt-1">要約: {item.openclawSummary}</div>}
                              {item.openclawThreadId && <div className="text-muted mt-1">Thread: {item.openclawThreadId}</div>}
                            </td>
                            <td><Badge bg={status.bg}>{status.label}</Badge></td>
                            <td>{formatDateTimeJa(item.createdAt)}</td>
                            <td>
                              {item.openclawStatus === 'pending_handoff' ? (
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
