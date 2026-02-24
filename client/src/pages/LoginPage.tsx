import { useState, FormEvent } from 'react';
import { Container, Card, Form, Button, Alert, Nav } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { APP_VERSION } from '../constants/appVersion';

const DEFAULT_TEST_ACCOUNT_PASSWORD = 'password123';

const TEST_ACCOUNTS = [
  { label: 'テスト薬局（東京）', email: 'test@example.com' },
  { label: 'テスト薬局2号店（大阪）', email: 'test2@example.com' },
];

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'user' | 'admin'>('user');
  const { login, logout } = useAuth();
  const navigate = useNavigate();
  const testAccountPassword = import.meta.env.VITE_TEST_ACCOUNT_PASSWORD?.trim() || DEFAULT_TEST_ACCOUNT_PASSWORD;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(email, password);
      if (mode === 'admin') {
        if (!user.isAdmin) {
          try {
            await logout();
          } catch {
            // ignore
          }
          setError('管理者権限がありません');
          return;
        }
        navigate('/admin');
      } else {
        navigate('/');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ログインに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleTestLogin = (account: { email: string }) => {
    setError('');
    setEmail(account.email);
    setPassword(testAccountPassword);
  };

  const switchMode = (newMode: 'user' | 'admin') => {
    setMode(newMode);
    setError('');
    setEmail('');
    setPassword('');
  };

  return (
    <Container className="d-flex justify-content-center align-items-center" style={{ minHeight: '100vh' }}>
      <Card style={{ width: '100%', maxWidth: '483px' }}>
        <Card.Header className="p-0">
          <Nav
            variant="tabs"
            activeKey={mode}
            onSelect={(k) => {
              if (k === 'user' || k === 'admin') {
                switchMode(k);
              }
            }}
          >
            <Nav.Item>
              <Nav.Link eventKey="user">薬局ログイン</Nav.Link>
            </Nav.Item>
            <Nav.Item>
              <Nav.Link eventKey="admin">管理者ログイン</Nav.Link>
            </Nav.Item>
          </Nav>
        </Card.Header>
        <Card.Body>
          <div className="login-title-wrap mb-4">
            <h3 className="mb-0">薬局不動在庫交換システム</h3>
            <span className="login-title-version">{APP_VERSION}</span>
          </div>
          <h5 className="text-center mb-3">
            {mode === 'admin' ? '管理者ログイン' : 'ログイン'}
          </h5>
          {error && <Alert variant="danger">{error}</Alert>}
          <Form onSubmit={handleSubmit}>
            <Form.Group className="mb-3">
              <Form.Label>メールアドレス</Form.Label>
              <Form.Control
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>パスワード</Form.Label>
              <Form.Control
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Form.Group>
            <Button
              type="submit"
              variant={mode === 'admin' ? 'danger' : 'primary'}
              className="w-100"
              disabled={loading}
            >
              {loading ? 'ログイン中...' : mode === 'admin' ? '管理者ログイン' : 'ログイン'}
            </Button>
          </Form>

          <div className="text-center mt-2">
            <Link to="/password-reset" className="text-muted small">パスワードを忘れた方</Link>
          </div>

          {mode === 'user' && (
            <>
              <div className="text-center mt-2">
                <Link to="/register">新規登録はこちら</Link>
              </div>

              <>
                <hr />
                <p className="text-muted small text-center mb-2">デモアカウント（ワンクリック入力）</p>
                <div className="d-grid gap-2">
                  {TEST_ACCOUNTS.map((account) => (
                    <Button
                      key={account.email}
                      variant="outline-secondary"
                      size="sm"
                      disabled={loading}
                      onClick={() => handleTestLogin(account)}
                    >
                      {account.label}
                    </Button>
                  ))}
                </div>
                <p className="text-muted small text-center mt-2 mb-0">
                  ボタンを押すとメールアドレスとパスワードが入力されます。
                </p>
              </>
            </>
          )}

          {mode === 'admin' && (
            <div className="text-muted small text-center mt-3">
              管理者アカウントでログインしてください。
            </div>
          )}
        </Card.Body>
        <Card.Footer className="text-muted small text-center">
          本システムは業務補助ツールであり、一切の責任を負いません。
        </Card.Footer>
      </Card>
    </Container>
  );
}
