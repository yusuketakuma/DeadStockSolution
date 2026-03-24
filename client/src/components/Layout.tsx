import { useRef, useState, useCallback } from 'react';
import Header from './Header';
import Sidebar from './Sidebar';
import AppScreen from './ui/AppScreen';
import AppBreadcrumb from './ui/AppBreadcrumb';
import { useMatchNotificationToast } from '../hooks/useMatchNotificationToast';
import { usePageSwipe } from '../hooks/usePageSwipe';
import { useIdleTimeout } from '../hooks/useIdleTimeout';
import { useAuth } from '../contexts/AuthContext';
import IdleTimeoutDialog from './IdleTimeoutDialog';
import MobileBottomNav from './layout/MobileBottomNav';
import './layout/MobileBottomNav.css';

interface Props {
  children: React.ReactNode;
}

const IDLE_WARN_REMAINING_SECONDS = 5 * 60;

export default function Layout({ children }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showIdleWarning, setShowIdleWarning] = useState(false);
  const { logout, user } = useAuth();

  const handleIdleWarn = useCallback(() => {
    setShowIdleWarning(true);
  }, []);

  const handleIdleTimeout = useCallback(() => {
    setShowIdleWarning(false);
    void logout();
  }, [logout]);

  const idleTimeout = useIdleTimeout({
    onWarn: handleIdleWarn,
    onTimeout: handleIdleTimeout,
    enabled: !!user,
  });

  const handleExtendSession = useCallback(() => {
    setShowIdleWarning(false);
    idleTimeout.reset();
  }, [idleTimeout]);

  useMatchNotificationToast();

  const mainRef = useRef<HTMLElement | null>(null);
  usePageSwipe(mainRef, { disabled: sidebarOpen });

  return (
    <div className="app-layout app-theme">
      <a href="#app-main-content" className="dl-skip-link">メインコンテンツへスキップ</a>
      <Header onToggleSidebar={() => setSidebarOpen((prev) => !prev)} />
      <div className="app-body">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
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
      <IdleTimeoutDialog
        show={showIdleWarning}
        remainingSeconds={IDLE_WARN_REMAINING_SECONDS}
        onExtend={handleExtendSession}
        onLogout={handleIdleTimeout}
      />
    </div>
  );
}
