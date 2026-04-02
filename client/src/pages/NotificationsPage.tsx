import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, Col, Form, Row } from 'react-bootstrap';
import { Link, useSearchParams } from 'react-router-dom';
import AppAlert from '../components/ui/AppAlert';
import AppButton from '../components/ui/AppButton';
import AppEmptyState from '../components/ui/AppEmptyState';
import AppMobileDataCard from '../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../components/ui/AppResponsiveSwitch';
import AppSkeleton from '../components/ui/AppSkeleton';
import ErrorRetryAlert from '../components/ui/ErrorRetryAlert';
import PageShell, { ScrollArea } from '../components/ui/PageShell';
import { useSseRefresh } from '../hooks/useSseRefresh';
import { useTimeline } from '../contexts/TimelineContext';
import {
  fetchNotices,
  markAllNoticesRead,
  markNoticeRead,
  type NoticeItem,
} from '../api/notifications';
import { formatDateTimeJa } from '../utils/formatters';
import { sanitizeInternalPath } from '../utils/navigation';

const LIVE_REFRESH_INTERVAL_MS = 60_000;

const TYPE_LABELS: Record<string, string> = {
  alert: 'アラート',
  inbound_request: '対応待ち',
  outbound_request: '送信済み',
  status_update: 'ステータス更新',
  admin_message: '運営連絡',
  match_update: '候補更新',
  new_comment: 'コメント',
};

const PRIORITY_BADGE: Record<number, string> = {
  1: 'danger',
  2: 'warning',
  3: 'primary',
  4: 'secondary',
  5: 'secondary',
};

function isDeadlineSoon(deadlineAt: string | null): boolean {
  if (!deadlineAt) return false;
  const diffMs = new Date(deadlineAt).getTime() - Date.now();
  return diffMs > 0 && diffMs <= 24 * 60 * 60 * 1000;
}

function priorityLabel(priority: number): string {
  if (priority <= 1) return '緊急';
  if (priority === 2) return '重要';
  if (priority === 3) return '通常';
  return '参考';
}

function resolveEmptyStateAction(typeFilter: string): { label: string; to: string } {
  if (typeFilter === 'inbound_request' || typeFilter === 'outbound_request' || typeFilter === 'status_update') {
    return { label: '要望一覧を見る', to: '/requests' };
  }
  if (typeFilter === 'new_comment' || typeFilter === 'admin_message') {
    return { label: 'メッセージを見る', to: '/messages' };
  }
  if (typeFilter === 'match_update') {
    return { label: 'マッチングを見る', to: '/matching' };
  }
  return { label: 'アラート一覧を見る', to: '/alerts' };
}

export default function NotificationsPage() {
  const { refreshUnreadCount } = useTimeline();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<NoticeItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const requestedTypeFilter = searchParams.get('type') ?? 'all';
  const requestedUnreadOnly = searchParams.get('unread') === '1';
  const requestedDeadlineOnly = searchParams.get('deadline') === '1';
  const [typeFilter, setTypeFilter] = useState(requestedTypeFilter);
  const [showUnreadOnly, setShowUnreadOnly] = useState(requestedUnreadOnly);
  const [showDeadlineOnly, setShowDeadlineOnly] = useState(requestedDeadlineOnly);

  const loadNotices = useCallback(async (cursor?: string, mode: 'replace' | 'append' = 'replace') => {
    if (mode === 'replace') {
      setLoading(true);
      setError('');
    } else {
      setLoadingMore(true);
    }

    try {
      const response = await fetchNotices(cursor);
      setItems((prev) => {
        if (mode === 'replace') return response.notices;
        const seen = new Set(prev.map((item) => item.id));
        return [...prev, ...response.notices.filter((item) => !seen.has(item.id))];
      });
      setHasMore(response.pagination.hasMore);
      setNextCursor(response.pagination.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : '通知の取得に失敗しました');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void loadNotices();
  }, [loadNotices]);

  useEffect(() => {
    setTypeFilter((current) => (current === requestedTypeFilter ? current : requestedTypeFilter));
  }, [requestedTypeFilter]);

  useEffect(() => {
    setShowUnreadOnly((current) => (current === requestedUnreadOnly ? current : requestedUnreadOnly));
  }, [requestedUnreadOnly]);

  useEffect(() => {
    setShowDeadlineOnly((current) => (current === requestedDeadlineOnly ? current : requestedDeadlineOnly));
  }, [requestedDeadlineOnly]);

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams);
    if (typeFilter !== 'all') {
      nextParams.set('type', typeFilter);
    } else {
      nextParams.delete('type');
    }
    if (showUnreadOnly) {
      nextParams.set('unread', '1');
    } else {
      nextParams.delete('unread');
    }
    if (showDeadlineOnly) {
      nextParams.set('deadline', '1');
    } else {
      nextParams.delete('deadline');
    }
    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, setSearchParams, showDeadlineOnly, showUnreadOnly, typeFilter]);

  useSseRefresh({
    enabled: true,
    streamPath: '/realtime/stream?topics=timeline',
    events: ['timeline.refresh'],
    onRefresh: async () => {
      await loadNotices(undefined, 'replace');
    },
    fallbackIntervalMs: LIVE_REFRESH_INTERVAL_MS,
    minFetchIntervalMs: 5_000,
  });

  const filteredItems = useMemo(() => items.filter((item) => {
    if (typeFilter !== 'all' && item.type !== typeFilter) return false;
    if (showUnreadOnly && !item.unread) return false;
    if (showDeadlineOnly && !isDeadlineSoon(item.deadlineAt)) return false;
    return true;
  }), [items, showDeadlineOnly, showUnreadOnly, typeFilter]);

  const summary = useMemo(() => ({
    unread: items.filter((item) => item.unread).length,
    actionable: items.filter((item) => item.unread && ['alert', 'inbound_request', 'status_update', 'match_update'].includes(item.type)).length,
    dueSoon: items.filter((item) => isDeadlineSoon(item.deadlineAt)).length,
  }), [items]);
  const relatedActionLinks = useMemo(() => [
    { to: '/matching', label: 'マッチング', variant: summary.actionable > 0 ? 'outline-primary' : 'outline-secondary' },
    { to: '/messages', label: 'メッセージ', variant: 'outline-secondary' },
    { to: '/requests', label: '要望一覧', variant: summary.actionable > 0 ? 'outline-primary' : 'outline-secondary' },
    { to: '/alerts', label: 'アラート一覧', variant: summary.dueSoon > 0 ? 'outline-warning' : 'outline-secondary' },
    { to: '/groups', label: 'グループ', variant: 'outline-secondary' },
    { to: '/bookmarks', label: 'ブックマーク', variant: 'outline-secondary' },
    { to: '/account', label: '通知設定', variant: 'outline-secondary' },
  ] as const, [summary.actionable, summary.dueSoon]);
  const emptyStateAction = useMemo(() => resolveEmptyStateAction(typeFilter), [typeFilter]);

  const handleMarkSingleRead = async (item: NoticeItem) => {
    setMessage('');
    setError('');
    setMarkingId(item.id);
    try {
      const handled = await markNoticeRead(item.id);
      if (handled) {
        setItems((prev) => prev.map((current) => (
          current.id === item.id ? { ...current, unread: false } : current
        )));
        void refreshUnreadCount();
      } else {
        setMessage('この通知は関連画面を開くと自動で既読になります。');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '既読更新に失敗しました');
    } finally {
      setMarkingId(null);
    }
  };

  const handleMarkAllRead = async () => {
    setMarkingAll(true);
    setError('');
    setMessage('');
    try {
      const result = await markAllNoticesRead();
      setItems((prev) => prev.map((item) => ({ ...item, unread: false })));
      void refreshUnreadCount();
      setMessage(result.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : '一括既読に失敗しました');
    } finally {
      setMarkingAll(false);
    }
  };

  const resolveActionPath = useCallback((path: string | null | undefined) => sanitizeInternalPath(path, '/'), []);

  return (
    <PageShell>
      <div className="dl-page-header">
        <div className="dl-page-header-copy">
          <h4 className="page-title mb-0">通知センター</h4>
          <div className="text-muted small">対応待ち、運営連絡、候補更新を一画面で追跡します。</div>
        </div>
        <div className="dl-page-header-actions d-flex gap-2 flex-wrap">
          <Link to="/alerts" className="btn btn-outline-secondary btn-sm">アラート一覧</Link>
          <Link to="/account" className="btn btn-outline-secondary btn-sm">通知設定</Link>
          <AppButton
            type="button"
            size="sm"
            variant="outline-secondary"
            onClick={() => void handleMarkAllRead()}
            disabled={markingAll || summary.unread === 0}
          >
            {markingAll ? '既読化中...' : '未読をすべて既読'}
          </AppButton>
        </div>
      </div>

      {error ? <ErrorRetryAlert error={error} onRetry={() => void loadNotices()} /> : null}
      {message && <AppAlert variant="success">{message}</AppAlert>}

      <ScrollArea>
        <Row className="g-3 mb-3">
          <Col md={4}>
            <Card body className="text-center">
              <div className="small text-muted">未読</div>
              <div className="fs-5 fw-bold text-warning">{summary.unread}</div>
            </Card>
          </Col>
          <Col md={4}>
            <Card body className="text-center">
              <div className="small text-muted">対応待ち</div>
              <div className="fs-5 fw-bold text-danger">{summary.actionable}</div>
            </Card>
          </Col>
          <Col md={4}>
            <Card body className="text-center">
              <div className="small text-muted">24時間以内</div>
              <div className="fs-5 fw-bold text-primary">{summary.dueSoon}</div>
            </Card>
          </Col>
        </Row>

        <Card className="mb-3">
          <Card.Header>関連画面</Card.Header>
          <Card.Body className="d-flex gap-2 flex-wrap align-items-center">
            {relatedActionLinks.map((link) => (
              <Link key={link.to} to={link.to} className={`btn btn-sm btn-${link.variant}`}>
                {link.label}
              </Link>
            ))}
            <span className="small text-muted">通知内容に応じて、対応画面と通知設定の両方へすぐ移動できます。</span>
          </Card.Body>
        </Card>

        <Card className="mb-3">
          <Card.Body className="d-flex gap-2 flex-wrap align-items-center">
            <Form.Select
              size="sm"
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              style={{ maxWidth: 220 }}
              aria-label="通知タイプ"
            >
              <option value="all">すべての通知</option>
              <option value="alert">アラート</option>
              <option value="inbound_request">対応待ち</option>
              <option value="status_update">ステータス更新</option>
              <option value="admin_message">運営連絡</option>
              <option value="match_update">候補更新</option>
              <option value="new_comment">コメント</option>
            </Form.Select>
            <Form.Check
              type="switch"
              id="notifications-unread-only"
              label="未読のみ"
              checked={showUnreadOnly}
              onChange={(event) => setShowUnreadOnly(event.target.checked)}
            />
            <Form.Check
              type="switch"
              id="notifications-deadline-only"
              label="期限切迫のみ"
              checked={showDeadlineOnly}
              onChange={(event) => setShowDeadlineOnly(event.target.checked)}
            />
          </Card.Body>
        </Card>

        {loading ? (
          <>
            <Row className="g-3 mb-3">
              {Array.from({ length: 3 }, (_, index) => (
                <Col md={4} key={index}>
                  <AppSkeleton
                    variant="card"
                    className="h-100"
                    label={index === 0 ? '通知サマリーを読み込み中' : undefined}
                  />
                </Col>
              ))}
            </Row>
            <AppResponsiveSwitch
              desktop={() => <AppSkeleton variant="table" rows={5} cols={6} label="通知一覧を読み込み中" />}
              mobile={() => (
                <div className="d-flex flex-column gap-2">
                  {Array.from({ length: 4 }, (_, index) => (
                    <AppSkeleton
                      key={index}
                      variant="card"
                      label={index === 0 ? '通知一覧を読み込み中' : undefined}
                    />
                  ))}
                </div>
              )}
            />
          </>
        ) : error && items.length === 0 ? (
          <AppEmptyState
            title="通知を読み込めませんでした"
            description="再試行ボタンからもう一度読み込みを試してください。"
          />
        ) : filteredItems.length === 0 ? (
          <AppEmptyState
            title="表示できる通知がありません"
            description="フィルタ条件を変更するか、新しい通知の到着をお待ちください。"
            actionLabel={emptyStateAction.label}
            actionTo={emptyStateAction.to}
          />
        ) : (
          <AppResponsiveSwitch
            desktop={() => (
              <div className="table-responsive">
                <table className="table table-striped align-middle">
                  <thead className="table-light">
                    <tr>
                      <th>状態</th>
                      <th>タイプ</th>
                      <th>内容</th>
                      <th>期限</th>
                      <th>日時</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map((item) => (
                      <tr key={item.id}>
                        <td>{item.unread ? <Badge bg="warning">未読</Badge> : <Badge bg="success">既読</Badge>}</td>
                        <td><Badge bg={PRIORITY_BADGE[item.priority] ?? 'secondary'}>{TYPE_LABELS[item.type] ?? item.type}</Badge></td>
                        <td>
                          <div className="fw-semibold">{item.title}</div>
                          <div className="small text-muted">{item.body}</div>
                        </td>
                        <td>
                          {item.deadlineAt ? (
                            <>
                              <div>{formatDateTimeJa(item.deadlineAt)}</div>
                              {isDeadlineSoon(item.deadlineAt) ? <Badge bg="danger">24時間以内</Badge> : null}
                            </>
                          ) : <span className="text-muted small">-</span>}
                        </td>
                        <td>{formatDateTimeJa(item.createdAt)}</td>
                        <td>
                          <div className="d-flex gap-2 flex-wrap">
                            <Link to={resolveActionPath(item.actionPath)} className="btn btn-outline-primary btn-sm">
                              {item.actionLabel || '開く'}
                            </Link>
                            {item.unread ? (
                              <Button
                                size="sm"
                                variant="outline-secondary"
                                disabled={markingId === item.id}
                                onClick={() => void handleMarkSingleRead(item)}
                              >
                                {markingId === item.id ? '更新中...' : '既読'}
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            mobile={() => (
              <div className="dl-mobile-data-list">
                {filteredItems.map((item) => (
                  <AppMobileDataCard
                    key={item.id}
                    title={item.title}
                    subtitle={TYPE_LABELS[item.type] ?? item.type}
                    badges={(
                      <div className="d-flex gap-1 flex-wrap">
                        {item.unread ? <Badge bg="warning">未読</Badge> : <Badge bg="success">既読</Badge>}
                        <Badge bg={PRIORITY_BADGE[item.priority] ?? 'secondary'}>{priorityLabel(item.priority)}</Badge>
                        {isDeadlineSoon(item.deadlineAt) ? <Badge bg="danger">24時間以内</Badge> : null}
                      </div>
                    )}
                    fields={[
                      { label: '内容', value: item.body },
                      { label: '期限', value: item.deadlineAt ? formatDateTimeJa(item.deadlineAt) : '-' },
                      { label: '日時', value: formatDateTimeJa(item.createdAt) },
                    ]}
                    actions={(
                      <div className="d-flex gap-2 flex-wrap">
                        <Link to={resolveActionPath(item.actionPath)} className="btn btn-outline-primary btn-sm">
                          {item.actionLabel || '開く'}
                        </Link>
                        {item.unread ? (
                          <Button
                            size="sm"
                            variant="outline-secondary"
                            disabled={markingId === item.id}
                            onClick={() => void handleMarkSingleRead(item)}
                          >
                            {markingId === item.id ? '更新中...' : '既読'}
                          </Button>
                        ) : null}
                      </div>
                    )}
                  />
                ))}
              </div>
            )}
          />
        )}

        {hasMore ? (
          <div className="d-flex justify-content-center mt-3">
            <Button
              variant="outline-secondary"
              disabled={loadingMore}
              onClick={() => void loadNotices(nextCursor ?? undefined, 'append')}
            >
              {loadingMore ? '読み込み中...' : '過去の通知を読み込む'}
            </Button>
          </div>
        ) : null}
      </ScrollArea>
    </PageShell>
  );
}
