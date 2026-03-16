import { useState } from 'react';
import { Badge, Col, Form, Row } from 'react-bootstrap';
import { api } from '../../api/client';
import Pagination from '../../components/Pagination';
import InlineLoader from '../../components/ui/InlineLoader';
import AppTable from '../../components/ui/AppTable';
import AppButton from '../../components/ui/AppButton';
import AppAlert from '../../components/ui/AppAlert';
import AppEmptyState from '../../components/ui/AppEmptyState';
import AppMobileDataCard from '../../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../../components/ui/AppResponsiveSwitch';
import ErrorRetryAlert from '../../components/ui/ErrorRetryAlert';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { formatDateTimeJa } from '../../utils/formatters';

interface AlertItem {
  id: number;
  pharmacyId: number;
  pharmacyName: string | null;
  alertType: string;
  title: string;
  message: string;
  detectedAt: string | null;
  resolvedAt: string | null;
  createdAt: string | null;
}

interface AlertsResponse {
  data: AlertItem[];
  pagination: { page: number; totalPages: number; total: number };
}

const ALERT_TYPE_LABELS: Record<string, string> = {
  near_expiry: '期限切れ間近',
  excess_stock: '過剰在庫',
};

export default function AdminAlertsPage() {
  const [typeFilter, setTypeFilter] = useState('');
  const [resolvedFilter, setResolvedFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkMessage, setBulkMessage] = useState('');

  const {
    items,
    page,
    setPage,
    totalPages,
    loading,
    error,
    retry,
    invalidateCache,
  } = usePaginatedList<AlertItem, AlertsResponse>(
    (targetPage, signal) => {
      const params = new URLSearchParams({ page: String(targetPage) });
      if (typeFilter) params.set('alertType', typeFilter);
      if (resolvedFilter) params.set('resolved', resolvedFilter);
      return api.get<AlertsResponse>(`/admin/alerts?${params}`, { signal });
    },
    { errorMessage: 'アラート一覧の取得に失敗しました' },
  );

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkResolve = async () => {
    if (selectedIds.size === 0) return;
    try {
      const res = await api.post<{ message: string }>('/admin/alerts/bulk-resolve', { ids: [...selectedIds] });
      setBulkMessage(res.message);
      setSelectedIds(new Set());
      invalidateCache();
      void retry();
    } catch (err) {
      setBulkMessage(err instanceof Error ? err.message : '一括解決に失敗しました');
    }
  };

  return (
    <PageShell>
      <h4 className="page-title mb-3">アラート管理</h4>

      <Row className="mb-3 g-2">
        <Col xs={6} md={3}>
          <Form.Select size="sm" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}>
            <option value="">すべてのタイプ</option>
            {Object.entries(ALERT_TYPE_LABELS).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </Form.Select>
        </Col>
        <Col xs={6} md={3}>
          <Form.Select size="sm" value={resolvedFilter} onChange={(e) => { setResolvedFilter(e.target.value); setPage(1); }}>
            <option value="">すべての状態</option>
            <option value="false">未解決</option>
            <option value="true">解決済み</option>
          </Form.Select>
        </Col>
        <Col xs={12} md={3}>
          {selectedIds.size > 0 && (
            <AppButton size="sm" variant="outline-success" onClick={() => void handleBulkResolve()}>
              選択済み({selectedIds.size}件)を一括解決
            </AppButton>
          )}
        </Col>
      </Row>

      {bulkMessage && <AppAlert variant="success" dismissible onClose={() => setBulkMessage('')}>{bulkMessage}</AppAlert>}
      {error && <ErrorRetryAlert error={error} onRetry={() => void retry()} />}

      <ScrollArea>
        {loading ? (
          <InlineLoader text="アラートを読み込み中..." className="text-muted small" />
        ) : items.length === 0 ? (
          <AppEmptyState title="アラートがありません" description="予測アラートが検出されるとここに表示されます。" />
        ) : (
          <AppResponsiveSwitch
            desktop={() => (
              <div className="table-responsive">
                <AppTable striped hover className="mobile-table">
                  <thead className="table-light">
                    <tr>
                      <th style={{ width: 40 }}></th>
                      <th>ID</th>
                      <th>薬局</th>
                      <th>タイプ</th>
                      <th>タイトル</th>
                      <th>検出日</th>
                      <th>状態</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((a) => (
                      <tr key={a.id}>
                        <td>
                          {!a.resolvedAt && (
                            <Form.Check
                              type="checkbox"
                              checked={selectedIds.has(a.id)}
                              onChange={() => toggleSelect(a.id)}
                            />
                          )}
                        </td>
                        <td>{a.id}</td>
                        <td>{a.pharmacyName ?? `ID:${a.pharmacyId}`}</td>
                        <td>
                          <Badge bg={a.alertType === 'near_expiry' ? 'warning' : 'danger'}>
                            {ALERT_TYPE_LABELS[a.alertType] ?? a.alertType}
                          </Badge>
                        </td>
                        <td>
                          <div>{a.title}</div>
                          <div className="small text-muted">{a.message}</div>
                        </td>
                        <td>{formatDateTimeJa(a.detectedAt)}</td>
                        <td>
                          {a.resolvedAt ? (
                            <Badge bg="success">解決済み</Badge>
                          ) : (
                            <Badge bg="danger">未解決</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </AppTable>
              </div>
            )}
            mobile={() => (
              <div className="dl-mobile-data-list">
                {items.map((a) => (
                  <AppMobileDataCard
                    key={a.id}
                    title={a.title}
                    subtitle={a.pharmacyName ?? `薬局ID:${a.pharmacyId}`}
                    badges={
                      <>
                        <Badge bg={a.alertType === 'near_expiry' ? 'warning' : 'danger'} className="me-1">
                          {ALERT_TYPE_LABELS[a.alertType] ?? a.alertType}
                        </Badge>
                        {a.resolvedAt ? <Badge bg="success">解決済み</Badge> : <Badge bg="danger">未解決</Badge>}
                      </>
                    }
                    fields={[
                      { label: 'メッセージ', value: a.message },
                      { label: '検出日', value: formatDateTimeJa(a.detectedAt) },
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
