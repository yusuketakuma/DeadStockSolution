import { Navbar as BSNavbar, Nav, Container } from 'react-bootstrap';
import AppButton from './ui/AppButton';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function AppNavbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  if (!user) return null;

  return (
    <BSNavbar bg="primary" variant="dark" expand="lg" className="mb-0">
      <Container fluid>
        <BSNavbar.Brand as={Link} to="/">
          デッドストック交換
        </BSNavbar.Brand>
        <BSNavbar.Toggle aria-controls="main-nav" />
        <BSNavbar.Collapse id="main-nav">
          <Nav className="me-auto">
            <Nav.Link as={Link} to="/">ダッシュボード</Nav.Link>
            <Nav.Link as={Link} to="/upload">アップロード</Nav.Link>
            <Nav.Link as={Link} to="/inventory/dead-stock">デッドストックリスト</Nav.Link>
            <Nav.Link as={Link} to="/inventory/used-medication">医薬品使用量リスト</Nav.Link>
            <Nav.Link as={Link} to="/inventory/browse">在庫参照</Nav.Link>
            <Nav.Link as={Link} to="/matching">マッチング</Nav.Link>
            <Nav.Link as={Link} to="/proposals">マッチング一覧</Nav.Link>
            <Nav.Link as={Link} to="/exchange-history">交換履歴</Nav.Link>
            <Nav.Link as={Link} to="/pharmacies">薬局一覧</Nav.Link>
            {user.isAdmin && (
              <Nav.Link as={Link} to="/admin">管理者</Nav.Link>
            )}
          </Nav>
          <Nav className="align-items-lg-center">
            <Nav.Link as={Link} to="/account">{user.name}</Nav.Link>
            <AppButton variant="outline-light" size="sm" className="mt-2 mt-lg-0 ms-lg-2" onClick={handleLogout}>
              ログアウト
            </AppButton>
          </Nav>
        </BSNavbar.Collapse>
      </Container>
    </BSNavbar>
  );
}
