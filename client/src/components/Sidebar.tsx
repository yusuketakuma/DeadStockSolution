import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Nav, Offcanvas } from 'react-bootstrap';
import AppButton from './ui/AppButton';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

type UserBadgeKey = keyof UserBadgeCounts;

interface UserSubGroup {
  key: string;
  subtitle: string;
  icon: ReactNode;
  items: { to: string; label: string; end?: boolean; userBadgeKey?: UserBadgeKey }[];
}

const USER_SUBGROUPS: UserSubGroup[] = [
  {
    key: 'home',
    subtitle: 'ホーム',
    icon: <i className="bi bi-bar-chart" />,
    items: [
      { to: '/', label: 'ダッシュボード', end: true },
      { to: '/statistics', label: '統計' },
    ],
  },
  {
    key: 'inventory-upload',
    subtitle: '在庫管理',
    icon: <i className="bi bi-box-seam" />,
    items: [
      { to: '/upload', label: 'アップロード' },
      { to: '/inventory/dead-stock', label: 'デッドストック' },
      { to: '/inventory/used-medication', label: '医薬品使用量' },
      { to: '/inventory/browse', label: '在庫参照' },
    ],
  },
  {
    key: 'matching',
    subtitle: 'マッチング・交換',
    icon: <i className="bi bi-link-45deg" />,
    items: [
      { to: '/matching', label: 'マッチング' },
      { to: '/proposals', label: 'マッチング一覧', userBadgeKey: 'pendingProposals' },
      { to: '/exchange-history', label: '交換履歴' },
    ],
  },
  {
    key: 'community',
    subtitle: 'コミュニティ',
    icon: <i className="bi bi-people" />,
    items: [
      { to: '/pharmacies', label: '薬局一覧' },
      { to: '/groups', label: 'グループ' },
      { to: '/alerts', label: 'アラート', userBadgeKey: 'unresolvedAlerts' },
    ],
  },
];

interface AdminSubGroup {
  key: string;
  subtitle: string;
  icon: ReactNode;
  items: { to: string; label: string; end?: boolean; badgeKey?: keyof AdminBadgeCounts }[];
}

const ADMIN_SUBGROUPS: AdminSubGroup[] = [
  {
    key: 'overview',
    subtitle: '概要',
    icon: <i className="bi bi-gear" />,
    items: [
      { to: '/admin', label: 'ダッシュボード', end: true },
    ],
  },
  {
    key: 'pharmacy-ops',
    subtitle: '薬局運用',
    icon: <i className="bi bi-hospital" />,
    items: [
      { to: '/admin/pharmacies', label: '薬局管理' },
      { to: '/admin/groups', label: 'グループ管理' },
      { to: '/admin/relationships', label: '関係性監査' },
      { to: '/admin/business-hours', label: '営業時間' },
      { to: '/admin/bulk-actions', label: '一括操作' },
    ],
  },
  {
    key: 'requests-notifications',
    subtitle: 'リクエスト・通知',
    icon: <i className="bi bi-envelope-arrow-down" />,
    items: [
      { to: '/admin/user-requests', label: 'ユーザーリクエスト', badgeKey: 'pendingRequests' },
      { to: '/admin/alerts', label: 'アラート管理', badgeKey: 'unresolvedAlerts' },
      { to: '/admin/notifications', label: '通知・配信状況', badgeKey: 'unreadNotifications' },
    ],
  },
  {
    key: 'matching-exchange',
    subtitle: 'マッチング・交換',
    icon: <i className="bi bi-arrow-repeat" />,
    items: [
      { to: '/admin/exchanges', label: '交換履歴' },
      { to: '/admin/matching-rules', label: 'マッチングルール' },
      { to: '/admin/matching-performance', label: 'マッチング性能' },
    ],
  },
  {
    key: 'inventory-upload',
    subtitle: '在庫・取込',
    icon: <i className="bi bi-inbox-arrow-down" />,
    items: [
      { to: '/admin/upload-jobs', label: '取込ジョブ管理', badgeKey: 'failedJobs' },
      { to: '/admin/upload-quality', label: 'アップロード品質' },
      { to: '/admin/risk', label: '期限リスク分析' },
    ],
  },
  {
    key: 'drug-master',
    subtitle: '医薬品マスター',
    icon: <i className="bi bi-capsule" />,
    items: [
      { to: '/admin/drug-master', label: '医薬品マスター' },
      { to: '/admin/drug-equivalences', label: '薬品同等性' },
    ],
  },
  {
    key: 'analytics',
    subtitle: '分析・監視',
    icon: <i className="bi bi-bar-chart" />,
    items: [
      { to: '/admin/reports', label: '月次レポート' },
      { to: '/admin/pharmacy-health', label: '薬局ヘルス' },
      { to: '/admin/audit', label: '監査ログ' },
      { to: '/admin/log-center', label: 'ログセンター' },
    ],
  },
  {
    key: 'openclaw',
    subtitle: 'OpenClaw',
    icon: <i className="bi bi-plug" />,
    items: [
      { to: '/admin/openclaw', label: 'OpenClaw連携' },
      { to: '/admin/openclaw-commands', label: 'コマンド管理' },
    ],
  },
];

const ICON_MAP: Record<string, ReactNode> = {
  '/': <i className="bi bi-bar-chart" />,
  '/upload': <i className="bi bi-upload" />,
  '/matching': <i className="bi bi-link-45deg" />,
  '/proposals': <i className="bi bi-clipboard" />,
  '/exchange-history': <i className="bi bi-arrow-repeat" />,
  '/statistics': <i className="bi bi-graph-up" />,
  '/groups': <i className="bi bi-people" />,
  '/alerts': <i className="bi bi-bell" />,
  '/inventory/dead-stock': <i className="bi bi-box-seam" />,
  '/inventory/used-medication': <i className="bi bi-capsule" />,
  '/inventory/browse': <i className="bi bi-search" />,
  '/pharmacies': <i className="bi bi-hospital" />,
  '/admin': <i className="bi bi-gear" />,
  '/admin/pharmacies': <i className="bi bi-hospital" />,
  '/admin/groups': <i className="bi bi-people" />,
  '/admin/user-requests': <i className="bi bi-envelope-arrow-down" />,
  '/admin/alerts': <i className="bi bi-bell" />,
  '/admin/exchanges': <i className="bi bi-arrow-repeat" />,
  '/admin/upload-jobs': <i className="bi bi-inbox-arrow-down" />,
  '/admin/risk': <i className="bi bi-exclamation-triangle" />,
  '/admin/reports': <i className="bi bi-bar-chart" />,
  '/admin/notifications': <i className="bi bi-broadcast" />,
  '/admin/drug-master': <i className="bi bi-capsule" />,
  '/admin/drug-equivalences': <i className="bi bi-shuffle" />,
  '/admin/matching-rules': <i className="bi bi-rulers" />,
  '/admin/openclaw': <i className="bi bi-plug" />,
  '/admin/openclaw-commands': <i className="bi bi-robot" />,
  '/admin/pharmacy-health': <i className="bi bi-hospital" />,
  '/admin/matching-performance': <i className="bi bi-graph-up" />,
  '/admin/upload-quality': <i className="bi bi-clipboard" />,
  '/admin/audit': <i className="bi bi-search" />,
  '/admin/business-hours': <i className="bi bi-clock" />,
  '/admin/bulk-actions': <i className="bi bi-box-seam" />,
  '/admin/relationships': <i className="bi bi-link-45deg" />,
  '/admin/log-center': <i className="bi bi-journal-text" />,
  '/account': <i className="bi bi-person" />,
};

// ── Badge polling interval ───────────────────────────────
const BADGE_POLL_INTERVAL_MS = 15_000;

// ── User badge counts ────────────────────────────────────
interface UserBadgeCounts {
  pendingProposals: number;
  unresolvedAlerts: number;
}

const EMPTY_USER_BADGES: UserBadgeCounts = {
  pendingProposals: 0,
  unresolvedAlerts: 0,
};

function useUserBadgeCounts(isLoggedIn: boolean): UserBadgeCounts {
  const [counts, setCounts] = useState<UserBadgeCounts>(EMPTY_USER_BADGES);

  const fetchCounts = useCallback(async () => {
    if (!isLoggedIn) return;
    try {
      const [proposalRes, alertRes] = await Promise.allSettled([
        api.get<{ pendingCount: number }>('/exchange/proposals/pending-count'),
        api.get<{ unresolvedCount: number; byType: unknown }>('/alerts/stats'),
      ]);
      const next: UserBadgeCounts = {
        pendingProposals: proposalRes.status === 'fulfilled' ? proposalRes.value.pendingCount : 0,
        unresolvedAlerts: alertRes.status === 'fulfilled' ? alertRes.value.unresolvedCount : 0,
      };
      setCounts((prev) =>
        prev.pendingProposals === next.pendingProposals && prev.unresolvedAlerts === next.unresolvedAlerts
          ? prev
          : next,
      );
    } catch {
      // silent
    }
  }, [isLoggedIn]);

  useEffect(() => {
    void fetchCounts();
    if (!isLoggedIn) return;
    const interval = setInterval(() => void fetchCounts(), BADGE_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchCounts, isLoggedIn]);

  return counts;
}

// ── Admin badge counts ──────────────────────────────────
interface AdminBadgeCounts {
  pendingRequests: number;
  unresolvedAlerts: number;
  unreadNotifications: number;
  failedJobs: number;
}

const EMPTY_BADGES: AdminBadgeCounts = {
  pendingRequests: 0,
  unresolvedAlerts: 0,
  unreadNotifications: 0,
  failedJobs: 0,
};

function useAdminBadgeCounts(isAdmin: boolean): AdminBadgeCounts {
  const [counts, setCounts] = useState<AdminBadgeCounts>(EMPTY_BADGES);

  const fetchCounts = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const data = await api.get<{
        failedUploadJobs24h: number;
        stalledUploadJobs24h: number;
        unreadNotifications: number;
        pendingProposalActions24h: number;
      }>('/admin/alerts');
      setCounts({
        pendingRequests: 0,
        unresolvedAlerts: 0,
        unreadNotifications: data.unreadNotifications,
        failedJobs: data.failedUploadJobs24h,
      });
    } catch {
      // silent
    }
  }, [isAdmin]);

  useEffect(() => {
    void fetchCounts();
    if (!isAdmin) return;
    const interval = setInterval(() => void fetchCounts(), BADGE_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchCounts, isAdmin]);

  return counts;
}

// ── Collapsible subgroup state (shared) ──────────────────

function useSubgroupState(
  storageKey: string,
  subgroups: readonly { key: string; items: readonly { to: string; end?: boolean }[] }[],
) {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem(storageKey);
    return saved ? JSON.parse(saved) as Record<string, boolean> : {};
  });

  // Auto-expand group containing the current route
  useEffect(() => {
    const currentPath = location.pathname;
    for (const sub of subgroups) {
      const hasActive = sub.items.some((item) =>
        item.end ? currentPath === item.to : currentPath.startsWith(item.to),
      );
      if (hasActive && collapsed[sub.key]) {
        setCollapsed((prev) => {
          const next = { ...prev };
          delete next[sub.key];
          localStorage.setItem(storageKey, JSON.stringify(next));
          return next;
        });
        break;
      }
    }
  }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (!next[key]) delete next[key];
      localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  }, [storageKey]);

  return { collapsed, toggle };
}

// ── Components ──────────────────────────────────────────

function SidebarBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="sidebar-badge">{count > 99 ? '99+' : count}</span>
  );
}

function SidebarLink({
  to,
  label,
  onNavigate,
  end = false,
  collapsed = false,
  badge = 0,
}: {
  to: string;
  label: string;
  onNavigate?: () => void;
  end?: boolean;
  collapsed?: boolean;
  badge?: number;
}) {
  const icon = ICON_MAP[to] ?? <i className="bi bi-file-text" />;
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }: { isActive: boolean }) => `sidebar-link nav-link${isActive ? ' active' : ''}`}
      onClick={() => onNavigate?.()}
      title={collapsed ? label : undefined}
    >
      <span className="sidebar-link-icon" aria-hidden="true">{icon}</span>
      {!collapsed && <span className="sidebar-link-label">{label}</span>}
      {!collapsed && <SidebarBadge count={badge} />}
    </NavLink>
  );
}

function SubgroupHeader({
  subtitle,
  icon,
  isCollapsed,
  onToggle,
  badgeTotal,
}: {
  subtitle: string;
  icon: ReactNode;
  isCollapsed: boolean;
  onToggle: () => void;
  badgeTotal: number;
}) {
  return (
    <button
      type="button"
      className="sidebar-subgroup-header"
      onClick={onToggle}
      aria-expanded={!isCollapsed}
    >
      <span className="sidebar-subgroup-icon">{icon}</span>
      <span className="sidebar-subgroup-label">{subtitle}</span>
      {badgeTotal > 0 && isCollapsed && (
        <span className="sidebar-badge sidebar-badge--subgroup">{badgeTotal > 99 ? '99+' : badgeTotal}</span>
      )}
      <svg
        className={`sidebar-subgroup-chevron${isCollapsed ? ' sidebar-subgroup-chevron--collapsed' : ''}`}
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="3 4.5 6 7.5 9 4.5" />
      </svg>
    </button>
  );
}

function SidebarContent({ onNavigate, collapsed = false, onToggleCollapse }: {
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const badgeCounts = useAdminBadgeCounts(!!user?.isAdmin);
  const subgroupState = useSubgroupState('admin-sidebar-collapsed', ADMIN_SUBGROUPS);
  const userBadgeCounts = useUserBadgeCounts(!!user);
  const userSubgroupState = useSubgroupState('user-sidebar-collapsed', USER_SUBGROUPS);

  const handleLogout = async () => {
    onNavigate?.();
    await logout();
    navigate('/login');
  };

  return (
    <div className="sidebar-content d-flex flex-column h-100">
      <Nav className="flex-column flex-grow-1 pt-2">
        {user?.isAdmin && (
          <div className="sidebar-group">
            {!collapsed && <h2 className="sidebar-group-title">管理者</h2>}
            {ADMIN_SUBGROUPS.map((sub) => {
              const isSubCollapsed = !!subgroupState.collapsed[sub.key];
              const badgeTotal = sub.items.reduce(
                (sum, item) => sum + (item.badgeKey ? (badgeCounts[item.badgeKey] ?? 0) : 0),
                0,
              );

              if (collapsed) {
                // collapsed sidebar: show only icons, no subgroups
                return sub.items.map((item) => (
                  <SidebarLink
                    key={item.to}
                    to={item.to}
                    label={item.label}
                    onNavigate={onNavigate}
                    end={item.end}
                    collapsed
                    badge={item.badgeKey ? (badgeCounts[item.badgeKey] ?? 0) : 0}
                  />
                ));
              }

              return (
                <div key={sub.key} className="sidebar-subgroup">
                  <SubgroupHeader
                    subtitle={sub.subtitle}
                    icon={sub.icon}
                    isCollapsed={isSubCollapsed}
                    onToggle={() => subgroupState.toggle(sub.key)}
                    badgeTotal={badgeTotal}
                  />
                  {!isSubCollapsed && sub.items.map((item) => (
                    <SidebarLink
                      key={item.to}
                      to={item.to}
                      label={item.label}
                      onNavigate={onNavigate}
                      end={item.end}
                      badge={item.badgeKey ? (badgeCounts[item.badgeKey] ?? 0) : 0}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}
        {!user?.isAdmin && <div className="sidebar-group">
          {!collapsed && <h2 className="sidebar-group-title">メニュー</h2>}
          {USER_SUBGROUPS.map((sub) => {
            const isSubCollapsed = !!userSubgroupState.collapsed[sub.key];
            const badgeTotal = sub.items.reduce(
              (sum, item) => sum + (item.userBadgeKey ? (userBadgeCounts[item.userBadgeKey] ?? 0) : 0),
              0,
            );

            if (collapsed) {
              return sub.items.map((item) => (
                <SidebarLink
                  key={item.to}
                  to={item.to}
                  label={item.label}
                  onNavigate={onNavigate}
                  end={item.end}
                  collapsed
                  badge={item.userBadgeKey ? (userBadgeCounts[item.userBadgeKey] ?? 0) : 0}
                />
              ));
            }

            return (
              <div key={sub.key} className="sidebar-subgroup">
                <SubgroupHeader
                  subtitle={sub.subtitle}
                  icon={sub.icon}
                  isCollapsed={isSubCollapsed}
                  onToggle={() => userSubgroupState.toggle(sub.key)}
                  badgeTotal={badgeTotal}
                />
                {!isSubCollapsed && sub.items.map((item) => (
                  <SidebarLink
                    key={item.to}
                    to={item.to}
                    label={item.label}
                    onNavigate={onNavigate}
                    end={item.end}
                    badge={item.userBadgeKey ? (userBadgeCounts[item.userBadgeKey] ?? 0) : 0}
                  />
                ))}
              </div>
            );
          })}
        </div>
        }
      </Nav>

      <div className="sidebar-footer border-top p-3">
        <SidebarLink to="/account" label={user?.name ?? 'アカウント'} onNavigate={onNavigate} collapsed={collapsed} />
        {!collapsed && (
          <AppButton variant="outline-secondary" size="sm" className="w-100 mt-2" onClick={handleLogout}>
            ログアウト
          </AppButton>
        )}
        {onToggleCollapse && (
          <button
            type="button"
            className="sidebar-collapse-toggle"
            onClick={onToggleCollapse}
            aria-label={collapsed ? 'サイドバーを展開' : 'サイドバーを折りたたむ'}
            title={collapsed ? 'サイドバーを展開' : 'サイドバーを折りたたむ'}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              {collapsed
                ? <polyline points="6 3 11 8 6 13" />
                : <polyline points="10 3 5 8 10 13" />
              }
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

export default function Sidebar({ isOpen, onClose, collapsed = false, onToggleCollapse }: Props) {
  return (
    <>
      <aside className={`sidebar-desktop d-none d-lg-flex${collapsed ? ' sidebar-desktop--collapsed' : ''}`} role="navigation" aria-label="メインナビゲーション">
        <SidebarContent collapsed={collapsed} onToggleCollapse={onToggleCollapse} />
      </aside>

      <Offcanvas show={isOpen} onHide={onClose} className="sidebar-mobile d-lg-none" placement="start" aria-label="モバイルナビゲーション">
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>メニュー</Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body className="p-0">
          <SidebarContent onNavigate={onClose} />
        </Offcanvas.Body>
      </Offcanvas>
    </>
  );
}
