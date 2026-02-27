import { useState, FormEvent } from 'react';
import { useAsyncState } from '../hooks/useAsyncState';
import { Nav } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { APP_VERSION } from '../constants/appVersion';
import AuthPageLayout from '../components/ui/AuthPageLayout';
import StatusAlert from '../components/ui/StatusAlert';
import LoadingButton from '../components/ui/LoadingButton';
import AppField from '../components/ui/AppField';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { loading, setLoading, error, setError } = useAsyncState();
  const [mode, setMode] = useState<'user' | 'admin'>('user');
  const { login, logout } = useAuth();
  const navigate = useNavigate();

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

  const switchMode = (newMode: 'user' | 'admin') => {
    setMode(newMode);
    setError('');
    setEmail('');
    setPassword('');
  };

  return (
    <AuthPageLayout
      footerNote="本システムは業務補助ツールです。入力内容は確認のうえ運用してください。"
      main={(
        <>
          <div className="dl-brand-row">
            <h1>薬局デッドストック交換システム</h1>
            <span className="dl-version-chip">{APP_VERSION}</span>
          </div>
          <p className="dl-lead">薬局間在庫の調整を安全に進めるための業務ポータルです。</p>

          <Nav
            className="dl-auth-tabs"
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

          <h2 className="h5 text-center mt-3 mb-3">
            {mode === 'admin' ? '管理者ログイン' : 'ログイン'}
          </h2>
          {error && <StatusAlert variant="danger" message={error} />}

          <form onSubmit={handleSubmit}>
            <AppField
              className="mb-3"
              controlId="login-email"
              label="メールアドレス"
              type="email"
              value={email}
              onChange={(value) => setEmail(value)}
              autoComplete="username"
              inputMode="email"
              enterKeyHint="next"
              required
              helpText="連絡先として登録したメールアドレスを入力してください。"
            />
            <AppField
              className="mb-3"
              controlId="login-password"
              label="パスワード"
              type="password"
              value={password}
              onChange={(value) => setPassword(value)}
              autoComplete="current-password"
              enterKeyHint="go"
              required
              helpText="共用端末では入力後に周囲確認を行ってください。"
            />
            <LoadingButton
              type="submit"
              variant={mode === 'admin' ? 'danger' : 'primary'}
              className="w-100"
              loading={loading}
              loadingLabel="ログイン中..."
            >
              {mode === 'admin' ? '管理者ログイン' : 'ログイン'}
            </LoadingButton>
          </form>

          <div className="dl-link-row">
            <Link to="/password-reset">パスワードを忘れた方</Link>
          </div>

          {mode === 'user' && (
            <div className="dl-link-row">
              <Link to="/register">新規登録はこちら</Link>
            </div>
          )}

          {mode === 'admin' && (
            <div className="text-muted small text-center mt-3">
              管理者アカウントでログインしてください。
            </div>
          )}
        </>
      )}
      aside={(
        <section aria-label="運用上の確認事項">
          <h3 className="h6 mb-3">ログイン前の確認</h3>
          <ul className="dl-trust-list">
            <li>患者情報や薬歴情報はこの画面で入力しないでください。</li>
            <li>入力エラー時はメッセージ内容を確認し、同じ操作を繰り返さないでください。</li>
            <li>管理者ログインは運用担当者のみ利用してください。</li>
            <li>共用端末では操作後に必ずログアウトしてください。</li>
          </ul>
        </section>
      )}
    />
  );
}
