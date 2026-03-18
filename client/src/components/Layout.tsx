import { useRef, useState } from 'react';
import Header from './Header';
import Sidebar from './Sidebar';
import AppScreen from './ui/AppScreen';
import AppBreadcrumb from './ui/AppBreadcrumb';
import { useMatchNotificationToast } from '../hooks/useMatchNotificationToast';
import { usePageSwipe } from '../hooks/usePageSwipe';
import MobileBottomNav from './layout/MobileBottomNav';
import './layout/MobileBottomNav.css';

interface Props {
  children: React.ReactNode;
}

const SIDEBAR_COLLAPSED_KEY = 'dss.sidebar-collapsed';

export default function Layout({ children }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  });
  useMatchNotificationToast();

  const mainRef = useRef<HTMLElement | null>(null);
  usePageSwipe(mainRef, { disabled: sidebarOpen });

  const toggleSidebarCollapse = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch { /* ignore */ }
      return next;
    });
  };

  return (
    <div className={`app-layout app-theme${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <a href="#app-main-content" className="dl-skip-link">メインコンテンツへスキップ</a>
      <Header onToggleSidebar={() => setSidebarOpen((prev) => !prev)} />
      <div className="app-body">
        <Sidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebarCollapse}
        />
        <main id="app-main-content" className="app-main" tabIndex={-1} ref={mainRef}>
          <AppBreadcrumb />
          <div className="content-container py-3 px-3">
            <AppScreen>{children}</AppScreen>
          </div>
          <footer className="app-footer border-top py-2 px-3">
            <small className="text-muted">
              本システムはあくまで業務補助ツールであり、医薬品の交換に関する一切の責任を負いません。
              実際の医薬品のやり取り（配送・受渡し）には一切関与しません。
            </small>
          </footer>
        </main>
      </div>
      <MobileBottomNav />
    </div>
  );
}
