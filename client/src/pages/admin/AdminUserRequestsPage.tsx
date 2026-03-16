import { useState } from 'react';
import { Badge, Col, Form, Row } from 'react-bootstrap';
import { api } from '../../api/client';
import Pagination from '../../components/Pagination';
import InlineLoader from '../../components/ui/InlineLoader';
import AppTable from '../../components/ui/AppTable';
import AppEmptyState from '../../components/ui/AppEmptyState';
import AppMobileDataCard from '../../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../../components/ui/AppResponsiveSwitch';
import ErrorRetryAlert from '../../components/ui/ErrorRetryAlert';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { formatDateTimeJa } from '../../utils/formatters';

interface UserRequestItem {
  id: number;
  pharmacyId: number;
  pharmacyName: string | null;
  requestText: string;
  openclawStatus: string;
  openclawThreadId: string | null;
  openclawSummary: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface UserRequestsResponse {
  data: UserRequestItem[];
  pagination: { page: number; totalPages: number; total: number };
}

const STATUS_LABELS: Record<string, string> = {
  pending_handoff: '連携待ち',
  in_dialogue: '対話中',
  implementing: '実装中',
  completed: '完了',
};

const STATUS_COLORS: Record<string, string> = {
  pending_handoff: 'warning',
  in_dialogue: 'info',
  implementing: 'primary',
  completed: 'success',
};

export default function AdminUserRequestsPage() {
  const [statusFilter, setStatusFilter] = useState('');

  const {
    items,
    page,
    setPage,
    totalPages,
    loading,
    error,
    retry,
  } = usePaginatedList<UserRequestItem, UserRequestsResponse>(
    (targetPage, signal) => {
      const params = new URLSearchParams({ page: String(targetPage) });
      if (statusFilter) params.set('status', statusFilter);
      return api.get<UserRequestsResponse>(`/admin/user-requests?${params}`, { signal });
    },
    { errorMessage: 'ユーザーリクエストの取得に失敗しました' },
  );

  return (
    <PageShell>
      <h4 className="page-title mb-3">ユーザーリクエスト管理</h4>

      <Row className="mb-3 g-2">
        <Col xs={12} md={4}>
          <Form.Select size="sm" value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
            <option value="">すべてのステータス</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </Form.Select>
        </Col>
      </Row>

      {error && <ErrorRetryAlert error={error} onRetry={() => void retry()} />}

      <ScrollArea>
        {loading ? (
          <InlineLoader text="ユーザーリクエストを読み込み中..." className="text-muted small" />
        ) : items.length === 0 ? (
          <AppEmptyState title="ユーザーリクエストがありません" description="ユーザーからのリクエストが届くとここに表示されます。" />
        ) : (
          <AppResponsiveSwitch
            desktop={() => (
              <div className="table-responsive">
                <AppTable striped hover className="mobile-table">
                  <thead className="table-light">
                    <tr>
                      <th>ID</th>
                      <th>薬局</th>
                      <th>リクエスト内容</th>
                      <th>ステータス</th>
                      <th>OpenClaw要約</th>
                      <th>登録日時</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id}>
                        <td>{item.id}</td>
                        <td>{item.pharmacyName ?? `ID:${item.pharmacyId}`}</td>
                        <td className="text-truncate" style={{ maxWidth: 300 }}>{item.requestText}</td>
                        <td>
                          <Badge bg={STATUS_COLORS[item.openclawStatus] ?? 'secondary'}>
                            {STATUS_LABELS[item.openclawStatus] ?? item.openclawStatus}
                          </Badge>
                        </td>
                        <td className="text-truncate small text-muted" style={{ maxWidth: 200 }}>{item.openclawSummary ?? '\u2014'}</td>
                        <td>{formatDateTimeJa(item.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </AppTable>
              </div>
            )}
            mobile={() => (
              <div className="dl-mobile-data-list">
                {items.map((item) => (
                  <AppMobileDataCard
                    key={item.id}
                    title={`リクエスト #${item.id}`}
                    subtitle={item.pharmacyName ?? `薬局ID:${item.pharmacyId}`}
                    badges={
                      <Badge bg={STATUS_COLORS[item.openclawStatus] ?? 'secondary'}>
                        {STATUS_LABELS[item.openclawStatus] ?? item.openclawStatus}
                      </Badge>
                    }
                    fields={[
                      { label: '内容', value: item.requestText },
                      { label: '要約', value: item.openclawSummary ?? '\u2014' },
                      { label: '登録日時', value: formatDateTimeJa(item.createdAt) },
                    ]}
                  />
                ))}
              </div>
            )}
          />
        )}
      </ScrollArea>
      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
    </PageShell>
  );
}
