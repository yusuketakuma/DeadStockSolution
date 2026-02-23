import { Container } from 'react-bootstrap';
import AppNavbar from './Navbar';

interface Props {
  children: React.ReactNode;
}

export default function Layout({ children }: Props) {
  return (
    <div className="d-flex flex-column min-vh-100">
      <AppNavbar />
      <Container fluid className="flex-grow-1 py-3">
        {children}
      </Container>
      <footer className="bg-light border-top py-2 px-3">
        <small className="text-muted">
          本システムはあくまで業務補助ツールであり、医薬品の交換に関する一切の責任を負いません。
          実際の医薬品のやり取り（配送・受渡し）には一切関与しません。
        </small>
      </footer>
    </div>
  );
}
