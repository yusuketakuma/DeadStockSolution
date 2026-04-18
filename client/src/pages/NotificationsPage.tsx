import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, Col, Form, Row } from 'react-bootstrap';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AppAlert from '../components/ui/AppAlert';
import AppButton from '../components/ui/AppButton';
import AppEmptyState from '../components/ui/AppEmptyState';
import AppMobileDataCard from '../components/ui/AppMobileDataCard';
import AppResponsiveSwitch from '../components/ui/AppResponsiveSwitch';
import AppDropdownMenu from '../components/ui/AppDropdownMenu';
import SavedViewsPanel from '../components/ui/SavedViewsPanel';
import AppSkeleton from '../components/ui/AppSkeleton';
import ErrorRetryAlert from '../components/ui/ErrorRetryAlert';
import PageShell, { ScrollArea } from '../components/ui/PageShell';
import WorkContextBar from '../components/ui/WorkContextBar';
import { useListDetailRouteState } from '../hooks/useListDetailRouteState';
import { useKeyboardListNavigation } from '../hooks/useKeyboardListNavigation';
import { useSseRefresh } from '../hooks/useSseRefresh';
import { useTrackRecentWork } from '../hooks/useRecentWork';
import { useSavedViews } from '../hooks/useSavedViews';
import { useTimeline } from '../contexts/TimelineContext';
import { useToast } from '../contexts/ToastContext';
import {
  fetchNotices,
  clearNotificationGroupState,
  markAllNoticesRead,
  markNotificationGroupRead,
  markNoticeRead,
  snoozeNotificationGroup,
  type NoticeItem,
  type NoticesResponse,
} from '../api/notifications';
import { formatDateTimeJa } from '../utils/formatters';
import { sanitizeInternalPath } from '../utils/navigation';

const LIVE_REFRESH_INTERVAL_MS = 60_000;
const NOTICE_SNOOZE_STORAGE_KEY = 'notifications:snoozedUntil';
const ACTIONABLE_NOTICE_TYPES = new Set(['alert', 'inbound_request', 'status_update', 'match_update']);
const NOTIFICATION_SAVED_VIEWS_KEY = 'notifications:saved-views';
const GENERIC_NOTICE_ACTION_LABELS = new Set(['開く', '詳細へ', '確認する', 'アラートを見る']);

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
    return { label: '要望を確認', to: '/requests' };
  }
  if (typeFilter === 'new_comment' || typeFilter === 'admin_message') {
    return { label: 'メッセージを確認', to: '/messages' };
  }
  if (typeFilter === 'match_update') {
    return { label: '候補を確認', to: '/matching' };
  }
  return { label: 'アラートを確認', to: '/alerts' };
}

function resolveNoticeActionLabel(item: Pick<NoticeItem, 'type' | 'actionPath' | 'actionLabel'>): string {
  const rawLabel = typeof item.actionLabel === 'string' ? item.actionLabel.trim() : '';
  if (rawLabel && !GENERIC_NOTICE_ACTION_LABELS.has(rawLabel)) {
    return rawLabel;
  }

  const safePath = sanitizeInternalPath(item.actionPath, '/');
  if (safePath === '/alerts' || item.type === 'alert') {
    return 'アラートを確認';
  }
  if (
    safePath.startsWith('/proposals')
    || item.type === 'status_update'
    || item.type === 'inbound_request'
    || item.type === 'outbound_request'
  ) {
    return '案件を確認';
  }
  if (safePath.startsWith('/messages') || item.type === 'admin_message' || item.type === 'new_comment') {
    return 'メッセージを確認';
  }
  if (safePath.startsWith('/matching') || item.type === 'match_update') {
    return '候補を確認';
  }
  if (safePath === '/') {
    return '通知を確認';
  }
  return rawLabel || '内容を確認';
}

function readSnoozedNoticeMap(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(NOTICE_SNOOZE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    return Object.fromEntries(
      Object.entries(parsed).filter(([, until]) => Number.isFinite(until) && until > Date.now()),
    );
  } catch {
    return {};
  }
}

function writeSnoozedNoticeMap(value: Record<string, number>) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(NOTICE_SNOOZE_STORAGE_KEY, JSON.stringify(value));
}

interface NotificationSavedFilters {
  searchText: string;
  typeFilter: string;
  showUnreadOnly: boolean;
  showDeadlineOnly: boolean;
}

export default function NotificationsPage() {
  const { refreshUnreadCount } = useTimeline();
  const { showInfo, showSuccess } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { requestedSelectedValue, updateListDetailRouteState } = useListDetailRouteState(searchParams, setSearchParams);
  const [items, setItems] = useState<NoticeItem[]>([]);
  const [groupedCasesState, setGroupedCasesState] = useState<NoticesResponse['groupedCases']>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [snoozedUntilById, setSnoozedUntilById] = useState<Record<string, number>>(() => readSnoozedNoticeMap());
  const {
    savedViews,
    createSavedView,
    deleteSavedView,
  } = useSavedViews<NotificationSavedFilters>(NOTIFICATION_SAVED_VIEWS_KEY);
  const requestedTypeFilter = searchParams.get('type') ?? 'all';
  const requestedUnreadOnly = searchParams.get('unread') === '1';
  const requestedDeadlineOnly = searchParams.get('deadline') === '1';
  const requestedSearchText = searchParams.get('q') ?? '';
  const requestedSelectedId = requestedSelectedValue ?? '';
  const [searchText, setSearchText] = useState(requestedSearchText);
  const [typeFilter, setTypeFilter] = useState(requestedTypeFilter);
  const [showUnreadOnly, setShowUnreadOnly] = useState(requestedUnreadOnly);
  const [showDeadlineOnly, setShowDeadlineOnly] = useState(requestedDeadlineOnly);
  const [selectedNoticeId, setSelectedNoticeId] = useState<string | null>(requestedSelectedId || null);

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
      if (mode === 'replace') {
        setGroupedCasesState(response.groupedCases ?? []);
      }
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
    writeSnoozedNoticeMap(snoozedUntilById);
  }, [snoozedUntilById]);

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
    setSearchText((current) => (current === requestedSearchText ? current : requestedSearchText));
  }, [requestedSearchText]);

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
    if (searchText.trim()) {
      nextParams.set('q', searchText.trim());
    } else {
      nextParams.delete('q');
    }
    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [searchParams, searchText, setSearchParams, showDeadlineOnly, showUnreadOnly, typeFilter]);

  useEffect(() => {
    updateListDetailRouteState({ selected: selectedNoticeId });
  }, [selectedNoticeId, updateListDetailRouteState]);

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

  const resolveActionPath = useCallback((path: string | null | undefined) => sanitizeInternalPath(path, '/'), []);

  const visibleItems = useMemo(() => items.filter((item) => {
    const snoozedUntil = snoozedUntilById[item.id];
    // eslint-disable-next-line react-hooks/purity
    return !snoozedUntil || snoozedUntil <= Date.now();
  }), [items, snoozedUntilById]);

  const filteredItems = useMemo(() => visibleItems.filter((item) => {
    if (searchText.trim()) {
      const haystack = `${item.title} ${item.body} ${TYPE_LABELS[item.type] ?? item.type}`.toLowerCase();
      if (!haystack.includes(searchText.trim().toLowerCase())) return false;
    }
    if (typeFilter !== 'all' && item.type !== typeFilter) return false;
    if (showUnreadOnly && !item.unread) return false;
    if (showDeadlineOnly && !isDeadlineSoon(item.deadlineAt)) return false;
    return true;
  }), [searchText, showDeadlineOnly, showUnreadOnly, typeFilter, visibleItems]);
  const selectedNotice = useMemo(() => filteredItems.find((item) => item.id === selectedNoticeId) ?? null, [filteredItems, selectedNoticeId]);

  const summary = useMemo(() => ({
    unread: visibleItems.filter((item) => item.unread).length,
    actionable: visibleItems.filter((item) => item.unread && ACTIONABLE_NOTICE_TYPES.has(item.type)).length,
    dueSoon: visibleItems.filter((item) => isDeadlineSoon(item.deadlineAt)).length,
    snoozed: items.length - visibleItems.length,
  }), [items.length, visibleItems]);
  const actionQueue = useMemo(() => filteredItems
    .filter((item) => item.unread || isDeadlineSoon(item.deadlineAt) || ACTIONABLE_NOTICE_TYPES.has(item.type))
    .sort((left, right) => {
      const urgencyDiff = Number(isDeadlineSoon(right.deadlineAt)) - Number(isDeadlineSoon(left.deadlineAt));
      if (urgencyDiff !== 0) return urgencyDiff;
      const unreadDiff = Number(right.unread) - Number(left.unread);
      if (unreadDiff !== 0) return unreadDiff;
      if (left.priority !== right.priority) return left.priority - right.priority;
      return new Date(right.createdAt ?? '').getTime() - new Date(left.createdAt ?? '').getTime();
    })
    .slice(0, 3), [filteredItems]);
  const groupedCases = useMemo(() => {
    if (groupedCasesState && groupedCasesState.length > 0 && typeFilter === 'all' && !showUnreadOnly && !showDeadlineOnly) {
      return groupedCasesState.map((group) => ({
        ...group,
        types: group.types.map((type) => TYPE_LABELS[type] ?? type),
      }));
    }
    const groups = new Map<string, NoticeItem[]>();
    for (const item of filteredItems) {
      const key = resolveActionPath(item.actionPath);
      const current = groups.get(key) ?? [];
      current.push(item);
      groups.set(key, current);
    }
    return [...groups.entries()]
      .map(([actionPath, notices]) => {
        const sorted = [...notices].sort((left, right) =>
          new Date(right.createdAt ?? '').getTime() - new Date(left.createdAt ?? '').getTime());
        const latest = sorted[0];
        return {
          actionPath,
          latest,
          count: sorted.length,
          unreadCount: sorted.filter((notice) => notice.unread).length,
          types: [...new Set(sorted.map((notice) => TYPE_LABELS[notice.type] ?? notice.type))],
        };
      })
      .filter((group) => group.latest)
      .sort((left, right) => right.count - left.count || new Date(right.latest.createdAt ?? '').getTime() - new Date(left.latest.createdAt ?? '').getTime())
      .slice(0, 5);
  }, [filteredItems, groupedCasesState, resolveActionPath, showDeadlineOnly, showUnreadOnly, typeFilter]);
  const relatedActionLinks = useMemo(() => [
    { to: '/matching', label: '候補を確認', variant: summary.actionable > 0 ? 'outline-primary' : 'outline-secondary' },
    { to: '/messages', label: 'メッセージを確認', variant: 'outline-secondary' },
    { to: '/requests', label: '要望を確認', variant: summary.actionable > 0 ? 'outline-primary' : 'outline-secondary' },
    { to: '/alerts', label: 'アラートを確認', variant: summary.dueSoon > 0 ? 'outline-warning' : 'outline-secondary' },
    { to: '/groups', label: 'グループを確認', variant: 'outline-secondary' },
    { to: '/bookmarks', label: 'ブックマークを確認', variant: 'outline-secondary' },
    { to: '/account', label: '通知設定', variant: 'outline-secondary' },
  ] as const, [summary.actionable, summary.dueSoon]);
  const emptyStateAction = useMemo(() => resolveEmptyStateAction(typeFilter), [typeFilter]);

  useEffect(() => {
    if (requestedSelectedId && requestedSelectedId !== selectedNoticeId) {
      setSelectedNoticeId(requestedSelectedId);
    }
  }, [requestedSelectedId, selectedNoticeId]);

  useEffect(() => {
    if (filteredItems.length === 0) {
      setSelectedNoticeId(null);
      return;
    }
    if (selectedNoticeId && filteredItems.some((item) => item.id === selectedNoticeId)) {
      return;
    }
    setSelectedNoticeId(filteredItems[0].id);
  }, [filteredItems, selectedNoticeId]);

  useTrackRecentWork(selectedNotice ? {
    id: `notice-${selectedNotice.id}`,
    label: selectedNotice.title,
    to: resolveActionPath(selectedNotice.actionPath),
    section: '通知センター',
    subtitle: TYPE_LABELS[selectedNotice.type] ?? selectedNotice.type,
  } : null);

  useKeyboardListNavigation({
    ids: filteredItems.map((item) => item.id),
    selectedId: selectedNoticeId,
    setSelectedId: (id) => setSelectedNoticeId(id),
    onEnter: (id) => {
      const item = filteredItems.find((candidate) => candidate.id === id);
      if (item) void handleOpenNotice(item);
    },
    onPrimaryAction: (id) => {
      const item = filteredItems.find((candidate) => candidate.id === id);
      if (item?.unread) void handleMarkSingleRead(item);
    },
    onSecondaryAction: (id) => {
      const item = filteredItems.find((candidate) => candidate.id === id);
      if (item) handleSnoozeNotice(item);
    },
    searchTargetId: 'notifications-search',
  });

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

  const handleSnoozeNotice = (item: NoticeItem, hours = 2) => {
    const nextMap = {
      ...snoozedUntilById,
      // eslint-disable-next-line react-hooks/purity
      [item.id]: Date.now() + hours * 60 * 60 * 1000,
    };
    setSnoozedUntilById(nextMap);
    setMessage(`「${item.title}」を ${hours} 時間後に再表示します`);
    showInfo(`「${item.title}」を ${hours} 時間後に再表示します`, {
      actionLabel: '元に戻す',
      onAction: () => {
        setSnoozedUntilById((prev) => {
          const updated = { ...prev };
          delete updated[item.id];
          return updated;
        });
      },
      autoDismissMs: 5000,
    });
  };

  const handleSnoozeGroup = (actionPath: string, hours = 2) => {
    void snoozeNotificationGroup(actionPath, hours)
      .then((result) => {
        setMessage(result.message);
        showInfo(result.message, {
      actionLabel: '元に戻す',
          onAction: async () => {
            await clearNotificationGroupState(actionPath);
            await loadNotices(undefined, 'replace');
          },
          autoDismissMs: 5000,
        });
        void loadNotices(undefined, 'replace');
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '案件スヌーズに失敗しました');
      });
  };

  const handleMarkGroupRead = async (actionPath: string) => {
    setError('');
    setMessage('');
    try {
      const result = await markNotificationGroupRead(actionPath);
      void refreshUnreadCount();
      setMessage(result.message);
      showSuccess(result.message, {
        actionLabel: '元に戻す',
        onAction: async () => {
          await clearNotificationGroupState(actionPath);
          await loadNotices(undefined, 'replace');
          await refreshUnreadCount();
        },
        autoDismissMs: 5000,
      });
      await loadNotices(undefined, 'replace');
    } catch (err) {
      setError(err instanceof Error ? err.message : '案件既読処理に失敗しました');
    }
  };

  const handleClearGroupState = async (actionPath: string) => {
    setError('');
    setMessage('');
    try {
      const result = await clearNotificationGroupState(actionPath);
      setMessage(result.message);
      await loadNotices(undefined, 'replace');
    } catch (err) {
      setError(err instanceof Error ? err.message : '案件状態の解除に失敗しました');
    }
  };

  const handleOpenNotice = async (item: NoticeItem) => {
    setError('');
    setMessage('');
    setMarkingId(item.id);
    try {
      if (item.unread) {
        const handled = await markNoticeRead(item.id);
        if (handled) {
          setItems((prev) => prev.map((current) => (
            current.id === item.id ? { ...current, unread: false } : current
          )));
          void refreshUnreadCount();
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '通知の更新に失敗しました');
    } finally {
      setMarkingId(null);
      navigate(resolveActionPath(item.actionPath));
    }
  };

  const saveCurrentView = () => {
    const name = window.prompt('保存ビュー名を入力してください');
    if (!name) return;
    createSavedView(name, {
      searchText,
      typeFilter,
      showUnreadOnly,
      showDeadlineOnly,
    });
  };

  const applySavedView = (filters: NotificationSavedFilters) => {
    setSearchText(filters.searchText ?? '');
    setTypeFilter(filters.typeFilter);
    setShowUnreadOnly(filters.showUnreadOnly);
    setShowDeadlineOnly(filters.showDeadlineOnly);
  };

  return (
    <PageShell>
      <div className="dl-page-header">
        <div className="dl-page-header-copy">
          <h4 className="page-title mb-0">通知センター</h4>
          <div className="text-muted small">対応待ち、運営連絡、候補更新を一画面で追跡します。</div>
        </div>
        <div className="dl-page-header-actions d-flex gap-2 flex-wrap">
          <Link to="/alerts" className="btn btn-outline-secondary btn-sm">アラートを確認</Link>
          <Link to="/account" className="btn btn-outline-secondary btn-sm">通知設定を確認</Link>
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

      <WorkContextBar
        title="通知処理キュー"
        currentLabel={selectedNotice ? `選択中: ${selectedNotice.title}` : '選択中: なし'}
        description="未読、期限、selected notice を URL に保持するので、画面を行き来しても同じ処理位置に戻れます。"
        backTo="/"
        backLabel="ダッシュボードへ"
        badges={[
          { label: `未読 ${summary.unread}`, bg: summary.unread > 0 ? 'warning' : 'secondary', text: summary.unread > 0 ? 'dark' : undefined },
          { label: `対応待ち ${summary.actionable}`, bg: summary.actionable > 0 ? 'danger' : 'secondary' },
          selectedNotice ? { label: TYPE_LABELS[selectedNotice.type] ?? selectedNotice.type, bg: PRIORITY_BADGE[selectedNotice.priority] ?? 'secondary' } : null,
        ]}
        nextActions={[
          { to: '/requests', label: '要望キュー', variant: 'outline-secondary' },
          { to: '/messages', label: 'メッセージ一覧', variant: 'outline-secondary' },
          { to: '/alerts', label: 'アラート確認', variant: 'outline-secondary' },
        ]}
      />

      {error ? <ErrorRetryAlert error={error} onRetry={() => void loadNotices()} /> : null}
      {message && <AppAlert variant="success">{message}</AppAlert>}
      {summary.snoozed > 0 && (
        <AppAlert variant="secondary">
          いまは再表示を抑止している通知が {summary.snoozed} 件あります。
          <button
            type="button"
            className="btn btn-link btn-sm p-0 ms-2 align-baseline"
            onClick={() => setSnoozedUntilById({})}
          >
            すべて再表示
          </button>
        </AppAlert>
      )}

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

        {actionQueue.length > 0 && (
          <Card className="mb-3">
            <Card.Header>今すぐ処理する通知</Card.Header>
            <Card.Body className="d-flex flex-column gap-3">
              {actionQueue.map((item) => (
                <div key={`queue-${item.id}`} className="border rounded p-3">
                  <div className="d-flex justify-content-between align-items-start gap-2 flex-wrap">
                    <div>
                      <div className="fw-semibold">優先対応: {item.title}</div>
                      <div className="small text-muted mt-1">{item.body}</div>
                    </div>
                    <div className="d-flex gap-1 flex-wrap">
                      {item.unread ? <Badge bg="warning">未読</Badge> : <Badge bg="success">既読</Badge>}
                      <Badge bg={PRIORITY_BADGE[item.priority] ?? 'secondary'}>{TYPE_LABELS[item.type] ?? item.type}</Badge>
                      {isDeadlineSoon(item.deadlineAt) ? <Badge bg="danger">24時間以内</Badge> : null}
                    </div>
                  </div>
                  <div className="d-flex gap-2 flex-wrap mt-3">
                    <AppButton
                      type="button"
                      size="sm"
                      variant="primary"
                      onClick={() => void handleOpenNotice(item)}
                    >
                      開いて処理する
                    </AppButton>
                    <AppButton
                      type="button"
                      size="sm"
                      variant="outline-secondary"
                      onClick={() => handleSnoozeNotice(item)}
                    >
                      2時間後に再表示
                    </AppButton>
                  </div>
                </div>
              ))}
            </Card.Body>
          </Card>
        )}

      <SavedViewsPanel
        description="未読や期限などの絞り込みを名前付きで保存できます。"
        shareUrl={typeof window !== 'undefined' ? window.location.href : null}
        savedViews={savedViews}
        presets={[
          {
            key: 'notifications-unread',
            name: '未読処理',
            description: '未読だけに絞ります。',
            filters: { searchText: '', typeFilter: 'all', showUnreadOnly: true, showDeadlineOnly: false },
          },
          {
            key: 'notifications-deadline',
            name: '期限切迫',
            description: '24時間以内の通知だけに絞ります。',
            filters: { searchText: '', typeFilter: 'all', showUnreadOnly: false, showDeadlineOnly: true },
          },
        ]}
        onSave={saveCurrentView}
        onApply={applySavedView}
        onDelete={deleteSavedView}
      />

        {groupedCases.length > 0 && (
          <Card className="mb-3">
            <Card.Header>案件単位のまとめ</Card.Header>
            <Card.Body className="d-flex flex-column gap-2">
              {groupedCases.map((group) => (
                <div key={`group-${group.actionPath}`} className="border rounded p-3">
                  <div className="d-flex justify-content-between align-items-start gap-2 flex-wrap">
                    <div>
                      <div className="fw-semibold">案件: {group.latest.title}</div>
                      <div className="small text-muted">
                        {group.types.join(' / ')} / 通知 {group.count} 件 / 未読 {group.unreadCount} 件
                      </div>
                      <div className="small text-muted mt-1">{group.latest.body}</div>
                    </div>
                    <div className="d-flex gap-2 flex-wrap">
                      <Link to={group.actionPath} className="btn btn-outline-primary btn-sm">
                        {resolveNoticeActionLabel(group.latest)}
                      </Link>
                      <AppButton type="button" size="sm" variant="outline-secondary" onClick={() => void handleOpenNotice(group.latest)}>
                        最新を確認して既読
                      </AppButton>
                      <AppButton type="button" size="sm" variant="outline-secondary" onClick={() => void handleMarkGroupRead(group.actionPath)}>
                        案件を一括既読
                      </AppButton>
                      <AppButton type="button" size="sm" variant="outline-secondary" onClick={() => handleSnoozeGroup(group.actionPath)}>
                        案件を後で
                      </AppButton>
                      <AppButton type="button" size="sm" variant="outline-secondary" onClick={() => void handleClearGroupState(group.actionPath)}>
                        状態を解除
                      </AppButton>
                    </div>
                  </div>
                </div>
              ))}
            </Card.Body>
          </Card>
        )}

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
            <Form.Control
              id="notifications-search"
              size="sm"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="通知を検索"
              style={{ maxWidth: 240 }}
            />
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
              <div className={`dl-two-pane-grid${selectedNotice ? ' dl-pane-detail-active' : ''}`}>
                <div className="dl-stack-gap-md">
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
                          <tr
                            key={item.id}
                            className={selectedNoticeId === item.id ? 'table-primary' : undefined}
                            onClick={() => setSelectedNoticeId(item.id)}
                            style={{ cursor: 'pointer' }}
                          >
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
                            <td onClick={(event) => event.stopPropagation()}>
                              <div className="d-flex gap-2 flex-wrap">
                                <Link to={resolveActionPath(item.actionPath)} className="btn btn-outline-primary btn-sm">
                                  {resolveNoticeActionLabel(item)}
                                </Link>
                                <Button
                                  size="sm"
                                  variant="outline-primary"
                                  disabled={markingId === item.id}
                                  onClick={() => void handleOpenNotice(item)}
                                >
                                  {markingId === item.id ? '移動中...' : '確認して既読'}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline-secondary"
                                  onClick={() => handleSnoozeNotice(item)}
                                >
                                  後で
                                </Button>
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
                </div>
                <div className="dl-stack-gap-md">
                  <Card>
                    <Card.Header>選択中の通知</Card.Header>
                    <Card.Body className="d-flex flex-column gap-3">
                      {selectedNotice ? (
                        <>
                          <div>
                            <div className="fw-semibold">{selectedNotice.title}</div>
                            <div className="small text-muted mt-1">{selectedNotice.body}</div>
                          </div>
                          <div className="d-flex gap-2 flex-wrap">
                            {selectedNotice.unread ? <Badge bg="warning">未読</Badge> : <Badge bg="success">既読</Badge>}
                            <Badge bg={PRIORITY_BADGE[selectedNotice.priority] ?? 'secondary'}>{TYPE_LABELS[selectedNotice.type] ?? selectedNotice.type}</Badge>
                            {isDeadlineSoon(selectedNotice.deadlineAt) ? <Badge bg="danger">24時間以内</Badge> : null}
                          </div>
                          <div className="small text-muted">
                            <div>期限: {selectedNotice.deadlineAt ? formatDateTimeJa(selectedNotice.deadlineAt) : '-'}</div>
                            <div>日時: {formatDateTimeJa(selectedNotice.createdAt)}</div>
                          </div>
                          <div className="d-flex gap-2 flex-wrap">
                            <Link to={resolveActionPath(selectedNotice.actionPath)} className="btn btn-sm btn-outline-primary">
                              {resolveNoticeActionLabel(selectedNotice)}
                            </Link>
                            <Button size="sm" variant="outline-primary" onClick={() => void handleOpenNotice(selectedNotice)}>
                              確認して既読
                            </Button>
                            <Button size="sm" variant="outline-secondary" onClick={() => handleSnoozeNotice(selectedNotice)}>
                              後で
                            </Button>
                          </div>
                        </>
                      ) : (
                        <div className="small text-muted">一覧から通知を選ぶと、ここで内容を確認してから処理できます。</div>
                      )}
                    </Card.Body>
                  </Card>
                </div>
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
                          {resolveNoticeActionLabel(item)}
                        </Link>
                        <Button
                          size="sm"
                          variant="outline-primary"
                          disabled={markingId === item.id}
                          onClick={() => void handleOpenNotice(item)}
                        >
                          {markingId === item.id ? '移動中...' : '確認して既読'}
                        </Button>
                        <AppDropdownMenu
                          label="その他"
                          items={[
                            {
                              key: 'open',
                              label: resolveNoticeActionLabel(item),
                              href: resolveActionPath(item.actionPath),
                            },
                            {
                              key: 'snooze',
                              label: '後で',
                              onClick: () => handleSnoozeNotice(item),
                            },
                            ...(item.unread ? [{
                              key: 'read',
                              label: markingId === item.id ? '更新中...' : '既読',
                              onClick: () => { void handleMarkSingleRead(item); },
                              disabled: markingId === item.id,
                            }] : []),
                          ]}
                        />
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
