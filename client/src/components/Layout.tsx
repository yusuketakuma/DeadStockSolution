import { useState } from 'react';
import Header from './Header';
import Sidebar from './Sidebar';

interface Props {
  children: React.ReactNode;
}

export default function Layout({ children }: Props) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="app-layout">
      <Header onToggleSidebar={() => setSidebarOpen((prev) => !prev)} />
      <div className="app-body">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="app-main">
          <div className="content-container py-3 px-3">
            {children}
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
