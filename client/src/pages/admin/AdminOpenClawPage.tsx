import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Form, Table } from 'react-bootstrap';
import { api } from '../../api/client';

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
    <div>
      <h4 className="page-title mb-3">OpenClaw連携</h4>

      {message && <Alert variant="success" onClose={() => setMessage('')} dismissible>{message}</Alert>}
      {error && <Alert variant="danger" onClose={() => setError('')} dismissible>{error}</Alert>}

      <Card>
        <Card.Header>要望一覧（管理者専用）</Card.Header>
        <Card.Body>
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
              <Form.Select
                size="sm"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                className="filter-select-compact"
              >
              <option value="all">すべての状態</option>
              <option value="pending_handoff">連携待ち</option>
              <option value="in_dialogue">対話中</option>
              <option value="implementing">実装中</option>
              <option value="completed">完了</option>
            </Form.Select>
            <Form.Control
              size="sm"
              placeholder="薬局名・要望内容で検索"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="filter-input-compact"
            />
          </div>

          {loading ? (
            <div className="text-muted small">読み込み中...</div>
          ) : filteredRequests.length === 0 ? (
            <div className="text-muted small">
              {requests.length === 0 ? '受信した要望はまだありません。' : '条件に一致する要望はありません。'}
            </div>
          ) : (
            <div className="table-responsive">
              <Table striped size="sm" className="mobile-table mb-0">
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
                        <td>{item.createdAt ? new Date(item.createdAt).toLocaleString('ja-JP') : '-'}</td>
                        <td>
                          {item.openclawStatus === 'pending_handoff' ? (
                            <Button
                              size="sm"
                              variant="outline-primary"
                              disabled={handoffingRequestId === item.id}
                              onClick={() => handleRetryHandoff(item.id)}
                            >
                              {handoffingRequestId === item.id ? '再連携中...' : '再連携'}
                            </Button>
                          ) : (
                            <span className="text-muted small">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          )}
        </Card.Body>
      </Card>
    </div>
  );
}
