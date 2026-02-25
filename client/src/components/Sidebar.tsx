import { Nav, Button, Offcanvas } from 'react-bootstrap';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const NAV_GROUPS = [
  {
    title: '主要操作',
    items: [
      { to: '/', label: 'ダッシュボード' },
      { to: '/upload', label: 'アップロード' },
      { to: '/matching', label: 'マッチング' },
      { to: '/proposals', label: 'マッチング一覧' },
      { to: '/exchange-history', label: '交換履歴' },
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
  { to: '/admin', label: '管理者ダッシュボード' },
  { to: '/admin/openclaw', label: 'OpenClaw連携' },
  { to: '/admin/drug-master', label: '医薬品マスター' },
  { to: '/admin/logs', label: '操作ログ' },
];

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleNav = (to: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    navigate(to);
    onNavigate?.();
  };

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    if (path === '/admin') return location.pathname === '/admin';
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  return (
    <div className="sidebar-content d-flex flex-column h-100">
      <Nav className="flex-column flex-grow-1 pt-2">
        {NAV_GROUPS.map((group) => (
          <div key={group.title} className="sidebar-group">
            <div className="sidebar-group-title">{group.title}</div>
            {group.items.map((item) => (
              <Nav.Link
                key={item.to}
                href={item.to}
                className={`sidebar-link${isActive(item.to) ? ' active' : ''}`}
                onClick={handleNav(item.to)}
              >
                {item.label}
              </Nav.Link>
            ))}
          </div>
        ))}
        {user?.isAdmin && (
          <div className="sidebar-group">
            <div className="sidebar-group-title">管理者</div>
            {ADMIN_ITEMS.map((item) => (
              <Nav.Link
                key={item.to}
                href={item.to}
                className={`sidebar-link${isActive(item.to) ? ' active' : ''}`}
                onClick={handleNav(item.to)}
              >
                {item.label}
              </Nav.Link>
            ))}
          </div>
        )}
      </Nav>

      <div className="sidebar-footer border-top p-3">
        <Nav.Link
          href="/account"
          className="sidebar-link mb-2"
          onClick={handleNav('/account')}
        >
          {user?.name}
        </Nav.Link>
        <Button variant="outline-secondary" size="sm" className="w-100" onClick={handleLogout}>
          ログアウト
        </Button>
      </div>
    </div>
  );
}

export default function Sidebar({ isOpen, onClose }: Props) {
  return (
    <>
      {/* PC: 常時表示サイドバー */}
      <aside className="sidebar-desktop d-none d-lg-flex">
        <SidebarContent />
      </aside>

      {/* モバイル: Offcanvas */}
      <Offcanvas show={isOpen} onHide={onClose} className="sidebar-mobile d-lg-none" placement="start">
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
