import { useState, useEffect } from 'react';
import { Table, Alert, Badge, Form, Row, Col, Card } from 'react-bootstrap';
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
  summary?: {
    failureTotal: number;
    failureByAction: Record<string, number>;
    failureByReason: Array<{ reason: string; count: number }>;
  };
}

const ACTION_LABELS: Record<string, { label: string; variant: string }> = {
  login: { label: 'ログイン', variant: 'primary' },
  login_failed: { label: 'ログイン失敗', variant: 'danger' },
  admin_login: { label: '管理者ログイン', variant: 'warning' },
  register: { label: '新規登録', variant: 'success' },
  logout: { label: 'ログアウト', variant: 'secondary' },
  upload: { label: 'アップロード', variant: 'info' },
  proposal_create: { label: '仮マッチング開始', variant: 'primary' },
  proposal_accept: { label: '仮マッチング承認', variant: 'success' },
  proposal_reject: { label: '仮マッチング拒否', variant: 'danger' },
  proposal_complete: { label: '交換完了', variant: 'success' },
  account_update: { label: 'アカウント更新', variant: 'info' },
  account_deactivate: { label: 'アカウント無効化', variant: 'dark' },
  admin_toggle_active: { label: '有効/無効切替', variant: 'warning' },
  admin_send_message: { label: 'メッセージ送信', variant: 'info' },
  dead_stock_delete: { label: '在庫削除', variant: 'danger' },
  password_reset_request: { label: 'パスワード再設定要求', variant: 'warning' },
  password_reset_complete: { label: 'パスワード再設定完了', variant: 'success' },
  password_reset_failed: { label: 'パスワード再設定失敗', variant: 'danger' },
  drug_master_sync: { label: '医薬品マスター同期', variant: 'info' },
  drug_master_package_upload: { label: '包装単位データ登録', variant: 'info' },
  drug_master_edit: { label: '医薬品マスター編集', variant: 'secondary' },
};

const ACTION_OPTIONS = [
  { value: '', label: '全てのアクション' },
  { value: 'login', label: 'ログイン' },
  { value: 'login_failed', label: 'ログイン失敗' },
  { value: 'admin_login', label: '管理者ログイン' },
  { value: 'register', label: '新規登録' },
  { value: 'upload', label: 'アップロード' },
  { value: 'proposal_create', label: '仮マッチング開始' },
  { value: 'proposal_accept', label: '仮マッチング承認' },
  { value: 'proposal_reject', label: '仮マッチング拒否' },
  { value: 'proposal_complete', label: '交換完了' },
  { value: 'account_update', label: 'アカウント更新' },
  { value: 'admin_toggle_active', label: '有効/無効切替' },
  { value: 'admin_send_message', label: 'メッセージ送信' },
  { value: 'dead_stock_delete', label: '在庫削除' },
  { value: 'password_reset_request', label: 'パスワード再設定要求' },
  { value: 'password_reset_complete', label: 'パスワード再設定完了' },
  { value: 'password_reset_failed', label: 'パスワード再設定失敗' },
  { value: 'drug_master_sync', label: '医薬品マスター同期' },
  { value: 'drug_master_package_upload', label: '包装単位データ登録' },
  { value: 'drug_master_edit', label: '医薬品マスター編集' },
];

const FAILURE_REASON_LABELS: Record<string, string> = {
  parse_failed: 'ファイル解析失敗',
  empty_file: '空ファイル',
  empty_rows: '有効データ0件',
  invalid_mapping: 'カラム割当不正',
  invalid_header_row_format: 'ヘッダー行形式不正',
  invalid_header_row_value: 'ヘッダー行値不正',
  header_row_out_of_range: 'ヘッダー行範囲外',
  invalid_revision_date: '改定日形式不正',
  sync_failed: '同期処理失敗',
  unexpected_error: '予期しないエラー',
  file_too_large: 'ファイルサイズ超過',
  file_filter_rejected: 'ファイル形式不正',
  multer_error: 'アップロード処理エラー',
  unknown_upload_error: '不明なアップロードエラー',
  unknown: '不明',
};

export default function AdminLogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [actionFilter, setActionFilter] = useState('');
  const [resultFilter, setResultFilter] = useState<'all' | 'failure'>('all');
  const [keyword, setKeyword] = useState('');
  const [failureTotal, setFailureTotal] = useState(0);
  const [failureByAction, setFailureByAction] = useState<Record<string, number>>({});
  const [failureByReason, setFailureByReason] = useState<Array<{ reason: string; count: number }>>([]);

  const fetchData = async (p: number) => {
    const params = new URLSearchParams({ page: String(p), limit: '50' });
    if (actionFilter) params.set('action', actionFilter);
    if (resultFilter === 'failure') params.set('result', 'failure');
    if (keyword.trim()) params.set('keyword', keyword.trim());
    const data = await api.get<LogsResponse>(`/admin/logs?${params}`);
    setLogs(data.data);
    setTotalPages(data.pagination.totalPages);
    setTotal(data.pagination.total);
    setFailureTotal(data.summary?.failureTotal ?? 0);
    setFailureByAction(data.summary?.failureByAction ?? {});
    setFailureByReason(data.summary?.failureByReason ?? []);
  };

  useEffect(() => {
    fetchData(page);
  }, [page, actionFilter, resultFilter, keyword]);

  const getActionBadge = (action: string) => {
    const info = ACTION_LABELS[action];
    if (info) {
      return <Badge bg={info.variant}>{info.label}</Badge>;
    }
    return <Badge bg="secondary">{action}</Badge>;
  };

  const formatDetail = (detail: string | null) => {
    if (!detail) return '-';
    if (detail.startsWith('失敗|')) {
      return detail.replace(/\|/g, ' / ');
    }
    return detail;
  };

  const getFailureReasonLabel = (reason: string) => FAILURE_REASON_LABELS[reason] ?? reason;

  return (
    <div>
      <h4 className="page-title mb-3">操作ログ ({total}件)</h4>

      <Row className="g-2 mb-3">
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
        <Col md={3}>
          <Form.Select
            value={resultFilter}
            onChange={(e) => {
              setResultFilter(e.target.value === 'failure' ? 'failure' : 'all');
              setPage(1);
            }}
          >
            <option value="all">全ての結果</option>
            <option value="failure">失敗のみ</option>
          </Form.Select>
        </Col>
        <Col md={5}>
          <Form.Control
            placeholder="詳細検索（例: parse_failed / file=xxx.xlsx）"
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setPage(1);
            }}
          />
        </Col>
      </Row>

      <Row className="g-2 mb-3">
        <Col md={3}>
          <Card body className="h-100">
            <div className="small text-muted">失敗ログ（フィルタ適用後）</div>
            <div className="fs-4 fw-semibold">{failureTotal}</div>
          </Card>
        </Col>
        <Col md={3}>
          <Card body className="h-100">
            <div className="small text-muted">アップロード失敗</div>
            <div className="fs-4 fw-semibold">{failureByAction.upload ?? 0}</div>
          </Card>
        </Col>
        <Col md={3}>
          <Card body className="h-100">
            <div className="small text-muted">医薬品マスター同期失敗</div>
            <div className="fs-4 fw-semibold">{failureByAction.drug_master_sync ?? 0}</div>
          </Card>
        </Col>
        <Col md={3}>
          <Card body className="h-100">
            <div className="small text-muted">包装単位取込失敗</div>
            <div className="fs-4 fw-semibold">{failureByAction.drug_master_package_upload ?? 0}</div>
          </Card>
        </Col>
      </Row>

      <Card className="mb-3">
        <Card.Body>
          <Card.Title className="h6 mb-2">失敗理由ランキング（上位10件）</Card.Title>
          {failureByReason.length === 0 ? (
            <div className="small text-muted">失敗ログがありません。</div>
          ) : (
            <div className="d-flex flex-column gap-1">
              {failureByReason.map((item, index) => (
                <div key={`${item.reason}-${index}`} className="d-flex justify-content-between align-items-center">
                  <span className="small">
                    {index + 1}. {getFailureReasonLabel(item.reason)}
                  </span>
                  <Badge bg="danger">{item.count}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card.Body>
      </Card>

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
                  <td className="d-flex align-items-center gap-1">
                    {getActionBadge(log.action)}
                    {log.detail?.startsWith('失敗|') && <Badge bg="danger">失敗</Badge>}
                  </td>
                  <td>
                    {log.pharmacyName
                      ? `${log.pharmacyName} (ID:${log.pharmacyId})`
                      : log.pharmacyId
                        ? `ID:${log.pharmacyId}`
                        : '-'}
                  </td>
                  <td className="small">{formatDetail(log.detail)}</td>
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
