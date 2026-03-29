import { useMemo, useState, FormEvent, KeyboardEvent, type ChangeEvent } from 'react';
import { Form } from 'react-bootstrap';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAsyncState } from '../hooks/useAsyncState';
import { useAuth } from '../contexts/AuthContext';
import { api, ApiError } from '../api/client';
import AuthPageLayout from '../components/ui/AuthPageLayout';
import AppAlert from '../components/ui/AppAlert';
import LoadingButton from '../components/ui/LoadingButton';
import AppModalShell from '../components/ui/AppModalShell';
import AppResponsiveSwitch from '../components/ui/AppResponsiveSwitch';
import AppMobileDataCard from '../components/ui/AppMobileDataCard';
import AppTouchInput from '../components/common/AppTouchInput';
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

interface LoginFailureState {
  errorMessage: string;
  redirectPath?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEST_PHARMACY_ENDPOINT = '/auth/test-pharmacies';

function buildTestPharmacyPreviewUrl(mode: LoginMode): string {
  const params = new URLSearchParams({
    includePassword: 'true',
    mode,
  });
  return `${TEST_PHARMACY_ENDPOINT}?${params.toString()}`;
}

function isTestLoginFeatureEnabled(): boolean {
  return resolveClientTestLoginFeatureEnabled(import.meta.env as {
    readonly MODE?: string;
    readonly VITE_VERCEL_ENV?: string;
    readonly VITE_TEST_LOGIN_FEATURE_ENABLED?: string;
  });
}

function isTestPharmacyPreview(value: unknown): value is TestPharmacyPreview {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === 'number'
    && typeof candidate.name === 'string'
    && typeof candidate.email === 'string'
    && typeof candidate.prefecture === 'string';
}

function normalizeTestPharmacyPassword(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseTestPharmacyAccounts(payload: unknown): TestPharmacyPreview[] {
  if (!payload || typeof payload !== 'object') return [];
  const accounts = (payload as TestPharmacyResponse).accounts;
  if (!Array.isArray(accounts)) return [];
  return accounts
    .filter((item): item is TestPharmacyPreview & Record<string, unknown> => isTestPharmacyPreview(item))
    .map((item) => ({
      id: item.id,
      name: item.name,
      email: item.email,
      prefecture: item.prefecture,
      password: normalizeTestPharmacyPassword(item.password),
    }));
}

function matchesTestPharmacyQuery(pharmacy: TestPharmacyPreview, normalizedQuery: string): boolean {
  return pharmacy.name.toLowerCase().includes(normalizedQuery)
    || pharmacy.email.toLowerCase().includes(normalizedQuery)
    || pharmacy.prefecture.toLowerCase().includes(normalizedQuery)
    || String(pharmacy.id).includes(normalizedQuery);
}

function resolveLoginFailureState(err: unknown, normalizedEmail: string): LoginFailureState {
  if (err instanceof ApiError && err.status === 403) {
    const data = err.data as { verificationStatus?: string } | undefined;
    if (data?.verificationStatus === 'pending_verification') {
      return {
        errorMessage: '',
        redirectPath: `/verification-pending?email=${encodeURIComponent(normalizedEmail)}`,
      };
    }
    if (data?.verificationStatus === 'rejected') {
      return {
        errorMessage: 'アカウント申請が却下されました。詳細はメールをご確認ください。',
      };
    }
  }

  if (err instanceof ApiError && err.status === 401) {
    return {
      errorMessage: 'メールアドレスまたはパスワードが正しくありません',
    };
  }

  return {
    errorMessage: err instanceof Error ? err.message : 'ログインに失敗しました',
  };
}

function resolveCallbackError(errorParam: string | null): string {
  if (errorParam === 'auth_failed') return '認証に失敗しました。再度お試しください。';
  if (errorParam === 'inactive') return 'アカウントが無効です。';
  return '';
}

export default function LoginPage() {
  const testLoginFeatureEnabled = isTestLoginFeatureEnabled();
  const [searchParams] = useSearchParams();
  const callbackError = resolveCallbackError(searchParams.get('error'));
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
  const [showLegacyLogin, setShowLegacyLogin] = useState(false);
  const { loading, setLoading, error, setError } = useAsyncState();
  const { login, loginRedirect, logout } = useAuth();
  const navigate = useNavigate();

  const filteredTestPharmacies = useMemo(() => {
    const normalizedQuery = testPharmacyQuery.trim().toLowerCase();
    if (!normalizedQuery) return testPharmacies;
    return testPharmacies.filter((pharmacy) => matchesTestPharmacyQuery(pharmacy, normalizedQuery));
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
      const failureState = resolveLoginFailureState(err, normalizedEmail);
      if (failureState.redirectPath) {
        navigate(failureState.redirectPath);
        return;
      }
      setError(failureState.errorMessage);
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

  const fetchTestPharmacies = async (targetMode: LoginMode): Promise<TestPharmacyPreview[]> => {
    if (!testLoginFeatureEnabled) return [];
    setTestPharmacyLoading(true);
    try {
      const response = await api.get<TestPharmacyResponse>(buildTestPharmacyPreviewUrl(targetMode));
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
    const targetMode = mode;
    setShowTestPharmacyModal(true);
    setTestPharmacyError('');
    setTestPharmacyQuery('');
    await fetchTestPharmacies(targetMode);
  };

  const applyTestPharmacy = (pharmacy: TestPharmacyPreview, targetMode: LoginMode) => {
    setMode(targetMode);
    setError('');
    setFieldErrors({});
    setCapsLockOn(false);
    setShowLegacyLogin(true);
    setEmail(pharmacy.email);
    setPassword(pharmacy.password || '');
    setAppliedTestPharmacyMessage(
      pharmacy.password
        ? `${pharmacy.name} のメールアドレスとパスワードを入力しました。そのまま${targetMode === 'admin' ? '管理者' : ''}ログインできます。`
        : `${pharmacy.name} のメールアドレスを入力しました。パスワードは別途入力してください。`,
    );
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
                  <p className="text-uppercase text-muted small mb-1">ログイン</p>
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

              {callbackError && <AppAlert variant="danger" className="mb-3">{callbackError}</AppAlert>}
              {error && <AppAlert variant="danger" className="mb-3">{error}</AppAlert>}
              {appliedTestPharmacyMessage && <AppAlert variant="success" className="mb-3">{appliedTestPharmacyMessage}</AppAlert>}

              {/* WorkOS AuthKit ログインボタン */}
              {!isAdminMode && !showLegacyLogin && (
                <div className="mb-4">
                  <button
                    type="button"
                    className="btn btn-primary w-100 py-3"
                    onClick={loginRedirect}
                    disabled={loading}
                  >
                    ログイン / 新規登録
                  </button>
                  <div className="text-center mt-3">
                    <button
                      type="button"
                      className="btn btn-link btn-sm text-muted"
                      onClick={() => setShowLegacyLogin(true)}
                    >
                      メールアドレス・パスワードでログイン
                    </button>
                  </div>
                </div>
              )}

              {/* Legacy password login form */}
              {(isAdminMode || showLegacyLogin) && (
                <>
                  <form onSubmit={handleSubmit}>
                    <h2 className="h5 mb-3">{isAdminMode ? '管理者ログイン' : 'メール・パスワードログイン'}</h2>
                    <Form.Group className="mb-3" controlId="login-email">
                      <Form.Label>メールアドレス</Form.Label>
                      <AppTouchInput
                        type="email"
                        value={email}
                        onChange={(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setEmail(event.currentTarget.value)}
                        autoComplete="username"
                        inputMode="email"
                        enterKeyHint="next"
                        required
                        disabled={loading}
                        placeholder="登録済みメールアドレス"
                        isInvalid={!!fieldErrors.email}
                        aria-invalid={!!fieldErrors.email || undefined}
                        aria-describedby={fieldErrors.email ? 'login-email-error' : undefined}
                        autoFocus
                      />
                      {fieldErrors.email && <div id="login-email-error" className="invalid-feedback d-block">{fieldErrors.email}</div>}
                    </Form.Group>
                    <Form.Group className="mb-3">
                      <div className="d-flex align-items-center justify-content-between gap-2 mb-2">
                        <Form.Label htmlFor="login-password" className="mb-0">パスワード</Form.Label>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-secondary"
                          onClick={() => setShowPassword((prev) => !prev)}
                          disabled={loading}
                          aria-label={showPassword ? 'パスワードを非表示にする' : 'パスワードを表示する'}
                          style={{ minHeight: '44px', minWidth: '60px' }}
                        >
                          {showPassword ? '非表示' : '表示'}
                        </button>
                      </div>
                      <AppTouchInput
                        id="login-password"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        autoComplete="current-password"
                        enterKeyHint="go"
                        required
                        disabled={loading}
                        isInvalid={!!fieldErrors.password}
                        aria-invalid={!!fieldErrors.password || undefined}
                        aria-describedby={fieldErrors.password ? 'login-password-error' : undefined}
                        onChange={(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setPassword(event.currentTarget.value)}
                        onKeyUp={handlePasswordKeyUp}
                      />
                      {fieldErrors.password && <div id="login-password-error" className="invalid-feedback d-block">{fieldErrors.password}</div>}
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
                </>
              )}

              {testLoginFeatureEnabled && (
                <section className="border rounded-3 p-3 mt-4" aria-label="開発者ログイン">
                  <div className="mb-2">
                    <h3 className="h6 mb-1">開発者ログイン</h3>
                    <p className="text-muted small mb-0">
                      {isAdminMode
                        ? 'Playwright 検証用の管理者アカウントを入力して、管理画面の確認をすぐ始められます。'
                        : 'Playwright 検証用の一般ユーザーを入力して、業務画面の確認をすぐ始められます。'}
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
                      {isAdminMode ? '管理者一覧から選ぶ' : '一覧から選ぶ'}
                    </button>
                  </div>
                </section>
              )}
            </div>
          </div>

          <AppModalShell
            show={showTestPharmacyModal}
            onHide={() => setShowTestPharmacyModal(false)}
            title={isAdminMode ? '開発者ログイン（管理者）' : '開発者ログイン'}
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
              <p className="text-muted mb-0">
                {isAdminMode ? '表示できるテスト管理者アカウントがありません。' : '表示できるテスト薬局がありません。'}
              </p>
            ) : (
              <AppResponsiveSwitch
                desktop={(
                  <div className="table-responsive">
                    <table className="table align-middle mb-0">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>{isAdminMode ? 'アカウント名' : '薬局名'}</th>
                          <th>メールアドレス</th>
                          <th>都道府県</th>
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
                            <td className="text-end">
                              <button
                                type="button"
                                className="btn btn-sm btn-primary"
                                onClick={() => applyTestPharmacy(pharmacy, mode)}
                              >
                                {isAdminMode ? 'この管理者を入力' : 'このIDを入力'}
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
                        ]}
                        actions={(
                          <button
                            type="button"
                            className="btn btn-primary w-100"
                            onClick={() => applyTestPharmacy(pharmacy, mode)}
                          >
                            {isAdminMode ? 'この管理者を入力' : 'このIDを入力'}
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
