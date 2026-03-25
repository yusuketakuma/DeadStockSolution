import { useEffect, useMemo, useState } from 'react';
import AppButton from './ui/AppButton';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { useTimeline } from '../contexts/TimelineContext';
import AppUpdatesPopover from './header/AppUpdatesPopover';
import NotificationDropdown from './header/NotificationDropdown';
import { sanitizeInternalPath } from '../utils/navigation';
import { APP_VERSION } from '../constants/appVersion';

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

const PATH_TRACK_CURRENT_KEY = 'dss.currentPath';
const PATH_TRACK_PREV_KEY = 'dss.previousPath';
const HIDDEN_PATH_PREFIXES = ['/login', '/register', '/password-reset'];
const USER_QUICK_ACTIONS: QuickAction[] = [
  { to: '/upload', label: 'アップロード' },
  { to: '/matching', label: 'マッチング' },
  { to: '/requests', label: '要望対応' },
];
const ADMIN_QUICK_ACTIONS: QuickAction[] = [
  { to: '/admin/user-requests', label: 'ユーザーリクエスト管理' },
  { to: '/admin/drug-master', label: '医薬品マスター管理' },
  { to: '/admin/log-center', label: 'ログセンター' },
];

function isTrackablePath(pathname: string): boolean {
  return !HIDDEN_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
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
    const source = user?.isAdmin ? ADMIN_QUICK_ACTIONS : USER_QUICK_ACTIONS;
    return source.filter((item) => !location.pathname.startsWith(item.to)).slice(0, 2);
  }, [location.pathname, user?.isAdmin]);

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
            <Link to="/" className="app-header-brand">
              <span>DeadStockSolution</span>
              <span className="app-header-version">{APP_VERSION}</span>
            </Link>
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
              前回の画面へ戻る
            </Link>
          )}
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
        {!user?.isAdmin && (
          <NotificationDropdown
            events={events}
            unreadCount={unreadCount}
            show={notificationOpen}
            onToggle={handleNotificationToggle}
            onMarkViewed={() => { void markViewed(); }}
          />
        )}
        {previousPath && (
          <Link to={previousPath} className="app-header-quick-link app-header-quick-link-muted">
            前回の画面へ戻る
          </Link>
        )}
        {quickActions.map((action) => (
          <Link key={`mobile-${action.to}`} to={action.to} className="app-header-quick-link">
            {action.label}
          </Link>
        ))}
      </div>

    </header>
  );
}
