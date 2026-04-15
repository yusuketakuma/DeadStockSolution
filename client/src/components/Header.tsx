import { useCallback, useEffect, useMemo, useState } from 'react';
import AppButton from './ui/AppButton';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useTimeline } from '../contexts/TimelineContext';
import AppUpdatesPopover from './header/AppUpdatesPopover';
import QuickJumpPalette, { type QuickJumpItem } from './header/QuickJumpPalette';
import NotificationDropdown from './header/NotificationDropdown';
import { sanitizeInternalPath } from '../utils/navigation';
import { APP_VERSION } from '../constants/appVersion';
import { ROUTE_META } from '../routes/route-config';
import { useRecentWorkList } from '../hooks/useRecentWork';
import type { RouteMeta } from '../routes/route-config';

interface Props {
  onToggleSidebar: () => void;
}

interface QuickAction {
  to: string;
  label: string;
}

interface GitHubUpdateItem {
  id: string;
  tag: string;
  title: string;
  body: string;
  url: string;
  publishedAt: string | null;
  prerelease: boolean;
}

export interface GitHubUpdatesResponse {
  repository: string;
  source: 'github_releases';
  stale: boolean;
  fetchedAt: string;
  items: GitHubUpdateItem[];
}

interface HeaderQuickJumpProposal {
  id: number;
  pharmacyAName: string;
  pharmacyBName: string;
  status: string;
}

interface HeaderQuickJumpAdminRequest {
  id: number;
  pharmacyName: string | null;
  requestText: string;
  workflowStatus: string | null;
}

interface HeaderQuickJumpOpenClawRequest {
  id: number;
  pharmacyName: string;
  requestText: string;
  workflowStatus: string | null;
}

const PATH_TRACK_CURRENT_KEY = 'dss.currentPath';
const PATH_TRACK_PREV_KEY = 'dss.previousPath';
const HIDDEN_PATH_PREFIXES = ['/login', '/register', '/password-reset'];
const USER_QUICK_ACTIONS: QuickAction[] = [
  { to: '/upload', label: 'アップロード' },
  { to: '/matching', label: '候補を確認' },
  { to: '/notifications', label: '通知を確認' },
];
const ADMIN_QUICK_ACTIONS: QuickAction[] = [
  { to: '/admin/user-requests', label: 'ユーザーリクエスト管理' },
  { to: '/admin/drug-master', label: '医薬品マスター管理' },
  { to: '/admin/log-center', label: 'ログセンター' },
];

function isTrackablePath(pathname: string): boolean {
  return !HIDDEN_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function matchesRoutePattern(pattern: string, pathname: string): boolean {
  const patternSegments = pattern.split('/');
  const pathSegments = pathname.split('/');

  if (patternSegments.length !== pathSegments.length) return false;

  return patternSegments.every((segment, index) => (
    segment.startsWith(':') || segment === pathSegments[index]
  ));
}

function resolveRouteTitle(pathname: string): string {
  const route = ROUTE_META.find((item) => matchesRoutePattern(item.path, pathname));
  return route?.title ?? '';
}

function inferRouteGroupTitle(path: string): string {
  const staticLabels: Record<string, string> = {
    '/inventory': '在庫管理',
    '/admin': '管理者ホーム',
    '/proposals': 'マッチング一覧',
    '/groups': 'グループ',
  };
  if (staticLabels[path]) return staticLabels[path];
  const segment = path.split('/').filter(Boolean).pop() ?? path;
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

function resolveQuickJumpSubtitle(route: RouteMeta): string | undefined {
  if (!route.parent) return undefined;
  const parentRoute = ROUTE_META.find((item) => item.path === route.parent);
  return parentRoute?.title ?? inferRouteGroupTitle(route.parent);
}

function resolveQuickJumpSection(route: RouteMeta): string {
  if (route.adminOnly) {
    if (
      route.path.startsWith('/admin/openclaw')
      || route.path.startsWith('/admin/log')
      || route.path.startsWith('/admin/error-codes')
      || route.path.startsWith('/admin/notifications')
      || route.path.startsWith('/admin/alerts')
      || route.path.startsWith('/admin/upload-jobs')
      || route.path.startsWith('/admin/upload-quality')
      || route.path.startsWith('/admin/risk')
      || route.path.startsWith('/admin/reports')
      || route.path.startsWith('/admin/rate-limits')
    ) {
      return '運用監視';
    }
    if (
      route.path.startsWith('/admin/pharmacies')
      || route.path.startsWith('/admin/groups')
      || route.path.startsWith('/admin/direct-messages')
      || route.path.startsWith('/admin/user-requests')
      || route.path.startsWith('/admin/business-hours')
      || route.path.startsWith('/admin/relationships')
      || route.path.startsWith('/admin/bulk-actions')
      || route.path.startsWith('/admin/exchanges')
    ) {
      return '薬局運用';
    }
    return '基盤と最適化';
  }

  if (route.path.startsWith('/upload') || route.path.startsWith('/inventory')) {
    return '更新と確認';
  }
  if (route.path.startsWith('/matching') || route.path.startsWith('/proposals') || route.path.startsWith('/exchange-history')) {
    return '交換と対応';
  }
  if (route.path.startsWith('/notifications') || route.path.startsWith('/alerts') || route.path.startsWith('/requests') || route.path.startsWith('/messages')) {
    return '通知と連絡';
  }
  if (route.path.startsWith('/groups') || route.path.startsWith('/pharmacies') || route.path.startsWith('/account')) {
    return 'ネットワークと設定';
  }
  return '通常画面';
}

function dedupeQuickActions(actions: readonly QuickAction[]): QuickAction[] {
  const seen = new Set<string>();
  return actions.filter((action) => {
    if (seen.has(action.to)) {
      return false;
    }
    seen.add(action.to);
    return true;
  });
}

function resolveUserQuickActions(pathname: string): QuickAction[] {
  if (pathname.startsWith('/upload') || pathname.startsWith('/inventory')) {
    return [
      { to: '/upload-quality', label: '品質を確認' },
      { to: '/matching', label: '候補を確認' },
      { to: '/statistics', label: '統計を確認' },
    ];
  }

  if (pathname.startsWith('/groups') || pathname.startsWith('/pharmacies')) {
    return [
      { to: '/groups', label: 'グループを確認' },
      { to: '/pharmacies', label: '薬局を確認' },
      { to: '/messages', label: 'メッセージを確認' },
    ];
  }

  if (pathname.startsWith('/messages') || pathname.startsWith('/requests') || pathname.startsWith('/notifications') || pathname.startsWith('/alerts')) {
    return [
      { to: '/notifications', label: '通知を確認' },
      { to: '/messages', label: 'メッセージを確認' },
      { to: '/account', label: '薬局設定を確認' },
      { to: '/alerts', label: 'アラートを確認' },
    ];
  }

  if (pathname.startsWith('/account')) {
    return [
      { to: '/notifications', label: '通知を確認' },
      { to: '/groups', label: 'グループを確認' },
      { to: '/statistics', label: '統計を確認' },
    ];
  }

  return USER_QUICK_ACTIONS;
}

function resolveAdminQuickActions(pathname: string): QuickAction[] {
  if (pathname.startsWith('/admin/bulk-actions')) {
    return [
      { to: '/admin/pharmacies', label: '薬局管理' },
      { to: '/admin/user-requests', label: 'ユーザーリクエスト管理' },
      { to: '/admin/audit', label: '監査ログ' },
      { to: '/admin/bulk-actions', label: '一括操作' },
    ];
  }

  if (
    pathname.startsWith('/admin/pharmacies')
    || pathname.startsWith('/admin/groups')
    || pathname.startsWith('/admin/business-hours')
    || pathname.startsWith('/admin/pharmacy-health')
    || pathname.startsWith('/admin/relationships')
  ) {
    return [
      { to: '/admin/pharmacies', label: '薬局管理' },
      { to: '/admin/pharmacy-health', label: '薬局ヘルス' },
      { to: '/admin/business-hours', label: '営業時間' },
      { to: '/admin/relationships', label: '関係性監査' },
    ];
  }

  if (
    pathname.startsWith('/admin/rate-limits')
    || pathname.startsWith('/admin/openclaw')
  ) {
    return [
      { to: '/admin/log-center', label: 'ログセンター' },
      { to: '/admin/rate-limits', label: 'レート制限設定' },
      { to: '/admin/business-hours', label: '営業時間' },
      { to: '/admin/openclaw', label: 'OpenClaw連携' },
    ];
  }

  if (
    pathname.startsWith('/admin/matching-rules')
    || pathname.startsWith('/admin/matching-experiments')
    || pathname.startsWith('/admin/matching-performance')
  ) {
    return [
      { to: '/admin/matching-rules', label: 'マッチングルール' },
      { to: '/admin/matching-experiments', label: 'マッチング実験' },
      { to: '/admin/matching-performance', label: 'マッチング性能' },
    ];
  }

  if (
    pathname.startsWith('/admin/log-center')
    || pathname.startsWith('/admin/logs')
    || pathname.startsWith('/admin/audit')
    || pathname.startsWith('/admin/error-codes')
  ) {
    return [
      { to: '/admin/log-center', label: 'ログセンター' },
      { to: '/admin/audit', label: '監査ログ' },
      { to: '/admin/error-codes', label: 'エラーコード' },
      { to: '/admin/logs', label: '操作ログ' },
    ];
  }

  if (
    pathname.startsWith('/admin/notifications')
    || pathname.startsWith('/admin/alerts')
    || pathname.startsWith('/admin/direct-messages')
    || pathname.startsWith('/admin/user-requests')
  ) {
    return [
      { to: '/admin/notifications', label: '通知・配信' },
      { to: '/admin/direct-messages', label: 'ユーザー間メッセージ' },
      { to: '/admin/user-requests', label: 'ユーザーリクエスト管理' },
      { to: '/admin/alerts', label: 'アラート管理' },
    ];
  }

  return ADMIN_QUICK_ACTIONS;
}

export default function Header({ onToggleSidebar }: Props) {
  const { user } = useAuth();
  const { events, unreadCount, markViewed } = useTimeline();
  const navigate = useNavigate();
  const location = useLocation();
  const [previousPath, setPreviousPath] = useState('');
  const [updatesPopoverOpen, setUpdatesPopoverOpen] = useState(false);
  const [updatesLoading, setUpdatesLoading] = useState(false);
  const [updatesError, setUpdatesError] = useState('');
  const [updatesData, setUpdatesData] = useState<GitHubUpdatesResponse | null>(null);
  const [updatesHistoryOpen, setUpdatesHistoryOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [quickJumpOpen, setQuickJumpOpen] = useState(false);
  const [quickJumpCases, setQuickJumpCases] = useState<QuickJumpItem[]>([]);
  const [quickJumpCasesLoading, setQuickJumpCasesLoading] = useState(false);
  const recentWork = useRecentWorkList(6);
  const homePath = user?.isAdmin ? '/admin' : '/';
  const currentRouteTitle = useMemo(() => resolveRouteTitle(location.pathname), [location.pathname]);
  const previousRouteTitle = useMemo(() => {
    if (!previousPath) return '';
    return resolveRouteTitle(previousPath);
  }, [previousPath]);

  useEffect(() => {
    const nextPath = `${location.pathname}${location.search}${location.hash}`;
    if (!isTrackablePath(location.pathname)) return;
    const safeNextPath = sanitizeInternalPath(nextPath, '');
    if (!safeNextPath) return;

    const current = window.localStorage.getItem(PATH_TRACK_CURRENT_KEY) ?? '';
    const safeCurrent = sanitizeInternalPath(current, '');
    if (safeCurrent && safeCurrent !== safeNextPath) {
      window.localStorage.setItem(PATH_TRACK_PREV_KEY, safeCurrent);
    }
    window.localStorage.setItem(PATH_TRACK_CURRENT_KEY, safeNextPath);

    const prev = window.localStorage.getItem(PATH_TRACK_PREV_KEY) ?? '';
    const safePrev = sanitizeInternalPath(prev, '');
    setPreviousPath(safePrev && safePrev !== safeNextPath ? safePrev : '');
  }, [location.pathname, location.search, location.hash]);

  const quickActions = useMemo(() => {
    const source = user?.isAdmin
      ? resolveAdminQuickActions(location.pathname)
      : resolveUserQuickActions(location.pathname);
    return dedupeQuickActions(source)
      .filter((item) => !location.pathname.startsWith(item.to))
      .slice(0, 2);
  }, [location.pathname, user?.isAdmin]);

  const quickJumpRoutes = useMemo<QuickJumpItem[]>(() => ROUTE_META
    .filter((route) => route.access === 'protected')
    .filter((route) => route.useLayout !== false)
    .filter((route) => typeof route.title === 'string' && route.title.length > 0)
    .filter((route) => !route.path.includes(':'))
    .filter((route) => {
      if (route.adminOnly) return Boolean(user?.isAdmin);
      if (route.userOnly) return !user?.isAdmin;
      return true;
    })
    .map((route) => ({
      id: `route-${route.path}`,
      label: route.title ?? route.path,
      to: route.path,
      section: resolveQuickJumpSection(route),
      subtitle: resolveQuickJumpSubtitle(route),
    }))
    .filter((route) => route.to !== location.pathname)
    .slice(0, 24), [location.pathname, user?.isAdmin]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setQuickJumpOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const loadGitHubUpdates = async () => {
    setUpdatesLoading(true);
    setUpdatesError('');
    try {
      const result = await api.get<GitHubUpdatesResponse>('/updates/github');
      setUpdatesData(result);
    } catch (err) {
      setUpdatesError(err instanceof Error ? err.message : 'アップデートの取得に失敗しました');
    } finally {
      setUpdatesLoading(false);
    }
  };

  const loadQuickJumpCases = useCallback(async () => {
    setQuickJumpCasesLoading(true);
    try {
      if (user?.isAdmin) {
        const [requests, openclawRequests] = await Promise.all([
          api.get<{ data: HeaderQuickJumpAdminRequest[] }>('/admin/user-requests?page=1&limit=10'),
          api.get<{ data: HeaderQuickJumpOpenClawRequest[] }>('/admin/requests?page=1&limit=10'),
        ]);
        setQuickJumpCases([
          ...requests.data.map((item) => ({
            id: `admin-request-${item.id}`,
            label: `要望 #${item.id}`,
            to: `/admin/user-requests?requestId=${item.id}`,
            section: 'ユーザーリクエスト',
            subtitle: item.pharmacyName ?? item.requestText,
          })),
          ...openclawRequests.data.map((item) => ({
            id: `openclaw-request-${item.id}`,
            label: `OpenClaw #${item.id}`,
            to: `/admin/openclaw?requestId=${item.id}`,
            section: 'OpenClaw',
            subtitle: item.pharmacyName || item.requestText,
          })),
        ]);
        return;
      }

      const [proposals, notices] = await Promise.all([
        api.get<{ data: HeaderQuickJumpProposal[] }>('/exchange/proposals?page=1&sort=priority'),
        api.get<{ notices: Array<{ id: string; title: string; actionPath: string; type: string }> }>('/notifications?limit=10'),
      ]);
      setQuickJumpCases([
        ...proposals.data.map((proposal) => ({
          id: `proposal-${proposal.id}`,
          label: `提案 #${proposal.id}`,
          to: `/proposals/${proposal.id}`,
          section: '提案',
          subtitle: `${proposal.pharmacyAName} ↔ ${proposal.pharmacyBName} / ${proposal.status}`,
        })),
        ...notices.notices.map((notice) => ({
          id: `notice-${notice.id}`,
          label: notice.title,
          to: sanitizeInternalPath(notice.actionPath, '/notifications'),
          section: '通知',
          subtitle: notice.type,
        })),
      ]);
    } catch {
      setQuickJumpCases([]);
    } finally {
      setQuickJumpCasesLoading(false);
    }
  }, [user?.isAdmin]);

  useEffect(() => {
    if (!quickJumpOpen) return;
    void loadQuickJumpCases();
  }, [loadQuickJumpCases, quickJumpOpen]);

  const handleUpdatesPopoverToggle = (nextOpen: boolean) => {
    setUpdatesPopoverOpen(nextOpen);
    if (!nextOpen) {
      setUpdatesHistoryOpen(false);
      return;
    }
    // 排他制御: 通知ドロップダウンを閉じる
    setNotificationOpen(false);
    if (!updatesLoading) {
      void loadGitHubUpdates();
    }
  };

  const handleNotificationToggle = (nextOpen: boolean) => {
    setNotificationOpen(nextOpen);
    if (nextOpen) {
      // 排他制御: アップデートポップオーバーを閉じる
      setUpdatesPopoverOpen(false);
      setUpdatesHistoryOpen(false);
    }
  };

  return (
    <header className="app-header">
      <div className="app-header-main">
        <AppButton
          variant="link"
          className="sidebar-toggle d-lg-none text-white p-0 me-3"
          onClick={onToggleSidebar}
          aria-label="メニューを開く"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </AppButton>
        <div className="app-header-brand-group">
          <div className="app-header-brand-meta">
            <Link to={homePath} className="app-header-brand">
              <span>DeadStockSolution</span>
              <span className="app-header-version">{APP_VERSION}</span>
            </Link>
            {currentRouteTitle && user && (
              <span className="app-header-context-chip" aria-label={`現在の画面: ${currentRouteTitle}`}>
                {currentRouteTitle}
              </span>
            )}
            <AppUpdatesPopover
              updatesLoading={updatesLoading}
              updatesError={updatesError}
              updatesData={updatesData}
              popoverOpen={updatesPopoverOpen}
              historyOpen={updatesHistoryOpen}
              onToggle={handleUpdatesPopoverToggle}
              onHistoryToggle={() => setUpdatesHistoryOpen((prev) => !prev)}
              onRetry={() => { void loadGitHubUpdates(); }}
            />
          </div>
          {!user?.isAdmin && (
            <AppButton
              type="button"
              variant="outline-light"
              size="sm"
              className="app-header-request-btn"
              onClick={() => navigate('/requests')}
            >
              要望をあげる
            </AppButton>
          )}
        </div>

        <div className="app-header-quick ms-auto d-none d-lg-flex">
          {previousPath && (
            <Link to={previousPath} className="app-header-quick-link app-header-quick-link-muted">
              {previousRouteTitle ? `戻る: ${previousRouteTitle}` : '前回の画面へ戻る'}
            </Link>
          )}
          <AppButton
            type="button"
            variant="outline-light"
            size="sm"
            onClick={() => setQuickJumpOpen(true)}
          >
            クイックジャンプ
          </AppButton>
          {!user?.isAdmin && (
            <NotificationDropdown
              events={events}
              unreadCount={unreadCount}
              show={notificationOpen}
              onToggle={handleNotificationToggle}
              onMarkViewed={() => { void markViewed(); }}
            />
          )}
          {quickActions.map((action) => (
            <Link key={action.to} to={action.to} className="app-header-quick-link">
              {action.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="app-header-quick-mobile d-lg-none" aria-label="ヘッダークイック導線">
        {previousPath && (
          <Link to={previousPath} className="app-header-quick-link app-header-quick-link-muted">
            {previousRouteTitle ? `戻る: ${previousRouteTitle}` : '前回の画面へ戻る'}
          </Link>
        )}
        <button
          type="button"
          className="app-header-quick-link"
          onClick={() => setQuickJumpOpen(true)}
        >
          クイックジャンプ
        </button>
        {quickActions.map((action) => (
          <Link key={`mobile-${action.to}`} to={action.to} className="app-header-quick-link">
            {action.label}
          </Link>
        ))}
      </div>
      <QuickJumpPalette
        show={quickJumpOpen}
        onHide={() => setQuickJumpOpen(false)}
        routes={quickJumpRoutes}
        recentWork={recentWork}
        cases={quickJumpCases}
        loadingCases={quickJumpCasesLoading}
      />
    </header>
  );
}
