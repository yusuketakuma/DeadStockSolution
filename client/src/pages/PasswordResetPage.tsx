import { useState, useEffect, FormEvent } from 'react';
import { Container, Card, Form, Button, Alert, Spinner } from 'react-bootstrap';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';

export default function PasswordResetPage() {
  const [searchParams] = useSearchParams();
  const tokenFromUrl = searchParams.get('token') || '';

  const [step, setStep] = useState<'request' | 'confirm'>(tokenFromUrl ? 'confirm' : 'request');

  useEffect(() => {
    if (tokenFromUrl) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [tokenFromUrl]);
  const [email, setEmail] = useState('');
  const [token, setToken] = useState(tokenFromUrl);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleRequest = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);
    try {
      const data = await api.post<{ message: string; token?: string }>('/auth/password-reset/request', { email });
      setSuccess(data.message);
      if (data.token) {
        setToken(data.token);
        setStep('confirm');
        setSuccess('リセットトークンが発行されました。新しいパスワードを入力してください。');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'リクエストに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword !== confirmPassword) {
      setError('パスワードが一致しません');
      return;
    }
    if (newPassword.length < 8) {
      setError('パスワードは8文字以上で入力してください');
      return;
    }
    if (!/[a-zA-Z]/.test(newPassword)) {
      setError('パスワードにはアルファベットを含めてください');
      return;
    }
    if (!/\d/.test(newPassword)) {
      setError('パスワードには数字を含めてください');
      return;
    }

    setLoading(true);
    try {
      const data = await api.post<{ message: string }>('/auth/password-reset/confirm', { token, newPassword });
      setSuccess(data.message);
      setToken('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'リセットに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container className="d-flex justify-content-center align-items-center" style={{ minHeight: '100vh' }}>
      <Card style={{ width: '100%', maxWidth: '420px' }}>
        <Card.Body>
          <h3 className="text-center mb-3">パスワードリセット</h3>

          {error && <Alert variant="danger">{error}</Alert>}
          {success && <Alert variant="success">{success}</Alert>}

          {step === 'request' && (
            <Form onSubmit={handleRequest}>
              <Form.Group className="mb-3">
                <Form.Label>メールアドレス</Form.Label>
                <Form.Control
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="登録済みのメールアドレス"
                />
              </Form.Group>
              <Button type="submit" variant="primary" className="w-100" disabled={loading}>
                {loading ? <Spinner size="sm" animation="border" /> : 'リセットリンクを送信'}
              </Button>
              <div className="text-center mt-3">
                <span className="text-muted small me-2">トークンをお持ちの場合</span>
                <Button variant="link" size="sm" onClick={() => setStep('confirm')}>
                  パスワード再設定へ
                </Button>
              </div>
            </Form>
          )}

          {step === 'confirm' && (
            <Form onSubmit={handleConfirm}>
              <Form.Group className="mb-3">
                <Form.Label>リセットトークン</Form.Label>
                <Form.Control
                  type="text"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  required
                  placeholder="メールに記載のトークン"
                />
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label>新しいパスワード</Form.Label>
                <Form.Control
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                  placeholder="英字+数字を含む8文字以上"
                />
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label>新しいパスワード（確認）</Form.Label>
                <Form.Control
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </Form.Group>
              <Button type="submit" variant="primary" className="w-100" disabled={loading}>
                {loading ? <Spinner size="sm" animation="border" /> : 'パスワードを再設定'}
              </Button>
              <div className="text-center mt-3">
                <Button variant="link" size="sm" onClick={() => { setStep('request'); setError(''); setSuccess(''); }}>
                  メールアドレス入力に戻る
                </Button>
              </div>
            </Form>
          )}

          <div className="text-center mt-3">
            <Link to="/login">ログインに戻る</Link>
          </div>
        </Card.Body>
      </Card>
    </Container>
  );
}
