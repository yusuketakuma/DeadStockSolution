import { useMemo, useState, FormEvent, KeyboardEvent } from 'react';
import { Form } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import { useAsyncState } from '../hooks/useAsyncState';
import { useAuth } from '../contexts/AuthContext';
import { api, ApiError } from '../api/client';
import AuthPageLayout from '../components/ui/AuthPageLayout';
import AppAlert from '../components/ui/AppAlert';
import LoadingButton from '../components/ui/LoadingButton';
import AppField from '../components/ui/AppField';
import AppModalShell from '../components/ui/AppModalShell';
import AppResponsiveSwitch from '../components/ui/AppResponsiveSwitch';
import AppMobileDataCard from '../components/ui/AppMobileDataCard';
import { APP_VERSION } from '../constants/appVersion';
import { resolveClientTestLoginFeatureEnabled } from '../features/testLoginFeature';

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

interface LoginFieldErrors {
  email?: string;
  password?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEST_PHARMACY_ENDPOINT = '/auth/test-pharmacies?includePassword=1';

function isTestLoginFeatureEnabled(): boolean {
  return resolveClientTestLoginFeatureEnabled(import.meta.env as {
    readonly VITE_TEST_LOGIN_FEATURE_ENABLED?: string;
  });
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
  const testLoginFeatureEnabled = isTestLoginFeatureEnabled();
  const [mode, setMode] = useState<LoginMode>('user');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const [showTestPharmacyModal, setShowTestPharmacyModal] = useState(false);
  const [testPharmacyLoading, setTestPharmacyLoading] = useState(false);
  const [testPharmacyError, setTestPharmacyError] = useState('');
  const [testPharmacyQuery, setTestPharmacyQuery] = useState('');
  const [appliedTestPharmacyMessage, setAppliedTestPharmacyMessage] = useState('');
  const [testPharmacies, setTestPharmacies] = useState<TestPharmacyPreview[]>([]);
  const { loading, setLoading, error, setError } = useAsyncState();
  const { login, logout } = useAuth();
  const navigate = useNavigate();

  const filteredTestPharmacies = useMemo(() => {
    const normalizedQuery = testPharmacyQuery.trim().toLowerCase();
    if (!normalizedQuery) return testPharmacies;
    return testPharmacies.filter((pharmacy) => (
      pharmacy.name.toLowerCase().includes(normalizedQuery)
      || pharmacy.email.toLowerCase().includes(normalizedQuery)
      || pharmacy.prefecture.toLowerCase().includes(normalizedQuery)
      || String(pharmacy.id).includes(normalizedQuery)
    ));
  }, [testPharmacies, testPharmacyQuery]);

  const validateForm = (): boolean => {
    const nextErrors: LoginFieldErrors = {};
    const normalizedEmail = email.trim();

    if (!normalizedEmail) {
      nextErrors.email = 'メールアドレスを入力してください。';
    } else if (!EMAIL_PATTERN.test(normalizedEmail)) {
      nextErrors.email = 'メールアドレス形式で入力してください。';
    }

    if (!password) {
      nextErrors.password = 'パスワードを入力してください。';
    }

    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!validateForm()) {
      setError('');
      return;
    }

    const normalizedEmail = email.trim();
    setAppliedTestPharmacyMessage('');
    setError('');
    setLoading(true);
    try {
      const user = await login(normalizedEmail, password);
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
        return;
      }
      navigate('/');
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        const data = err.data as { verificationStatus?: string } | undefined;
        if (data?.verificationStatus === 'pending_verification') {
          navigate(`/verification-pending?email=${encodeURIComponent(normalizedEmail)}`);
          return;
        }
        if (data?.verificationStatus === 'rejected') {
          setError('アカウント申請が却下されました。詳細はメールをご確認ください。');
          return;
        }
      }
      if (err instanceof ApiError && err.status === 401) {
        setError('メールアドレスまたはパスワードが正しくありません');
        return;
      }
      setError(err instanceof Error ? err.message : 'ログインに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (nextMode: LoginMode) => {
    setMode(nextMode);
    setError('');
    setFieldErrors({});
    setCapsLockOn(false);
    setAppliedTestPharmacyMessage('');
  };

  const fetchTestPharmacies = async (forceRefresh = false): Promise<TestPharmacyPreview[]> => {
    if (!testLoginFeatureEnabled) return [];
    if (!forceRefresh && testPharmacies.length > 0) return testPharmacies;
    setTestPharmacyLoading(true);
    try {
      const response = await api.get<TestPharmacyResponse>(TEST_PHARMACY_ENDPOINT);
      const accounts = parseTestPharmacyAccounts(response);
      setTestPharmacies(accounts);
      setTestPharmacyError('');
      return accounts;
    } catch (err) {
      setTestPharmacies([]);
      setTestPharmacyError(err instanceof Error ? err.message : 'テスト薬局情報の取得に失敗しました');
      return [];
    } finally {
      setTestPharmacyLoading(false);
    }
  };

  const openTestPharmacyModal = async () => {
    if (!testLoginFeatureEnabled || testPharmacyLoading) return;
    setShowTestPharmacyModal(true);
    setTestPharmacyError('');
    setTestPharmacyQuery('');
    if (testPharmacies.length > 0) return;
    await fetchTestPharmacies(true);
  };

  const applyTestPharmacy = (pharmacy: TestPharmacyPreview) => {
    setMode('user');
    setError('');
    setFieldErrors({});
    setCapsLockOn(false);
    setEmail(pharmacy.email);
    setPassword(pharmacy.password);
    setAppliedTestPharmacyMessage(`${pharmacy.name} のログイン情報を入力しました。`);
    setShowTestPharmacyModal(false);
  };

  const handlePasswordKeyUp = (event: KeyboardEvent<HTMLInputElement>) => {
    setCapsLockOn(event.getModifierState('CapsLock'));
  };

  const isAdminMode = mode === 'admin';

  return (
    <AuthPageLayout
      footerNote="本システムは業務補助ツールです。入力内容は確認のうえ運用してください。"
      main={(
        <div className="mx-auto" style={{ maxWidth: '720px', width: '100%' }}>
          <div className="card shadow-sm border-0">
            <div className="card-body p-4 p-md-5">
              <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3">
                <div>
                  <p className="text-uppercase text-muted small mb-1">Sign in</p>
                  <h1 className="h3 mb-1">薬局デッドストック交換システム</h1>
                  <p className="text-muted mb-0">
                    登録済みアカウントでログインしてください。
                  </p>
                </div>
                <span className="badge text-bg-light border">{APP_VERSION}</span>
              </div>

              <div className="btn-group w-100 mb-4" role="group" aria-label="ログイン種別">
                <button
                  type="button"
                  className={`btn ${isAdminMode ? 'btn-outline-secondary' : 'btn-primary'}`}
                  onClick={() => switchMode('user')}
                  aria-pressed={!isAdminMode}
                >
                  通常ログイン
                </button>
                <button
                  type="button"
                  className={`btn ${isAdminMode ? 'btn-dark' : 'btn-outline-secondary'}`}
                  onClick={() => switchMode('admin')}
                  aria-pressed={isAdminMode}
                >
                  管理者ログイン
                </button>
              </div>

              {error && <AppAlert variant="danger" className="mb-3">{error}</AppAlert>}
              {appliedTestPharmacyMessage && <AppAlert variant="success" className="mb-3">{appliedTestPharmacyMessage}</AppAlert>}

              <form onSubmit={handleSubmit}>
                <h2 className="h5 mb-3">{isAdminMode ? '管理者ログイン' : 'ログイン'}</h2>
                <AppField
                  className="mb-3"
                  controlId="login-email"
                  label="メールアドレス"
                  type="email"
                  value={email}
                  onChange={setEmail}
                  autoComplete="username"
                  inputMode="email"
                  enterKeyHint="next"
                  required
                  disabled={loading}
                  placeholder="登録済みメールアドレス"
                  isInvalid={!!fieldErrors.email}
                  errorText={fieldErrors.email}
                />
                <Form.Group className="mb-3">
                  <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
                    <Form.Label htmlFor="login-password" className="mb-0">パスワード</Form.Label>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => setShowPassword((prev) => !prev)}
                      disabled={loading}
                      aria-label={showPassword ? 'パスワードを非表示にする' : 'パスワードを表示する'}
                    >
                      {showPassword ? '非表示' : '表示'}
                    </button>
                  </div>
                  <Form.Control
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    autoComplete="current-password"
                    enterKeyHint="go"
                    required
                    disabled={loading}
                    isInvalid={!!fieldErrors.password}
                    onChange={(event) => setPassword(event.target.value)}
                    onKeyUp={handlePasswordKeyUp}
                  />
                  {fieldErrors.password && <div className="invalid-feedback d-block">{fieldErrors.password}</div>}
                  {capsLockOn && (
                    <div className="form-text text-warning">
                      Caps Lock が有効です。大文字入力に注意してください。
                    </div>
                  )}
                </Form.Group>

                <LoadingButton
                  type="submit"
                  variant={isAdminMode ? 'dark' : 'primary'}
                  className="w-100"
                  loading={loading}
                  loadingLabel="ログイン中..."
                >
                  {isAdminMode ? '管理者ログイン' : 'ログイン'}
                </LoadingButton>
              </form>

              <div className="d-flex flex-wrap gap-3 mt-3">
                {!isAdminMode && (
                  <Link to="/register" className="small text-decoration-none">
                    新規登録はこちら
                  </Link>
                )}
                <span className="small text-muted">
                  {isAdminMode ? '管理者アカウントでログインしてください。' : '通常アカウントで業務画面に入ります。'}
                </span>
              </div>

              {!isAdminMode && testLoginFeatureEnabled && (
                <section className="border rounded-3 p-3 mt-4" aria-label="開発者ログイン">
                  <div className="mb-2">
                    <h3 className="h6 mb-1">開発者ログイン</h3>
                    <p className="text-muted small mb-0">
                      テスト薬局の ID とパスワードを転記して、動作確認をすぐ始められます。
                    </p>
                  </div>
                  <div className="d-flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn btn-outline-primary"
                      onClick={() => {
                        void openTestPharmacyModal();
                      }}
                      disabled={loading || testPharmacyLoading}
                    >
                      一覧から選ぶ
                    </button>
                  </div>
                </section>
              )}
            </div>
          </div>

          <AppModalShell
            show={showTestPharmacyModal}
            onHide={() => setShowTestPharmacyModal(false)}
            title="開発者ログイン"
            size="lg"
          >
            <div className="mb-3">
              <Form.Control
                type="search"
                placeholder="薬局名 / メールアドレス / 都道府県 / ID で絞り込み"
                value={testPharmacyQuery}
                onChange={(event) => setTestPharmacyQuery(event.target.value)}
              />
            </div>
            {testPharmacyError && <AppAlert variant="danger">{testPharmacyError}</AppAlert>}
            {testPharmacyLoading ? (
              <p className="text-muted mb-0">読み込み中...</p>
            ) : filteredTestPharmacies.length === 0 ? (
              <p className="text-muted mb-0">表示できるテスト薬局がありません。</p>
            ) : (
              <AppResponsiveSwitch
                desktop={(
                  <div className="table-responsive">
                    <table className="table align-middle mb-0">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>薬局名</th>
                          <th>メールアドレス</th>
                          <th>都道府県</th>
                          <th>パスワード</th>
                          <th className="text-end">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredTestPharmacies.map((pharmacy) => (
                          <tr key={pharmacy.id}>
                            <td>{pharmacy.id}</td>
                            <td>{pharmacy.name}</td>
                            <td>{pharmacy.email}</td>
                            <td>{pharmacy.prefecture}</td>
                            <td>{pharmacy.password}</td>
                            <td className="text-end">
                              <button
                                type="button"
                                className="btn btn-sm btn-primary"
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
                  <div className="d-grid gap-3">
                    {filteredTestPharmacies.map((pharmacy) => (
                      <AppMobileDataCard
                        key={pharmacy.id}
                        title={pharmacy.name}
                        subtitle={pharmacy.email}
                        fields={[
                          { label: 'ID', value: pharmacy.id },
                          { label: '都道府県', value: pharmacy.prefecture },
                          { label: 'パスワード', value: pharmacy.password },
                        ]}
                        actions={(
                          <button
                            type="button"
                            className="btn btn-primary w-100"
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
        </div>
      )}
    />
  );
}
