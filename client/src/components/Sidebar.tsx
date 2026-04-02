import { useCallback, useEffect, useState } from 'react';
import { Nav, Offcanvas } from 'react-bootstrap';
import AppButton from './ui/AppButton';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { fetchUnreadCount } from '../api/messages';
import { MESSAGE_NAV_UPDATED_EVENT } from '../lib/message-nav-events';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const NAV_GROUPS = [
  {
    title: '主要操作',
    items: [
      { to: '/', label: 'ダッシュボード', end: true },
      { to: '/upload', label: 'アップロード' },
      { to: '/upload-quality', label: 'アップロード品質' },
      { to: '/matching', label: 'マッチング' },
      { to: '/proposals', label: 'マッチング一覧' },
      { to: '/messages', label: 'メッセージ' },
      { to: '/exchange-history', label: '交換履歴' },
      { to: '/statistics', label: '統計' },
    ],
  },
  {
    title: '通知・対応',
    items: [
      { to: '/notifications', label: '通知センター' },
      { to: '/alerts', label: 'アラート一覧' },
      { to: '/requests', label: '要望一覧' },
      { to: '/bookmarks', label: 'ブックマーク' },
      { to: '/groups', label: 'グループ' },
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
  { to: '/admin/upload-quality', label: 'アップロード品質' },
  { to: '/admin/pharmacies', label: '薬局管理' },
  { to: '/admin/direct-messages', label: 'ユーザー間メッセージ' },
  { to: '/admin/user-requests', label: 'ユーザーリクエスト管理' },
  { to: '/admin/notifications', label: '通知・配信状況' },
  { to: '/admin/openclaw', label: 'OpenClaw連携' },
  { to: '/admin/drug-master', label: '医薬品マスター管理' },
  { to: '/admin/matching-experiments', label: 'マッチング実験' },
  { to: '/admin/log-center', label: 'ログセンター' },
  { to: '/admin/audit', label: '監査ログ' },
  { to: '/admin/error-codes', label: 'エラーコード' },
  { to: '/admin/logs', label: '操作ログ' },
];

function SidebarLink({
  to,
  label,
  onNavigate,
  end = false,
  badgeCount,
}: {
  to: string;
  label: string;
  onNavigate?: () => void;
  end?: boolean;
  badgeCount?: number;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }: { isActive: boolean }) => `sidebar-link nav-link${isActive ? ' active' : ''}`}
      onClick={() => onNavigate?.()}
    >
      <span>{label}</span>
      {badgeCount && badgeCount > 0 ? (
        <span className="sidebar-badge" aria-label={`${badgeCount}件の未読メッセージ`}>
          {badgeCount > 99 ? '99+' : badgeCount}
        </span>
      ) : null}
    </NavLink>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [messageUnreadCount, setMessageUnreadCount] = useState(0);

  const refreshMessageUnreadCount = useCallback(async () => {
    if (!user || user.isAdmin) {
      setMessageUnreadCount(0);
      return;
    }
    try {
      const result = await fetchUnreadCount();
      setMessageUnreadCount(result.unreadCount);
    } catch {
      setMessageUnreadCount(0);
    }
  }, [user]);

  useEffect(() => {
    void refreshMessageUnreadCount();
  }, [refreshMessageUnreadCount, location.pathname]);

  useEffect(() => {
    const handleMessageNavUpdated = () => {
      void refreshMessageUnreadCount();
    };
    window.addEventListener(MESSAGE_NAV_UPDATED_EVENT, handleMessageNavUpdated);
    return () => {
      window.removeEventListener(MESSAGE_NAV_UPDATED_EVENT, handleMessageNavUpdated);
    };
  }, [refreshMessageUnreadCount]);

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
            <div className="sidebar-group-title">管理者</div>
            {ADMIN_ITEMS.map((item) => (
              <SidebarLink
                key={item.to}
                to={item.to}
                label={item.label}
                onNavigate={onNavigate}
                end={item.end}
              />
            ))}
          </div>
        )}
        {NAV_GROUPS.map((group) => (
          <div key={group.title} className="sidebar-group">
            <div className="sidebar-group-title">{group.title}</div>
            {group.items
              .filter((item) => !(user?.isAdmin && item.to === '/messages'))
              .map((item) => (
              <SidebarLink
                key={item.to}
                to={item.to}
                label={item.label}
                onNavigate={onNavigate}
                end={item.end}
                badgeCount={item.to === '/messages' ? messageUnreadCount : undefined}
              />
            ))}
          </div>
        ))}
      </Nav>

      <div className="sidebar-footer border-top p-3">
        <SidebarLink to="/account" label={user?.name ?? 'アカウント'} onNavigate={onNavigate} />
        <AppButton variant="outline-secondary" size="sm" className="w-100 mt-2" onClick={handleLogout}>
          ログアウト
        </AppButton>
      </div>
    </div>
  );
}

export default function Sidebar({ isOpen, onClose }: Props) {
  return (
    <>
      <aside className="sidebar-desktop d-none d-lg-flex">
        <SidebarContent />
      </aside>

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
