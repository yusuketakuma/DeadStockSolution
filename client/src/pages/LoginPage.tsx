import { useState, FormEvent } from 'react';
import { Container, Card, Form, Button, Alert } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const TEST_ACCOUNTS = [
  { key: 'tokyo' as const, label: 'テスト薬局（東京）' },
  { key: 'osaka' as const, label: 'テスト薬局2号店（大阪）' },
];

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, testLogin } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ログインに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleTestLogin = async (key: 'tokyo' | 'osaka') => {
    setError('');
    setLoading(true);
    try {
      await testLogin(key);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ログインに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container className="d-flex justify-content-center align-items-center" style={{ minHeight: '100vh' }}>
      <Card style={{ width: '100%', maxWidth: '420px' }}>
        <Card.Body>
          <h3 className="text-center mb-4">薬局不動在庫交換システム</h3>
          <h5 className="text-center mb-3">ログイン</h5>
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
            <Button type="submit" variant="primary" className="w-100" disabled={loading}>
              {loading ? 'ログイン中...' : 'ログイン'}
            </Button>
          </Form>
          <div className="text-center mt-3">
            <Link to="/register">新規登録はこちら</Link>
          </div>

          <hr />
          <p className="text-muted small text-center mb-2">テストアカウントでログイン</p>
          <div className="d-grid gap-2">
            {TEST_ACCOUNTS.map((account) => (
              <Button
                key={account.key}
                variant="outline-secondary"
                size="sm"
                disabled={loading}
                onClick={() => handleTestLogin(account.key)}
              >
                {account.label}
              </Button>
            ))}
          </div>
        </Card.Body>
        <Card.Footer className="text-muted small text-center">
          本システムは業務補助ツールであり、一切の責任を負いません。
        </Card.Footer>
      </Card>
    </Container>
  );
}
