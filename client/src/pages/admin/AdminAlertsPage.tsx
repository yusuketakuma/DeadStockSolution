import { useCallback, useState } from 'react';
import { Link } from 'react-router-dom';
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
import AppDropdownMenu from '../../components/ui/AppDropdownMenu';
import ErrorRetryAlert from '../../components/ui/ErrorRetryAlert';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { formatDateTimeJa } from '../../utils/formatters';
import AdminNavigationLinks, { type AdminNavigationLinkGroup } from './components/AdminNavigationLinks';

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

const ALERT_LINK_GROUPS: readonly AdminNavigationLinkGroup[] = [
  {
    title: '通知・分析',
    description: 'アラートの発火理由と配信状態を確認するときに使います。',
    links: [
      { to: '/admin/notifications', label: '通知・配信状況' },
      { to: '/admin/risk', label: '期限リスク分析' },
      { to: '/admin/log-center', label: 'ログセンター' },
    ],
  },
  {
    title: '薬局運用',
    description: '影響薬局の状態確認や一括対応に戻れます。',
    links: [
      { to: '/admin/pharmacies', label: '薬局管理' },
      { to: '/admin/pharmacy-health', label: '薬局ヘルス' },
      { to: '/admin/bulk-actions', label: '一括操作' },
    ],
  },
] as const;

export default function AdminAlertsPage() {
  const [typeFilter, setTypeFilter] = useState('');
  const [resolvedFilter, setResolvedFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkMessage, setBulkMessage] = useState('');

  const fetchAlerts = useCallback((targetPage: number, signal?: AbortSignal) => {
    const params = new URLSearchParams({ page: String(targetPage) });
    if (typeFilter) params.set('alertType', typeFilter);
    if (resolvedFilter) params.set('resolved', resolvedFilter);
    return api.get<AlertsResponse>(`/admin/alerts?${params}`, { signal });
  }, [resolvedFilter, typeFilter]);

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
    fetchAlerts,
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
      <div className="dl-page-header">
        <div className="dl-page-header-copy">
          <h4 className="page-title mb-0">アラート管理</h4>
        </div>
        <div className="dl-action-row mobile-stack">
          <Link to="/admin/notifications" className="btn btn-outline-primary btn-sm">通知・配信状況</Link>
          <AppDropdownMenu
            label="関連"
            size="sm"
            variant="outline-secondary"
            items={[
              { label: '期限リスク分析', to: '/admin/risk' },
              { label: '薬局管理', to: '/admin/pharmacies' },
            ]}
          />
        </div>
      </div>

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
        <AdminNavigationLinks groups={ALERT_LINK_GROUPS} />
        {loading ? (
          <InlineLoader text="アラートを読み込み中..." className="text-muted small" />
        ) : items.length === 0 ? (
          <AppEmptyState
            title="アラートがありません"
            description="予測アラートが検出されるとここに表示されます。通知設定やリスク分析、薬局側の状態確認に戻れます。"
            action={(
              <div className="mt-3 dl-action-row mobile-stack justify-content-center">
                <Link to="/admin/notifications" className="btn btn-outline-secondary btn-sm">通知・配信状況</Link>
                <AppDropdownMenu
                  label="関連"
                  variant="outline-secondary"
                  items={[
                    { key: 'risk', to: '/admin/risk', label: '期限リスク分析' },
                    { key: 'pharmacies', to: '/admin/pharmacies', label: '薬局管理' },
                  ]}
                />
              </div>
            )}
          />
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
