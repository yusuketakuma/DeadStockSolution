import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, Col, Form, Row, Tab, Tabs } from 'react-bootstrap';
import { api } from '../../api/client';
import Pagination from '../../components/Pagination';
import InlineLoader from '../../components/ui/InlineLoader';
import AppTable from '../../components/ui/AppTable';
import AppEmptyState from '../../components/ui/AppEmptyState';
import AppDataPanel from '../../components/ui/AppDataPanel';
import AppMobileDataCard from '../../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../../components/ui/AppResponsiveSwitch';
import ErrorRetryAlert from '../../components/ui/ErrorRetryAlert';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { formatDateTimeJa } from '../../utils/formatters';
import AppDropdownMenu from '../../components/ui/AppDropdownMenu';

const ADMIN_NOTIFICATION_TYPE_OPTIONS = [
  { value: 'proposal_received', label: '提案受信' },
  { value: 'proposal_status_changed', label: '提案ステータス変更' },
  { value: 'new_comment', label: '新規コメント' },
  { value: 'request_update', label: '要望更新' },
  { value: 'alert_near_expiry', label: '期限切れ間近' },
  { value: 'alert_excess_stock', label: '過剰在庫' },
  { value: 'alert_resolved', label: 'アラート解消' },
  { value: 'match_update', label: '候補更新' },
  { value: 'matching_refresh_complete', label: '候補再計算完了' },
  { value: 'group_invitation', label: 'グループ招待' },
  { value: 'group_join', label: 'グループ参加' },
  { value: 'group_leave', label: 'グループ離脱' },
] as const;

const ADMIN_NOTIFICATION_TYPE_LABELS = Object.fromEntries(
  ADMIN_NOTIFICATION_TYPE_OPTIONS.map((option) => [option.value, option.label]),
) as Record<string, string>;

function getNotificationTypeLabel(type: string): string {
  return ADMIN_NOTIFICATION_TYPE_LABELS[type] ?? type;
}

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

  const fetchNotifications = useCallback((targetPage: number, signal?: AbortSignal) => {
    const params = new URLSearchParams({ page: String(targetPage) });
    if (typeFilter) params.set('type', typeFilter);
    return api.get<NotificationsResponse>(`/admin/notifications?${params}`, { signal });
  }, [typeFilter]);

  const {
    items,
    page,
    setPage,
    totalPages,
    loading,
    error,
    retry,
  } = usePaginatedList<NotificationItem, NotificationsResponse>(
    fetchNotifications,
    { errorMessage: '通知一覧の取得に失敗しました' },
  );

  return (
    <PageShell>
      <div className="dl-page-header">
        <div className="dl-page-header-copy">
          <h4 className="page-title mb-0">通知・配信状況</h4>
        </div>
        <div className="dl-page-header-actions mobile-stack">
          <Link to="/admin/alerts" className="btn btn-primary btn-sm">アラート管理</Link>
          <AppDropdownMenu
            label="関連画面"
            variant="outline-secondary"
            items={[
              { key: 'matching-experiments', to: '/admin/matching-experiments', label: 'マッチング実験' },
              { key: 'upload-quality', to: '/admin/upload-quality', label: 'アップロード品質' },
              { key: 'rate-limits', to: '/admin/rate-limits', label: 'レート制限設定' },
              { key: 'direct-messages', to: '/admin/direct-messages', label: 'ユーザー間メッセージ' },
            ]}
          />
        </div>
      </div>

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
                    <Badge key={t.type} bg="secondary" className="small">{getNotificationTypeLabel(t.type)}: {t.count}</Badge>
                  ))}
                </div>
              </Card>
            </Col>
          </Row>
        )}

        <AppDataPanel title="関連運用" className="mb-3">
          <div className="dl-action-row mobile-stack">
            <Link to="/admin/direct-messages" className="btn btn-outline-primary btn-sm">ユーザー間メッセージ</Link>
            <AppDropdownMenu
              label="関連"
              size="sm"
              variant="outline-secondary"
              items={[
                { key: 'log-center', to: '/admin/log-center', label: 'ログセンター' },
                { key: 'error-codes', to: '/admin/error-codes', label: 'エラーコード' },
                { key: 'rate-limits', to: '/admin/rate-limits', label: 'レート制限設定' },
              ]}
            />
          </div>
          <div className="small text-muted mt-2">
            通知の異常は、配信確認からログ調査、エラーコード確認、制限設定確認までこの近傍で追えます。
          </div>
        </AppDataPanel>

        <Tabs defaultActiveKey="notifications" className="mb-3" onSelect={(k) => { if (k === 'subscriptions') loadSubscriptions(); }}>
          <Tab eventKey="notifications" title="通知一覧">
            <Row className="mb-3 g-2">
              <Col xs={12} md={4}>
                <Form.Select size="sm" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}>
                  <option value="">すべてのタイプ</option>
                  {ADMIN_NOTIFICATION_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </Form.Select>
              </Col>
            </Row>

            {error && <ErrorRetryAlert error={error} onRetry={() => void retry()} />}

            {loading ? (
              <InlineLoader text="通知を読み込み中..." className="text-muted small" />
            ) : items.length === 0 ? (
              <AppEmptyState
                title="通知がありません"
                description="通知が送信されるとここに表示されます。配信条件や制限設定を見直したい場合は近接導線から確認できます。"
                action={(
                  <div className="mt-3 dl-action-row mobile-stack justify-content-center">
                    <Link to="/admin/log-center" className="btn btn-outline-secondary btn-sm">ログセンター</Link>
                    <AppDropdownMenu
                      label="関連"
                      variant="outline-secondary"
                      items={[
                        { key: 'rate-limits', to: '/admin/rate-limits', label: 'レート制限設定' },
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
                            <td><Badge bg="secondary">{getNotificationTypeLabel(n.type)}</Badge></td>
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
                            <Badge bg="secondary" className="me-1">{getNotificationTypeLabel(n.type)}</Badge>
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
              <div className="table-responsive">
                <AppTable striped hover size="sm" className="mobile-table">
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
              </div>
            )}
          </Tab>
        </Tabs>
      </ScrollArea>
    </PageShell>
  );
}
