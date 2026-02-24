import { useState, useEffect } from 'react';
import { Table, Alert, Badge, Form, Row, Col } from 'react-bootstrap';
import { api } from '../../api/client';
import Pagination from '../../components/Pagination';

interface LogEntry {
  id: number;
  pharmacyId: number | null;
  pharmacyName: string | null;
  action: string;
  detail: string | null;
  ipAddress: string | null;
  createdAt: string | null;
}

interface LogsResponse {
  data: LogEntry[];
  pagination: { page: number; totalPages: number; total: number };
}

const ACTION_LABELS: Record<string, { label: string; variant: string }> = {
  login: { label: 'ログイン', variant: 'primary' },
  login_failed: { label: 'ログイン失敗', variant: 'danger' },
  admin_login: { label: '管理者ログイン', variant: 'warning' },
  test_login: { label: 'テストログイン', variant: 'secondary' },
  register: { label: '新規登録', variant: 'success' },
  logout: { label: 'ログアウト', variant: 'secondary' },
  upload: { label: 'アップロード', variant: 'info' },
  proposal_create: { label: '提案作成', variant: 'primary' },
  proposal_accept: { label: '提案承認', variant: 'success' },
  proposal_reject: { label: '提案拒否', variant: 'danger' },
  proposal_complete: { label: '交換完了', variant: 'success' },
  account_update: { label: 'アカウント更新', variant: 'info' },
  account_deactivate: { label: 'アカウント無効化', variant: 'dark' },
  admin_toggle_active: { label: '有効/無効切替', variant: 'warning' },
  admin_send_message: { label: 'メッセージ送信', variant: 'info' },
  dead_stock_delete: { label: '在庫削除', variant: 'danger' },
};

const ACTION_OPTIONS = [
  { value: '', label: '全てのアクション' },
  { value: 'login', label: 'ログイン' },
  { value: 'login_failed', label: 'ログイン失敗' },
  { value: 'admin_login', label: '管理者ログイン' },
  { value: 'test_login', label: 'テストログイン' },
  { value: 'register', label: '新規登録' },
  { value: 'upload', label: 'アップロード' },
  { value: 'proposal_create', label: '提案作成' },
  { value: 'proposal_accept', label: '提案承認' },
  { value: 'proposal_reject', label: '提案拒否' },
  { value: 'proposal_complete', label: '交換完了' },
  { value: 'account_update', label: 'アカウント更新' },
  { value: 'admin_toggle_active', label: '有効/無効切替' },
  { value: 'admin_send_message', label: 'メッセージ送信' },
  { value: 'dead_stock_delete', label: '在庫削除' },
];

export default function AdminLogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [actionFilter, setActionFilter] = useState('');

  const fetchData = async (p: number) => {
    const params = new URLSearchParams({ page: String(p), limit: '50' });
    if (actionFilter) params.set('action', actionFilter);
    const data = await api.get<LogsResponse>(`/admin/logs?${params}`);
    setLogs(data.data);
    setTotalPages(data.pagination.totalPages);
    setTotal(data.pagination.total);
  };

  useEffect(() => {
    fetchData(page);
  }, [page, actionFilter]);

  const getActionBadge = (action: string) => {
    const info = ACTION_LABELS[action];
    if (info) {
      return <Badge bg={info.variant}>{info.label}</Badge>;
    }
    return <Badge bg="secondary">{action}</Badge>;
  };

  return (
    <div>
      <h4 className="page-title mb-3">操作ログ ({total}件)</h4>

      <Row className="mb-3">
        <Col md={4}>
          <Form.Select
            value={actionFilter}
            onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
          >
            {ACTION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </Form.Select>
        </Col>
      </Row>

      {logs.length === 0 ? (
        <Alert variant="secondary">ログデータがありません。</Alert>
      ) : (
        <div className="table-responsive">
          <Table striped hover size="sm" className="mobile-table">
            <thead className="table-light">
              <tr>
                <th>ID</th>
                <th>日時</th>
                <th>アクション</th>
                <th>薬局</th>
                <th>詳細</th>
                <th>IPアドレス</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{log.id}</td>
                  <td className="small">
                    {log.createdAt ? new Date(log.createdAt).toLocaleString('ja-JP') : '-'}
                  </td>
                  <td>{getActionBadge(log.action)}</td>
                  <td>
                    {log.pharmacyName
                      ? `${log.pharmacyName} (ID:${log.pharmacyId})`
                      : log.pharmacyId
                        ? `ID:${log.pharmacyId}`
                        : '-'}
                  </td>
                  <td className="small">{log.detail ?? '-'}</td>
                  <td className="small text-muted">{log.ipAddress ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  );
}
