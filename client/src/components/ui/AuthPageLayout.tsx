import type { ReactNode } from 'react';
import { Container } from 'react-bootstrap';
import AppCard from './AppCard';

interface AuthPageLayoutProps {
  main: ReactNode;
  aside?: ReactNode;
  footerNote: string;
}

export default function AuthPageLayout({ main, aside, footerNote }: AuthPageLayoutProps) {
  return (
    <div className="dl-auth-page d-flex align-items-center">
      <a href="#auth-main-content" className="dl-skip-link">フォームへスキップ</a>
      <Container className="dl-auth-shell">
        <AppCard className="dl-auth-card">
          <div className="dl-auth-grid">
            <main id="auth-main-content" className="dl-auth-main" tabIndex={-1}>{main}</main>
            {aside && <aside className="dl-auth-aside">{aside}</aside>}
          </div>
          <div className="dl-auth-footer">{footerNote}</div>
        </AppCard>
      </Container>
    </div>
  );
}
