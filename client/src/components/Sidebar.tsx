import { Nav, Button, Offcanvas } from 'react-bootstrap';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const NAV_ITEMS = [
  { to: '/', label: 'ダッシュボード', icon: '🏠' },
  { to: '/upload', label: 'アップロード', icon: '📤' },
  { to: '/inventory/dead-stock', label: '不動在庫', icon: '📦' },
  { to: '/inventory/used-medication', label: '使用薬剤', icon: '💊' },
  { to: '/inventory/browse', label: '在庫参照', icon: '🔍' },
  { to: '/matching', label: 'マッチング', icon: '🔄' },
  { to: '/proposals', label: 'マッチング一覧', icon: '📋' },
  { to: '/exchange-history', label: '交換履歴', icon: '📜' },
  { to: '/pharmacies', label: '薬局一覧', icon: '🏥' },
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
    return location.pathname.startsWith(path);
  };

  return (
    <div className="sidebar-content d-flex flex-column h-100">
      <Nav className="flex-column flex-grow-1 pt-2">
        {NAV_ITEMS.map((item) => (
          <Nav.Link
            key={item.to}
            href={item.to}
            className={`sidebar-link${isActive(item.to) ? ' active' : ''}`}
            onClick={handleNav(item.to)}
          >
            <span className="sidebar-icon">{item.icon}</span>
            {item.label}
          </Nav.Link>
        ))}
        {user?.isAdmin && (
          <>
            <Nav.Link
              href="/admin"
              className={`sidebar-link${isActive('/admin') ? ' active' : ''}`}
              onClick={handleNav('/admin')}
            >
              <span className="sidebar-icon">⚙️</span>
              管理者
            </Nav.Link>
            <Nav.Link
              href="/admin/drug-master"
              className={`sidebar-link${location.pathname === '/admin/drug-master' ? ' active' : ''}`}
              onClick={handleNav('/admin/drug-master')}
            >
              <span className="sidebar-icon">💊</span>
              医薬品マスター
            </Nav.Link>
            <Nav.Link
              href="/admin/logs"
              className={`sidebar-link${location.pathname === '/admin/logs' ? ' active' : ''}`}
              onClick={handleNav('/admin/logs')}
            >
              <span className="sidebar-icon">📝</span>
              操作ログ
            </Nav.Link>
          </>
        )}
      </Nav>

      <div className="sidebar-footer border-top p-3">
        <Nav.Link
          href="/account"
          className="sidebar-link mb-2"
          onClick={handleNav('/account')}
        >
          <span className="sidebar-icon">👤</span>
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
