import { Nav, Offcanvas } from 'react-bootstrap';
import AppButton from './ui/AppButton';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

const NAV_GROUPS = [
  {
    title: '主要操作',
    items: [
      { to: '/', label: 'ダッシュボード', end: true },
      { to: '/upload', label: 'アップロード' },
      { to: '/matching', label: 'マッチング' },
      { to: '/proposals', label: 'マッチング一覧' },
      { to: '/exchange-history', label: '交換履歴' },
      { to: '/statistics', label: '統計' },
      { to: '/groups', label: 'グループ' },
      { to: '/alerts', label: 'アラート' },
    ],
  },
  {
    title: '在庫・参照',
    items: [
      { to: '/inventory/dead-stock', label: 'デッドストックリスト' },
      { to: '/inventory/used-medication', label: '医薬品使用量リスト' },
      { to: '/inventory/browse', label: '在庫参照' },
      { to: '/pharmacies', label: '薬局一覧' },
    ],
  },
];

const ADMIN_ITEMS = [
  { to: '/admin', label: '管理者ダッシュボード', end: true },
  { to: '/admin/risk', label: '期限リスク分析' },
  { to: '/admin/reports', label: '月次レポート' },
  { to: '/admin/exchanges', label: '交換履歴' },
  { to: '/admin/upload-jobs', label: '取込ジョブ管理' },
  { to: '/admin/pharmacies', label: '薬局管理' },
  { to: '/admin/openclaw', label: 'OpenClaw連携' },
  { to: '/admin/drug-master', label: '医薬品マスター' },
  { to: '/admin/matching-rules', label: 'マッチングルール' },
  { to: '/admin/log-center', label: 'ログセンター' },
  { to: '/admin/drug-equivalences', label: '薬品同等性マスター' },
];

const ICON_MAP: Record<string, string> = {
  '/': '📊',
  '/upload': '📤',
  '/matching': '🔗',
  '/proposals': '📋',
  '/exchange-history': '🔄',
  '/statistics': '📈',
  '/groups': '👥',
  '/alerts': '🔔',
  '/inventory/dead-stock': '📦',
  '/inventory/used-medication': '💊',
  '/inventory/browse': '🔍',
  '/pharmacies': '🏥',
  '/admin': '⚙️',
  '/admin/risk': '⚠️',
  '/admin/reports': '📊',
  '/admin/exchanges': '🔄',
  '/admin/upload-jobs': '📥',
  '/admin/pharmacies': '🏥',
  '/admin/openclaw': '🔌',
  '/admin/drug-master': '💊',
  '/admin/matching-rules': '📐',
  '/admin/log-center': '📜',
  '/admin/drug-equivalences': '🔀',
  '/account': '👤',
};

function SidebarLink({
  to,
  label,
  onNavigate,
  end = false,
  collapsed = false,
}: {
  to: string;
  label: string;
  onNavigate?: () => void;
  end?: boolean;
  collapsed?: boolean;
}) {
  const icon = ICON_MAP[to] ?? '📄';
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
    </NavLink>
  );
}

function SidebarContent({ onNavigate, collapsed = false, onToggleCollapse }: {
  onNavigate?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    onNavigate?.();
    await logout();
    navigate('/login');
  };

  return (
    <div className="sidebar-content d-flex flex-column h-100">
      <Nav className="flex-column flex-grow-1 pt-2">
        {NAV_GROUPS.map((group) => (
          <div key={group.title} className="sidebar-group">
            {!collapsed && <div className="sidebar-group-title">{group.title}</div>}
            {group.items.map((item) => (
              <SidebarLink
                key={item.to}
                to={item.to}
                label={item.label}
                onNavigate={onNavigate}
                end={item.end}
                collapsed={collapsed}
              />
            ))}
          </div>
        ))}
        {user?.isAdmin && (
          <div className="sidebar-group">
            {!collapsed && <div className="sidebar-group-title">管理者</div>}
            {ADMIN_ITEMS.map((item) => (
              <SidebarLink
                key={item.to}
                to={item.to}
                label={item.label}
                onNavigate={onNavigate}
                end={item.end}
                collapsed={collapsed}
              />
            ))}
          </div>
        )}
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
