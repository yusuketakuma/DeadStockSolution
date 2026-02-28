import { useState, FormEvent } from 'react';
import { useAsyncState } from '../hooks/useAsyncState';
import { Nav } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';
import AuthPageLayout from '../components/ui/AuthPageLayout';
import StatusAlert from '../components/ui/StatusAlert';
import LoadingButton from '../components/ui/LoadingButton';
import AppField from '../components/ui/AppField';
import AppModalShell from '../components/ui/AppModalShell';
import AppResponsiveSwitch from '../components/ui/AppResponsiveSwitch';
import AppMobileDataCard from '../components/ui/AppMobileDataCard';
import { APP_VERSION } from '../constants/appVersion';

type LoginMode = 'user' | 'admin';

interface TestPharmacyPreview {
  id: number;
  name: string;
  email: string;
  prefecture: string;
  password: string;
}

interface TestPharmacyResponse {
  accounts?: unknown;
}

function isTestPharmacyPreview(value: unknown): value is TestPharmacyPreview {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === 'number'
    && typeof candidate.name === 'string'
    && typeof candidate.email === 'string'
    && typeof candidate.prefecture === 'string'
    && typeof candidate.password === 'string';
}

function parseTestPharmacyAccounts(payload: unknown): TestPharmacyPreview[] {
  if (!payload || typeof payload !== 'object') return [];
  const accounts = (payload as TestPharmacyResponse).accounts;
  if (!Array.isArray(accounts)) return [];
  return accounts.filter(isTestPharmacyPreview);
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { loading, setLoading, error, setError } = useAsyncState();
  const [mode, setMode] = useState<LoginMode>('user');
  const [showTestPharmacyModal, setShowTestPharmacyModal] = useState(false);
  const [testPharmacyLoading, setTestPharmacyLoading] = useState(false);
  const [testPharmacyError, setTestPharmacyError] = useState('');
  const [testPharmacies, setTestPharmacies] = useState<TestPharmacyPreview[]>([]);
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

  const switchMode = (newMode: LoginMode) => {
    setMode(newMode);
    setError('');
    setEmail('');
    setPassword('');
  };

  const openTestPharmacyModal = async () => {
    if (testPharmacyLoading) return;
    setShowTestPharmacyModal(true);
    setTestPharmacyLoading(true);
    setTestPharmacyError('');
    try {
      const response = await api.get<TestPharmacyResponse>('/auth/test-pharmacies?includePassword=1');
      setTestPharmacies(parseTestPharmacyAccounts(response));
    } catch (err) {
      setTestPharmacies([]);
      setTestPharmacyError(err instanceof Error ? err.message : 'テスト薬局情報の取得に失敗しました');
    } finally {
      setTestPharmacyLoading(false);
    }
  };

  const applyTestPharmacy = (pharmacy: TestPharmacyPreview) => {
    setMode('user');
    setError('');
    setEmail(pharmacy.email);
    setPassword(pharmacy.password);
    setShowTestPharmacyModal(false);
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

          <section className="dl-demo-shortcuts" aria-label="テスト薬局情報">
            <h3 className="dl-demo-title">テスト薬局情報</h3>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm w-100"
              onClick={() => {
                void openTestPharmacyModal();
              }}
              disabled={loading || testPharmacyLoading}
            >
              {testPharmacyLoading ? '読込中...' : '登録済みテスト薬局を表示'}
            </button>
            <p className="dl-demo-hint">
              DB登録済みのテスト薬局を表示します。選択するとメールアドレス/パスワード欄へ反映されます。
            </p>
          </section>

          <AppModalShell
            show={showTestPharmacyModal}
            onHide={() => setShowTestPharmacyModal(false)}
            title="登録済みテスト薬局"
            size="lg"
          >
            {testPharmacyLoading && <p className="text-center mb-0 py-3">テスト薬局情報を読み込み中です...</p>}
            {testPharmacyError && <StatusAlert variant="danger" message={testPharmacyError} />}
            {!testPharmacyLoading && !testPharmacyError && testPharmacies.length === 0 && (
              <p className="text-muted mb-0">表示できるテスト薬局が見つかりませんでした。</p>
            )}
            {!testPharmacyLoading && !testPharmacyError && testPharmacies.length > 0 && (
              <AppResponsiveSwitch
                desktop={(
                  <div className="dl-test-pharmacy-modal">
                    <table className="table table-sm align-middle mb-0">
                      <thead>
                        <tr>
                          <th scope="col">ID</th>
                          <th scope="col">薬局名</th>
                          <th scope="col">都道府県</th>
                          <th scope="col">ログインID</th>
                          <th scope="col">パスワード</th>
                          <th scope="col" className="text-end">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {testPharmacies.map((pharmacy) => (
                          <tr key={pharmacy.id}>
                            <td>{pharmacy.id}</td>
                            <td>{pharmacy.name}</td>
                            <td>{pharmacy.prefecture}</td>
                            <td className="dl-test-pharmacy-email">{pharmacy.email}</td>
                            <td><code>{pharmacy.password}</code></td>
                            <td className="text-end">
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                onClick={() => applyTestPharmacy(pharmacy)}
                              >
                                このID/パスワードを入力
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                mobile={(
                  <div className="dl-mobile-data-list">
                    {testPharmacies.map((pharmacy) => (
                      <AppMobileDataCard
                        key={pharmacy.id}
                        title={pharmacy.name}
                        subtitle={`ID: ${pharmacy.id}`}
                        fields={[
                          { label: '都道府県', value: pharmacy.prefecture },
                          { label: 'ログインID', value: <span className="dl-test-pharmacy-email">{pharmacy.email}</span> },
                          { label: 'パスワード', value: <code>{pharmacy.password}</code> },
                        ]}
                        actions={(
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            onClick={() => applyTestPharmacy(pharmacy)}
                          >
                            このID/パスワードを入力
                          </button>
                        )}
                      />
                    ))}
                  </div>
                )}
              />
            )}
          </AppModalShell>
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
