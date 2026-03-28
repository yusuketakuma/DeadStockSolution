import { useState, useCallback, useEffect } from 'react';
import { Badge, Nav, Tab, Form, Row, Col } from 'react-bootstrap';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import AppButton from '../components/ui/AppButton';
import AppDataPanel from '../components/ui/AppDataPanel';
import AppEmptyState from '../components/ui/AppEmptyState';
import AppModalShell from '../components/ui/AppModalShell';
import AppMobileDataCard from '../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../components/ui/AppResponsiveSwitch';
import ErrorRetryAlert from '../components/ui/ErrorRetryAlert';
import InlineLoader from '../components/ui/InlineLoader';
import Pagination from '../components/Pagination';
import PageShell, { ScrollArea } from '../components/ui/PageShell';
import PullToRefresh from '../components/gesture/PullToRefresh';
import SwipeableListItem from '../components/gesture/SwipeableListItem';

// ── 型定義 ──────────────────────────────────────
type AlertType = 'near_expiry' | 'excess_stock';

interface AlertItem {
  id: number;
  pharmacyId: number;
  alertType: AlertType;
  title: string;
  message: string;
  detailJson: Record<string, unknown>;
  detectedAt: string;
  resolvedAt: string | null;
  notificationId?: number | null;
}

interface AlertListResponse {
  alerts: AlertItem[];
  total: number;
  offset: number;
  limit: number;
  unresolvedCount: number;
}

interface AlertStats {
  unresolvedCount: number;
  byType: Record<string, number>;
}

interface AffectedItem {
  drugName: string;
  quantity: number;
  expiryDate?: string;
  estimatedLoss?: number;
}

// ── 定数 ──────────────────────────────────────
const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  near_expiry: '期限切迫',
  excess_stock: '過剰在庫',
};

const ALERT_TYPE_VARIANTS: Record<AlertType, string> = {
  near_expiry: 'danger',
  excess_stock: 'warning',
};

const PAGE_SIZE = 20;

// ── ヘルパー関数 ──────────────────────────────────────
function formatDateTime(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleDateString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function parseAffectedItems(detailJson: Record<string, unknown>): AffectedItem[] {
  if (!detailJson || !Array.isArray(detailJson.affectedItems)) return [];
  return detailJson.affectedItems as AffectedItem[];
}

function parseTotalEstimatedLoss(detailJson: Record<string, unknown>): number | null {
  if (typeof detailJson?.totalEstimatedLoss === 'number') return detailJson.totalEstimatedLoss;
  if (typeof detailJson?.totalValue === 'number') return detailJson.totalValue;
  if (typeof detailJson?.totalExcessValue === 'number') return detailJson.totalExcessValue;
  return null;
}

function parseEarliestExpiry(detailJson: Record<string, unknown>): string | null {
  if (typeof detailJson?.earliestExpiry === 'string') return detailJson.earliestExpiry;
  if (typeof detailJson?.nearestExpiryDate === 'string') return detailJson.nearestExpiryDate;
  return null;
}

function buildAlertsQuery(page: number, resolvedTab: 'unresolved' | 'resolved', alertTypeFilter: string): string {
  const offset = (page - 1) * PAGE_SIZE;
  const resolved = resolvedTab === 'resolved';
  const params = new URLSearchParams({
    resolved: String(resolved),
    offset: String(offset),
    limit: String(PAGE_SIZE),
  });
  if (alertTypeFilter) {
    params.set('type', alertTypeFilter);
  }
  return params.toString();
}

function resolveAlertRequestError(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

// ── メインコンポーネント ──────────────────────────────────────
export default function AlertListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [resolvedTab, setResolvedTab] = useState<'unresolved' | 'resolved'>(() => searchParams.get('tab') === 'resolved' ? 'resolved' : 'unresolved');
  const [alertTypeFilter, setAlertTypeFilter] = useState<string>(() => searchParams.get('type') ?? '');
  const [page, setPage] = useState(1);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [resolving, setResolving] = useState<number | null>(null);

  // 詳細モーダル
  const [detailAlert, setDetailAlert] = useState<AlertItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // 統計
  const [stats, setStats] = useState<AlertStats | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // ── データ取得 ──────────────────────────────────────
  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get<AlertListResponse>(`/alerts?${buildAlertsQuery(page, resolvedTab, alertTypeFilter)}`);
      setAlerts(data.alerts);
      setTotal(data.total);
    } catch (err) {
      setError(resolveAlertRequestError(err, 'アラートの取得に失敗しました'));
      setAlerts([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, resolvedTab, alertTypeFilter]);

  const fetchStats = useCallback(async () => {
    try {
      const data = await api.get<AlertStats>('/alerts/stats');
      setStats(data);
    } catch {
      // 統計取得失敗はサイレント
    }
  }, []);

  useEffect(() => {
    void fetchAlerts();
  }, [fetchAlerts]);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  // タブ/フィルタ切替時にページをリセット
  useEffect(() => {
    setPage(1);
  }, [resolvedTab, alertTypeFilter]);

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('tab', resolvedTab);
    if (alertTypeFilter) {
      nextParams.set('type', alertTypeFilter);
    } else {
      nextParams.delete('type');
    }
    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [alertTypeFilter, resolvedTab, searchParams, setSearchParams]);

  // ── アクション ──────────────────────────────────────
  const handleResolve = async (alertId: number) => {
    setResolving(alertId);
    try {
      await api.patch(`/alerts/${alertId}/resolve`);
      void fetchAlerts();
      void fetchStats();
    } catch (err) {
      setError(resolveAlertRequestError(err, 'アラートの解決に失敗しました'));
    } finally {
      setResolving(null);
    }
  };

  const handleShowDetail = async (alertId: number) => {
    setDetailLoading(true);
    try {
      const data = await api.get<AlertItem>(`/alerts/${alertId}`);
      setDetailAlert(data);
    } catch (err) {
      setError(resolveAlertRequestError(err, 'アラート詳細の取得に失敗しました'));
    } finally {
      setDetailLoading(false);
    }
  };

  const handleTabChange = (key: string | null) => {
    if (key === 'unresolved' || key === 'resolved') {
      setResolvedTab(key);
    }
  };

  // ── 詳細モーダル ──────────────────────────────────────
  const renderDetailModal = () => {
    if (!detailAlert) return null;

    const affectedItems = parseAffectedItems(detailAlert.detailJson);
    const totalLoss = parseTotalEstimatedLoss(detailAlert.detailJson);
    const earliestExpiry = parseEarliestExpiry(detailAlert.detailJson);

    return (
      <AppModalShell
        show={true}
        title="アラート詳細"
        onHide={() => setDetailAlert(null)}
        size="lg"
        footer={
          <div className="d-flex gap-2 w-100 justify-content-between flex-wrap">
            <div className="d-flex gap-2">
              <Link to="/inventory/dead-stock" className="btn btn-outline-primary btn-sm">
                在庫を見る
              </Link>
              <Link to="/proposals" className="btn btn-outline-primary btn-sm">
                提案を作成
              </Link>
            </div>
            <AppButton variant="secondary" size="sm" onClick={() => setDetailAlert(null)}>
              閉じる
            </AppButton>
          </div>
        }
      >
        <div className="mb-3">
          <h6>{detailAlert.title}</h6>
          <Badge bg={ALERT_TYPE_VARIANTS[detailAlert.alertType]} className="me-2">
            {ALERT_TYPE_LABELS[detailAlert.alertType]}
          </Badge>
          <small className="text-muted">{formatDateTime(detailAlert.detectedAt)}</small>
        </div>
        <p className="text-muted">{detailAlert.message}</p>

        {totalLoss !== null && (
          <div className="mb-3">
            <strong>推定損失額: </strong>
            <span className="text-danger">¥{totalLoss.toLocaleString()}</span>
          </div>
        )}

        {earliestExpiry && (
          <div className="mb-3">
            <strong>最早期限: </strong>
            <span>{earliestExpiry}</span>
          </div>
        )}

        {affectedItems.length > 0 && (
          <div>
            <h6 className="mb-2">対象品目</h6>
            <div className="table-responsive">
              <table className="table table-sm table-striped">
                <thead>
                  <tr>
                    <th>薬品名</th>
                    <th>数量</th>
                    <th>期限</th>
                    <th>推定損失</th>
                  </tr>
                </thead>
                <tbody>
                  {affectedItems.map((item, idx) => (
                    <tr key={idx}>
                      <td>{item.drugName}</td>
                      <td>{item.quantity}</td>
                      <td>{item.expiryDate ?? '-'}</td>
                      <td>{item.estimatedLoss != null ? `¥${item.estimatedLoss.toLocaleString()}` : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {detailAlert.resolvedAt && (
          <div className="mt-3">
            <Badge bg="success">解決済み</Badge>
            <small className="text-muted ms-2">{formatDateTime(detailAlert.resolvedAt)}</small>
          </div>
        )}
      </AppModalShell>
    );
  };

  // ── アラートカード（デスクトップ行） ──────────────────────────────────────
  const renderDesktopRow = (alert: AlertItem) => (
    <tr key={alert.id}>
      <td>
        <Badge bg={ALERT_TYPE_VARIANTS[alert.alertType]}>
          {ALERT_TYPE_LABELS[alert.alertType]}
        </Badge>
      </td>
      <td>
        <div className="fw-semibold">{alert.title}</div>
        <small className="text-muted">{alert.message}</small>
      </td>
      <td className="text-nowrap">{formatDateTime(alert.detectedAt)}</td>
      <td>
        <div className="d-flex gap-1">
          <AppButton size="sm" variant="outline-primary" onClick={() => void handleShowDetail(alert.id)}>
            詳細
          </AppButton>
          {!alert.resolvedAt && (
            <AppButton
              size="sm"
              variant="outline-success"
              onClick={() => void handleResolve(alert.id)}
              disabled={resolving === alert.id}
            >
              {resolving === alert.id ? '処理中...' : '解決'}
            </AppButton>
          )}
          {alert.resolvedAt && (
            <Badge bg="success" className="align-self-center">解決済み</Badge>
          )}
        </div>
      </td>
    </tr>
  );

  // ── アラートカード（モバイル） ──────────────────────────────────────
  const renderMobileCard = (alert: AlertItem) => (
    <AppMobileDataCard
      key={alert.id}
      title={alert.title}
      subtitle={alert.message}
      badges={
        <Badge bg={ALERT_TYPE_VARIANTS[alert.alertType]}>
          {ALERT_TYPE_LABELS[alert.alertType]}
        </Badge>
      }
      fields={[
        { label: '検出日時', value: formatDateTime(alert.detectedAt) },
        { label: '状態', value: alert.resolvedAt ? '解決済み' : '未解決' },
      ]}
      actions={
        <div className="d-flex gap-1">
          <AppButton size="sm" variant="outline-primary" onClick={() => void handleShowDetail(alert.id)}>
            詳細
          </AppButton>
          {!alert.resolvedAt && (
            <AppButton
              size="sm"
              variant="outline-success"
              onClick={() => void handleResolve(alert.id)}
              disabled={resolving === alert.id}
            >
              {resolving === alert.id ? '処理中...' : '解決'}
            </AppButton>
          )}
        </div>
      }
    />
  );

  // ── レンダリング ──────────────────────────────────────
  return (
    <PageShell>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h4 className="page-title mb-0">アラート一覧</h4>
        {stats && (
          <Badge bg="danger" pill>
            未解決 {stats.unresolvedCount}件
          </Badge>
        )}
      </div>

      {error && (
        <ErrorRetryAlert error={error} onRetry={() => void fetchAlerts()} />
      )}

      <Tab.Container activeKey={resolvedTab} onSelect={handleTabChange}>
        <Nav variant="tabs" className="mb-3">
          <Nav.Item>
            <Nav.Link eventKey="unresolved" role="tab">
              未解決
              {stats && stats.unresolvedCount > 0 && (
                <Badge bg="danger" pill className="ms-1">{stats.unresolvedCount}</Badge>
              )}
            </Nav.Link>
          </Nav.Item>
          <Nav.Item>
            <Nav.Link eventKey="resolved" role="tab">解決済み</Nav.Link>
          </Nav.Item>
        </Nav>

        <Row className="mb-3 align-items-center">
          <Col xs="auto">
            <Form.Select
              size="sm"
              value={alertTypeFilter}
              onChange={(e) => setAlertTypeFilter(e.target.value)}
              aria-label="タイプフィルター"
            >
              <option value="">すべてのタイプ</option>
              <option value="near_expiry">期限切迫</option>
              <option value="excess_stock">過剰在庫</option>
            </Form.Select>
          </Col>
          <Col xs="auto" className="text-muted small">
            {total}件
          </Col>
        </Row>

        <Tab.Content>
          <Tab.Pane eventKey={resolvedTab}>
            <ScrollArea>
              <PullToRefresh onRefresh={async () => { await fetchAlerts(); }}>
              {loading ? (
                <InlineLoader text="アラートを読み込み中..." className="text-muted small" />
              ) : alerts.length === 0 ? (
                <AppEmptyState
                  title={resolvedTab === 'unresolved' ? '未解決のアラートはありません' : '解決済みのアラートはありません'}
                  description="アラートが検出されると、ここに表示されます。"
                />
              ) : (
                <AppResponsiveSwitch
                  desktop={() => (
                    <AppDataPanel>
                      <div className="table-responsive">
                        <table className="table table-hover table-sm mb-0">
                          <thead className="table-light">
                            <tr>
                              <th>タイプ</th>
                              <th>内容</th>
                              <th>検出日時</th>
                              <th>操作</th>
                            </tr>
                          </thead>
                          <tbody>
                            {alerts.map(renderDesktopRow)}
                          </tbody>
                        </table>
                      </div>
                    </AppDataPanel>
                  )}
                  mobile={() => (
                    <div className="dl-mobile-data-list">
                      {alerts.map((alert) => (
                        <SwipeableListItem
                          key={`swipe-${alert.id}`}
                          onSwipeLeft={!alert.resolvedAt ? () => void handleResolve(alert.id) : undefined}
                          leftContent={!alert.resolvedAt ? <div className="swipe-bg-info"><span className="swipe-icon" aria-hidden="true">{'\u2713'}</span> 既読</div> : undefined}
                          undoDuration={0}
                        >
                          {renderMobileCard(alert)}
                        </SwipeableListItem>
                      ))}
                    </div>
                  )}
                />
              )}
              </PullToRefresh>
            </ScrollArea>
          </Tab.Pane>
        </Tab.Content>
      </Tab.Container>

      <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />

      {renderDetailModal()}
      {detailLoading && (
        <div className="position-fixed top-50 start-50 translate-middle">
          <InlineLoader text="詳細を読み込み中..." />
        </div>
      )}
    </PageShell>
  );
}
