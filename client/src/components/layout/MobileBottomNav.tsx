import { Badge, Nav } from 'react-bootstrap';
import { NavLink, useLocation } from 'react-router-dom';
import { useTimeline } from '../../contexts/TimelineContext';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  /** 完全一致 (end) でアクティブ判定 */
  end?: boolean;
  /** バッジ数を返すキー */
  badgeKey?: 'proposals' | 'alerts';
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'ダッシュボード', icon: '📊', end: true },
  { to: '/matching', label: 'マッチング', icon: '🔗' },
  { to: '/proposals', label: '提案', icon: '📋', badgeKey: 'proposals' },
  { to: '/alerts', label: 'アラート', icon: '🔔', badgeKey: 'alerts' },
];

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

  // バッジカウント（TimelineContextのunreadCountを共有）
  const getBadgeCount = (key?: 'proposals' | 'alerts'): number => {
    if (!key) return 0;
    // 未読数をアラートバッジとして使用
    if (key === 'alerts') return unreadCount;
    return 0;
  };

  const isActive = (to: string, end?: boolean): boolean => {
    if (end) return location.pathname === to;
    return location.pathname.startsWith(to);
  };

  return (
    <nav
      className="mobile-bottom-nav d-lg-none"
      role="navigation"
      aria-label="モバイルナビゲーション"
    >
      <Nav className="mobile-bottom-nav-inner justify-content-around">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.to, item.end);
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
