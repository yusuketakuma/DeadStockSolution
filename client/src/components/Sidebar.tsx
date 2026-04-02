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

interface SidebarNavItem {
  to: string;
  label: string;
  end?: boolean;
}

interface SidebarNavGroup {
  title: string;
  items: readonly SidebarNavItem[];
}

const NAV_GROUPS: readonly SidebarNavGroup[] = [
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

const ADMIN_NAV_GROUPS: readonly SidebarNavGroup[] = [
  {
    title: '運用監視',
    items: [
      { to: '/admin', label: '管理者ダッシュボード', end: true },
      { to: '/admin/notifications', label: '通知・配信状況' },
      { to: '/admin/upload-jobs', label: '取込ジョブ管理' },
      { to: '/admin/upload-quality', label: 'アップロード品質' },
      { to: '/admin/risk', label: '期限リスク分析' },
      { to: '/admin/reports', label: '月次レポート' },
      { to: '/admin/log-center', label: 'ログセンター' },
      { to: '/admin/error-codes', label: 'エラーコード' },
      { to: '/admin/audit', label: '監査ログ' },
      { to: '/admin/logs', label: '操作ログ' },
    ],
  },
  {
    title: '薬局運用',
    items: [
      { to: '/admin/pharmacies', label: '薬局管理' },
      { to: '/admin/pharmacy-health', label: '薬局ヘルス' },
      { to: '/admin/groups', label: 'グループ管理' },
      { to: '/admin/business-hours', label: '営業時間' },
      { to: '/admin/relationships', label: '関係性監査' },
      { to: '/admin/bulk-actions', label: '一括操作' },
      { to: '/admin/direct-messages', label: 'ユーザー間メッセージ' },
      { to: '/admin/user-requests', label: 'ユーザーリクエスト管理' },
      { to: '/admin/alerts', label: 'アラート管理' },
      { to: '/admin/exchanges', label: '交換履歴' },
    ],
  },
  {
    title: '最適化・基盤',
    items: [
      { to: '/admin/matching-rules', label: 'マッチングルール' },
      { to: '/admin/matching-experiments', label: 'マッチング実験' },
      { to: '/admin/matching-performance', label: 'マッチング性能' },
      { to: '/admin/drug-master', label: '医薬品マスター管理' },
      { to: '/admin/drug-equivalences', label: '薬品同等性' },
      { to: '/admin/rate-limits', label: 'レート制限設定' },
      { to: '/admin/openclaw', label: 'OpenClaw連携' },
    ],
  },
] as const;

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
          <>
            <div className="sidebar-group">
              <div className="sidebar-group-title">管理者</div>
            </div>
            {ADMIN_NAV_GROUPS.map((group) => (
              <div key={group.title} className="sidebar-group">
                <div className="sidebar-group-title">{group.title}</div>
                {group.items.map((item) => (
                  <SidebarLink
                    key={item.to}
                    to={item.to}
                    label={item.label}
                    onNavigate={onNavigate}
                    end={'end' in item ? item.end : false}
                  />
                ))}
              </div>
            ))}
          </>
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
