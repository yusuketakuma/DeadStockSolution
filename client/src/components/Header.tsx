import { useEffect, useMemo, useState } from 'react';
import { Button } from 'react-bootstrap';
import { Link, useLocation } from 'react-router-dom';
import { APP_VERSION } from '../constants/appVersion';
import { useAuth } from '../contexts/AuthContext';

interface Props {
  onToggleSidebar: () => void;
}

interface QuickAction {
  to: string;
  label: string;
}

const PATH_TRACK_CURRENT_KEY = 'dss.currentPath';
const PATH_TRACK_PREV_KEY = 'dss.previousPath';
const HIDDEN_PATH_PREFIXES = ['/login', '/register', '/password-reset'];
const USER_QUICK_ACTIONS: QuickAction[] = [
  { to: '/upload', label: 'アップロード' },
  { to: '/matching', label: 'マッチング' },
  { to: '/proposals', label: '提案確認' },
];
const ADMIN_QUICK_ACTIONS: QuickAction[] = [
  { to: '/admin/openclaw', label: '要望対応' },
  { to: '/admin/drug-master', label: 'マスター管理' },
  { to: '/admin/logs', label: '操作ログ' },
];

function isTrackablePath(pathname: string): boolean {
  return !HIDDEN_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export default function Header({ onToggleSidebar }: Props) {
  const { user } = useAuth();
  const location = useLocation();
  const [previousPath, setPreviousPath] = useState('');

  useEffect(() => {
    const nextPath = `${location.pathname}${location.search}${location.hash}`;
    if (!isTrackablePath(location.pathname)) return;

    const current = window.localStorage.getItem(PATH_TRACK_CURRENT_KEY) ?? '';
    if (current && current !== nextPath) {
      window.localStorage.setItem(PATH_TRACK_PREV_KEY, current);
    }
    window.localStorage.setItem(PATH_TRACK_CURRENT_KEY, nextPath);

    const prev = window.localStorage.getItem(PATH_TRACK_PREV_KEY) ?? '';
    setPreviousPath(prev && prev !== nextPath ? prev : '');
  }, [location.pathname, location.search, location.hash]);

  const quickActions = useMemo(() => {
    const source = user?.isAdmin ? ADMIN_QUICK_ACTIONS : USER_QUICK_ACTIONS;
    return source.filter((item) => !location.pathname.startsWith(item.to)).slice(0, 2);
  }, [location.pathname, user?.isAdmin]);

  return (
    <header className="app-header">
      <div className="app-header-main">
        <Button
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
        </Button>
        <Link to="/" className="app-header-brand">
          <span>DeadStockSolution</span>
          <span className="app-header-version">{APP_VERSION}</span>
        </Link>

        <div className="app-header-quick ms-auto d-none d-lg-flex">
          {previousPath && (
            <Link to={previousPath} className="app-header-quick-link app-header-quick-link-muted">
              前回の画面へ戻る
            </Link>
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
