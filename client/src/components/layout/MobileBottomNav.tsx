import { Badge, Nav } from 'react-bootstrap';
import { NavLink, useLocation } from 'react-router-dom';
import { useTimeline } from '../../contexts/TimelineContext';
import { useAuth } from '../../contexts/AuthContext';

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  /** 完全一致 (end) でアクティブ判定 */
  end?: boolean;
  /** 近接ルートでも同じタブをアクティブ扱いする */
  activeAliases?: string[];
  /** バッジ数を返すキー */
  badgeKey?: 'proposals' | 'alerts';
}

function NavIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

function DashboardIcon() {
  return <NavIcon><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></NavIcon>;
}

function MatchingIcon() {
  return <NavIcon><circle cx="8" cy="8" r="5" /><path d="M13.5 13.5L21 21" /><circle cx="16" cy="16" r="5" /></NavIcon>;
}

function ProposalIcon() {
  return <NavIcon><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></NavIcon>;
}

function AlertIcon() {
  return <NavIcon><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></NavIcon>;
}

function GroupIcon() {
  return <NavIcon><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></NavIcon>;
}

function MessageIcon() {
  return <NavIcon><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></NavIcon>;
}

function RequestIcon() {
  return <NavIcon><path d="M4 4h16v12H7l-3 3z" /><path d="M8 8h8" /><path d="M8 12h5" /></NavIcon>;
}

function AdminIcon() {
  return <NavIcon><path d="M12 3l8 4v5c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7z" /><path d="M9.5 12.5l1.5 1.5 3.5-4" /></NavIcon>;
}

export const USER_NAV_ITEMS: NavItem[] = [
  {
    to: '/',
    label: 'ホーム',
    icon: <DashboardIcon />,
    end: true,
    activeAliases: [
      '/upload',
      '/upload-quality',
      '/inventory',
      '/groups',
      '/pharmacies',
      '/statistics',
      '/account',
    ],
  },
  { to: '/matching', label: 'マッチング', icon: <MatchingIcon />, activeAliases: ['/bookmarks'] },
  { to: '/proposals', label: '提案', icon: <ProposalIcon />, badgeKey: 'proposals', activeAliases: ['/exchange-history'] },
  { to: '/messages', label: 'メッセージ', icon: <MessageIcon />, activeAliases: ['/requests'] },
  { to: '/alerts', label: 'アラート', icon: <AlertIcon />, badgeKey: 'alerts', activeAliases: ['/notifications'] },
];

export const ADMIN_NAV_ITEMS: NavItem[] = [
  {
    to: '/admin',
    label: 'ホーム',
    icon: <AdminIcon />,
    end: true,
    activeAliases: [
      '/admin/risk',
      '/admin/reports',
      '/admin/exchanges',
      '/admin/upload-jobs',
      '/admin/pharmacies',
      '/admin/groups',
      '/admin/alerts',
      '/admin/notifications',
      '/admin/matching-rules',
      '/admin/matching-performance',
      '/admin/matching-experiments',
      '/admin/upload-quality',
      '/admin/audit',
      '/admin/business-hours',
      '/admin/bulk-actions',
      '/admin/relationships',
      '/admin/log-center',
      '/admin/logs',
      '/admin/error-codes',
      '/admin/rate-limits',
      '/admin/pharmacy-health',
    ],
  },
  { to: '/admin/user-requests', label: '要望', icon: <RequestIcon /> },
  { to: '/admin/direct-messages', label: 'メッセージ', icon: <MessageIcon /> },
  { to: '/admin/drug-master', label: 'マスター', icon: <ProposalIcon />, activeAliases: ['/admin/drug-equivalences'] },
  { to: '/admin/openclaw', label: 'OpenClaw', icon: <GroupIcon />, activeAliases: ['/admin/openclaw-commands'] },
];

// 互換用。ページスワイプや既存テストは利用者向けナビを基準に扱う。
export const NAV_ITEMS: NavItem[] = USER_NAV_ITEMS;

/**
 * モバイル専用ボトムナビゲーション
 * - `d-lg-none`: lg以上では非表示
 * - safe-area-inset-bottom 対応
 * - アクティブルートのハイライト
 * - 未読バッジ表示
 */
export default function MobileBottomNav() {
  const location = useLocation();
  const { unreadCount } = useTimeline();
  const { user } = useAuth();
  const navItems = user?.isAdmin ? ADMIN_NAV_ITEMS : USER_NAV_ITEMS;

  // バッジカウント（TimelineContextのunreadCountを共有）
  const getBadgeCount = (key?: 'proposals' | 'alerts'): number => {
    if (!key) return 0;
    // 未読数をアラートバッジとして使用
    if (key === 'alerts') return unreadCount;
    return 0;
  };

  const isActive = (item: NavItem): boolean => {
    if (item.end && location.pathname === item.to) return true;
    if (item.activeAliases?.some((alias) => location.pathname.startsWith(alias))) return true;
    if (item.end) return false;
    if (item.to === '/') return location.pathname === '/';
    return location.pathname.startsWith(item.to);
  };

  return (
    <nav
      className="mobile-bottom-nav d-lg-none"
      role="navigation"
      aria-label="モバイルナビゲーション"
    >
      <Nav className="mobile-bottom-nav-inner justify-content-around">
        {navItems.map((item) => {
          const active = isActive(item);
          const badgeCount = getBadgeCount(item.badgeKey);
          return (
            <Nav.Item key={item.to} className="mobile-bottom-nav-item">
              <NavLink
                to={item.to}
                end={item.end}
                className={`mobile-bottom-nav-link${active ? ' active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                <span className="mobile-bottom-nav-icon" aria-hidden="true">
                  {item.icon}
                  {badgeCount > 0 && (
                    <Badge
                      bg="danger"
                      pill
                      className="mobile-bottom-nav-badge"
                      aria-label={`${badgeCount}件の未読`}
                    >
                      {badgeCount > 99 ? '99+' : badgeCount}
                    </Badge>
                  )}
                </span>
                <span className="mobile-bottom-nav-label">{item.label}</span>
              </NavLink>
            </Nav.Item>
          );
        })}
      </Nav>
    </nav>
  );
}
