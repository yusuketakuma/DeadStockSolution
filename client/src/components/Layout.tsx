import { useState } from 'react';
import Header from './Header';
import Sidebar from './Sidebar';
import AppScreen from './ui/AppScreen';
import { useMatchNotificationToast } from '../hooks/useMatchNotificationToast';

interface Props {
  children: React.ReactNode;
}

export default function Layout({ children }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  useMatchNotificationToast();

  return (
    <div className="app-layout app-theme">
      <a href="#app-main-content" className="dl-skip-link">メインコンテンツへスキップ</a>
      <Header onToggleSidebar={() => setSidebarOpen((prev) => !prev)} />
      <div className="app-body">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main id="app-main-content" className="app-main" tabIndex={-1}>
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
    </div>
  );
}
