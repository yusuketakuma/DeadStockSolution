import { Button } from 'react-bootstrap';
import { Link } from 'react-router-dom';

interface Props {
  onToggleSidebar: () => void;
}

export default function Header({ onToggleSidebar }: Props) {
  return (
    <header className="app-header">
      <Button
        variant="link"
        className="sidebar-toggle d-lg-none text-white p-0 me-3"
        onClick={onToggleSidebar}
        aria-label="メニューを開く"
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </Button>
      <Link to="/" className="app-header-brand">
        DeadStockSolution
      </Link>
    </header>
  );
}
