import { useEffect, useState } from 'react';
import { Badge, Card, Col, Form, Row, Tab, Tabs } from 'react-bootstrap';
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

interface NotificationStats {
  totalNotifications: number;
  unreadNotifications: number;
  totalSubscriptions: number;
  typeBreakdown: { type: string; count: number }[];
}

interface NotificationItem {
  id: number;
  pharmacyId: number;
  pharmacyName: string | null;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string | null;
}

interface NotificationsResponse {
  data: NotificationItem[];
  pagination: { page: number; totalPages: number; total: number };
}

interface PushSubscriptionSummary {
  pharmacyId: number;
  pharmacyName: string | null;
  subscriptionCount: number;
  latestCreatedAt: string | null;
  latestUsedAt: string | null;
}

export default function AdminNotificationsPage() {
  const [stats, setStats] = useState<NotificationStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState('');
  const [subscriptions, setSubscriptions] = useState<PushSubscriptionSummary[]>([]);
  const [subsLoading, setSubsLoading] = useState(false);

  useEffect(() => {
    setStatsLoading(true);
    void api.get<{ data: NotificationStats }>('/admin/notifications/stats')
      .then((res) => setStats(res.data))
      .catch(() => {})
      .finally(() => setStatsLoading(false));
  }, []);

  const loadSubscriptions = () => {
    setSubsLoading(true);
    void api.get<{ data: PushSubscriptionSummary[] }>('/admin/notifications/subscriptions')
      .then((res) => setSubscriptions(res.data))
      .catch(() => {})
      .finally(() => setSubsLoading(false));
  };

  const {
    items,
    page,
    setPage,
    totalPages,
    loading,
    error,
    retry,
  } = usePaginatedList<NotificationItem, NotificationsResponse>(
    (targetPage, signal) => {
      const params = new URLSearchParams({ page: String(targetPage) });
      if (typeFilter) params.set('type', typeFilter);
      return api.get<NotificationsResponse>(`/admin/notifications?${params}`, { signal });
    },
    { errorMessage: '通知一覧の取得に失敗しました' },
  );

  return (
    <PageShell>
      <h4 className="page-title mb-3">通知・配信状況</h4>

      <ScrollArea>
        {statsLoading ? (
          <InlineLoader text="統計を読み込み中..." className="text-muted small mb-3" />
        ) : stats && (
          <Row className="mb-3 g-2">
            <Col xs={6} md={3}>
              <Card body className="text-center">
                <div className="small text-muted">通知総数</div>
                <div className="fs-5 fw-bold">{stats.totalNotifications}</div>
              </Card>
            </Col>
            <Col xs={6} md={3}>
              <Card body className="text-center">
                <div className="small text-muted">未読</div>
                <div className="fs-5 fw-bold text-warning">{stats.unreadNotifications}</div>
              </Card>
            </Col>
            <Col xs={6} md={3}>
              <Card body className="text-center">
                <div className="small text-muted">プッシュ購読</div>
                <div className="fs-5 fw-bold">{stats.totalSubscriptions}</div>
              </Card>
            </Col>
            <Col xs={6} md={3}>
              <Card body className="text-center">
                <div className="small text-muted">タイプ別</div>
                <div className="d-flex flex-wrap gap-1 justify-content-center">
                  {stats.typeBreakdown.slice(0, 3).map((t) => (
                    <Badge key={t.type} bg="secondary" className="small">{t.type}: {t.count}</Badge>
                  ))}
                </div>
              </Card>
            </Col>
          </Row>
        )}

        <Tabs defaultActiveKey="notifications" className="mb-3" onSelect={(k) => { if (k === 'subscriptions') loadSubscriptions(); }}>
          <Tab eventKey="notifications" title="通知一覧">
            <Row className="mb-3 g-2">
              <Col xs={12} md={4}>
                <Form.Select size="sm" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}>
                  <option value="">すべてのタイプ</option>
                  <option value="proposal_received">提案受信</option>
                  <option value="proposal_status_changed">提案ステータス変更</option>
                  <option value="new_comment">新規コメント</option>
                  <option value="request_update">要望更新</option>
                  <option value="alert_near_expiry">期限切れ間近</option>
                  <option value="alert_excess_stock">過剰在庫</option>
                </Form.Select>
              </Col>
            </Row>

            {error && <ErrorRetryAlert error={error} onRetry={() => void retry()} />}

            {loading ? (
              <InlineLoader text="通知を読み込み中..." className="text-muted small" />
            ) : items.length === 0 ? (
              <AppEmptyState title="通知がありません" description="通知が送信されるとここに表示されます。" />
            ) : (
              <AppResponsiveSwitch
                desktop={() => (
                  <div className="table-responsive">
                    <AppTable striped hover className="mobile-table">
                      <thead className="table-light">
                        <tr>
                          <th>ID</th>
                          <th>薬局</th>
                          <th>タイプ</th>
                          <th>タイトル</th>
                          <th>既読</th>
                          <th>日時</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((n) => (
                          <tr key={n.id}>
                            <td>{n.id}</td>
                            <td>{n.pharmacyName ?? `ID:${n.pharmacyId}`}</td>
                            <td><Badge bg="secondary">{n.type}</Badge></td>
                            <td>
                              <div>{n.title}</div>
                              <div className="small text-muted">{n.message}</div>
                            </td>
                            <td>{n.isRead ? <Badge bg="success">既読</Badge> : <Badge bg="warning">未読</Badge>}</td>
                            <td>{formatDateTimeJa(n.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </AppTable>
                  </div>
                )}
                mobile={() => (
                  <div className="dl-mobile-data-list">
                    {items.map((n) => (
                      <AppMobileDataCard
                        key={n.id}
                        title={n.title}
                        subtitle={n.pharmacyName ?? `薬局ID:${n.pharmacyId}`}
                        badges={
                          <>
                            <Badge bg="secondary" className="me-1">{n.type}</Badge>
                            {n.isRead ? <Badge bg="success">既読</Badge> : <Badge bg="warning">未読</Badge>}
                          </>
                        }
                        fields={[
                          { label: 'メッセージ', value: n.message },
                          { label: '日時', value: formatDateTimeJa(n.createdAt) },
                        ]}
                      />
                    ))}
                  </div>
                )}
              />
            )}
            <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
          </Tab>
          <Tab eventKey="subscriptions" title="プッシュ購読">
            {subsLoading ? (
              <InlineLoader text="購読情報を読み込み中..." className="text-muted small" />
            ) : subscriptions.length === 0 ? (
              <AppEmptyState title="プッシュ購読がありません" description="プッシュ通知の購読が登録されるとここに表示されます。" />
            ) : (
              <AppTable striped hover size="sm">
                <thead className="table-light">
                  <tr>
                    <th>薬局ID</th>
                    <th>薬局名</th>
                    <th>購読数</th>
                    <th>最終登録</th>
                    <th>最終利用</th>
                  </tr>
                </thead>
                <tbody>
                  {subscriptions.map((s) => (
                    <tr key={s.pharmacyId}>
                      <td>{s.pharmacyId}</td>
                      <td>{s.pharmacyName ?? '—'}</td>
                      <td><Badge bg="primary">{s.subscriptionCount}</Badge></td>
                      <td>{formatDateTimeJa(s.latestCreatedAt)}</td>
                      <td>{formatDateTimeJa(s.latestUsedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </AppTable>
            )}
          </Tab>
        </Tabs>
      </ScrollArea>
    </PageShell>
  );
}
