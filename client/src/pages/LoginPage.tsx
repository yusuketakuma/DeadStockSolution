import { useMemo, useState, FormEvent, KeyboardEvent } from 'react';
import { useAsyncState } from '../hooks/useAsyncState';
import { Form } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
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
  const raw = import.meta.env.VITE_TEST_LOGIN_FEATURE_ENABLED?.trim().toLowerCase();
  return raw !== 'false';
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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [showPassword, setShowPassword] = useState(false);
  const [capsLockOn, setCapsLockOn] = useState(false);
  const { loading, setLoading, error, setError } = useAsyncState();
  const [mode, setMode] = useState<LoginMode>('user');
  const [showTestPharmacyModal, setShowTestPharmacyModal] = useState(false);
  const [testPharmacyLoading, setTestPharmacyLoading] = useState(false);
  const [testPharmacyError, setTestPharmacyError] = useState('');
  const [testPharmacyQuery, setTestPharmacyQuery] = useState('');
  const [appliedTestPharmacyMessage, setAppliedTestPharmacyMessage] = useState('');
  const [testPharmacies, setTestPharmacies] = useState<TestPharmacyPreview[]>([]);
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

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
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
      } else {
        navigate('/');
      }
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

  const switchMode = (newMode: LoginMode) => {
    setMode(newMode);
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
      const message = err instanceof Error ? err.message : 'テスト薬局情報の取得に失敗しました';
      setTestPharmacyError(message);
      return [];
    } finally {
      setTestPharmacyLoading(false);
    }
  };

  const openTestPharmacyModal = async (forceRefresh = false) => {
    if (!testLoginFeatureEnabled) return;
    if (testPharmacyLoading) return;
    setShowTestPharmacyModal(true);
    setTestPharmacyError('');
    setTestPharmacyQuery('');
    if (!forceRefresh && testPharmacies.length > 0) return;
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

  const applyRandomTestPharmacy = async () => {
    if (!testLoginFeatureEnabled) return;
    if (testPharmacyLoading || loading) return;
    setError('');
    setAppliedTestPharmacyMessage('');
    const accounts = await fetchTestPharmacies(false);
    if (accounts.length === 0) {
      setError('お試しアカウントを取得できませんでした。');
      return;
    }
    const randomIndex = Math.floor(Math.random() * accounts.length);
    applyTestPharmacy(accounts[randomIndex]);
  };

  const clearLoginFields = () => {
    setEmail('');
    setPassword('');
    setFieldErrors({});
    setError('');
    setAppliedTestPharmacyMessage('');
    setCapsLockOn(false);
    setShowPassword(false);
  };

  const handleEmailChange = (value: string) => {
    setEmail(value);
    if (fieldErrors.email) {
      setFieldErrors((prev) => ({ ...prev, email: undefined }));
    }
  };

  const handlePasswordChange = (value: string) => {
    setPassword(value);
    if (fieldErrors.password) {
      setFieldErrors((prev) => ({ ...prev, password: undefined }));
    }
  };

  const handlePasswordKeyUp = (event: KeyboardEvent<HTMLInputElement>) => {
    setCapsLockOn(event.getModifierState('CapsLock'));
  };

  const passwordDescribedBy = [
    'login-password-help',
    fieldErrors.password ? 'login-password-error' : undefined,
    capsLockOn ? 'login-password-caps-lock' : undefined,
  ].filter(Boolean).join(' ');

  const normalizedEmail = email.trim();
  const hasEmailInput = normalizedEmail.length > 0;
  const hasPasswordInput = password.length > 0;
  const isEmailFormatValid = hasEmailInput && EMAIL_PATTERN.test(normalizedEmail);
  const readinessItems = [
    { label: 'メールアドレス入力', done: hasEmailInput },
    { label: 'パスワード入力', done: hasPasswordInput },
    { label: 'ログイン実行可能', done: hasEmailInput && hasPasswordInput && isEmailFormatValid },
  ];
  const readinessCompleted = readinessItems.filter((item) => item.done).length;
  const readinessPercent = Math.round((readinessCompleted / readinessItems.length) * 100);
  const readinessScale = Math.min(Math.max(readinessPercent / 100, 0), 1);
  const showcaseItems = useMemo(() => (
    mode === 'admin'
      ? [
        {
          label: 'CONTROL',
          title: '監査ログに即時アクセス',
          description: '運用監視・承認ワークフローを管理画面から一元管理できます。',
        },
        {
          label: 'SECURITY',
          title: '権限分離を前提に設計',
          description: '管理者専用導線と業務ユーザー導線を明確に分離しています。',
        },
        {
          label: 'RESPONSE',
          title: '障害時の復旧を高速化',
          description: 'ログ確認とパスワード再設定導線を同一画面で案内します。',
        },
      ]
      : [
        {
          label: 'MATCHING',
          title: '在庫交換をすばやく開始',
          description: 'ログイン後すぐにデッドストック照合と提案確認を行えます。',
        },
        {
          label: 'TRUST',
          title: '業務運用に合わせた安全設計',
          description: '共用端末運用や入力ミス防止のガイドをログイン前に提示します。',
        },
        {
          label: 'TRY IT',
          title: 'お試しアカウントで体験',
          description: 'テストアカウントを選ぶだけで、ログイン情報をワンクリック入力できます。',
        },
      ]
  ), [mode]);
  const modeCards = useMemo(() => ([
    {
      key: 'user' as const,
      title: '薬局ログイン',
      badge: 'Primary Flow',
      description: 'アップロード、照合、交換提案の確認まで最短で進めます。',
      hint: testLoginFeatureEnabled ? 'お試しアカウント導線を利用できます。' : '登録済みアカウントで続行します。',
    },
    {
      key: 'admin' as const,
      title: '管理者ログイン',
      badge: 'Operations',
      description: '審査、監査、運用判断に必要な情報へ直接アクセスします。',
      hint: '権限のないアカウントでは管理画面に入れません。',
    },
  ]), [testLoginFeatureEnabled]);
  const supportChecklist = useMemo(() => (
    mode === 'admin'
      ? [
        '監査ログと審査フローを確認する担当者向けの導線です。',
        '一般薬局アカウントで入った場合は自動で拒否されます。',
        '異常時はパスワード再設定後に再ログインしてください。',
      ]
      : [
        'メールアドレスとパスワードだけでログインできます。',
        '入力に迷う場合は下の補助導線から復旧できます。',
        testLoginFeatureEnabled
          ? 'お試しアカウントを使うと画面操作をすぐ確認できます。'
          : 'テストログインはこの環境では無効です。',
      ]
  ), [mode, testLoginFeatureEnabled]);
  const afterLoginItems = useMemo(() => (
    mode === 'admin'
      ? [
        '審査待ち薬局の確認',
        'ログ監視と障害切り分け',
        '運用設定と通知確認',
      ]
      : [
        '在庫アップロード',
        'マッチング候補の確認',
        '交換提案と通知の確認',
      ]
  ), [mode]);
  const isUserMode = mode === 'user';

  return (
    <AuthPageLayout
      footerNote="本システムは業務補助ツールです。入力内容は確認のうえ運用してください。"
      main={(
        <>
          <header className="dl-login-header">
            <div className="dl-login-hero">
              <div className="dl-login-hero-copy">
                <p className="dl-login-kicker">Dead stock exchange control desk</p>
                <div className="dl-brand-row">
                  <h1>薬局デッドストック交換システム</h1>
                  <span className="dl-version-chip">{APP_VERSION}</span>
                </div>
                <p className="dl-lead">
                  ログイン前に入口を明確化し、入力ミスや迷いを減らすために導線を再設計しています。
                  よく使う入口を上に、復旧導線を近く、運用メモは右側へ分離しました。
                </p>
              </div>
              <section className="dl-login-entry-grid" aria-label="ログイン入口の選択">
                {modeCards.map((item) => {
                  const active = item.key === mode;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      className={`dl-login-entry-card${active ? ' is-active' : ''}`}
                      onClick={() => switchMode(item.key)}
                      aria-pressed={active}
                    >
                      <div className="dl-login-entry-head">
                        <span className="dl-login-entry-badge">{item.badge}</span>
                        <span className="dl-login-entry-state">{active ? '選択中' : '切替'}</span>
                      </div>
                      <h3 className="dl-login-entry-title">{item.title}</h3>
                      <p className="dl-login-entry-text">{item.description}</p>
                      <p className="dl-login-entry-hint">{item.hint}</p>
                    </button>
                  );
                })}
              </section>
            </div>
            <section className="dl-login-showcase" aria-label="ログイン画面の特長">
              <div className="dl-login-showcase-head">
                <p className="dl-login-showcase-lead">
                  {mode === 'admin'
                    ? '管理画面へ進む前に、権限と目的が一致しているかをひと目で確認できます。'
                    : '通常業務のログインに必要な情報を一つの視線で把握できる構成です。'}
                </p>
                <span className="dl-login-showcase-mode">{mode === 'admin' ? 'Admin Route' : 'User Route'}</span>
              </div>
              <div className="dl-login-showcase-grid">
                {showcaseItems.map((item) => (
                  <article key={item.label} className="dl-login-showcase-card">
                    <p className="dl-login-showcase-label">{item.label}</p>
                    <h3 className="dl-login-showcase-title">{item.title}</h3>
                    <p className="dl-login-showcase-text">{item.description}</p>
                  </article>
                ))}
              </div>
            </section>
          </header>

          <div className="dl-login-stage">
            <section className="dl-login-panel" aria-label="ログインフォーム">
              <div className="dl-login-panel-head">
                <div>
                  <p className="dl-login-panel-step">Sign-in workspace</p>
                  <h2 className="h5 mt-0 mb-2">
                    {mode === 'admin' ? '管理者ログイン' : 'ログイン'}
                  </h2>
                  <p className="dl-mode-caption">
                    {mode === 'admin'
                      ? '運用管理者向けの管理画面にアクセスします。'
                      : '登録済みのメールアドレスとパスワードで続行します。'}
                  </p>
                </div>
                <div className="dl-login-panel-status" aria-label="入力準備ステータス">
                  <span className="dl-login-panel-status-label">入力準備ステータス</span>
                  <strong>{readinessPercent}%</strong>
                </div>
              </div>

              {error && <AppAlert variant="danger" className="dl-status-alert">{error}</AppAlert>}
              {appliedTestPharmacyMessage && <AppAlert variant="success" className="dl-status-alert">{appliedTestPharmacyMessage}</AppAlert>}

              <section className="dl-login-readiness" aria-label="入力準備ステータス" aria-live="polite">
                <div className="dl-login-readiness-head">
                  <p className="dl-login-readiness-title mb-0">入力の進み具合</p>
                  <span className="dl-login-readiness-rate">{readinessPercent}%</span>
                </div>
                <div className="dl-login-readiness-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={readinessPercent}>
                  <span className="dl-login-readiness-fill" style={{ transform: `scaleX(${readinessScale})` }} />
                </div>
                <ul className="dl-login-readiness-list">
                  {readinessItems.map((item) => (
                    <li key={item.label} className={item.done ? 'is-done' : ''}>
                      <span className="dl-login-readiness-dot" aria-hidden="true" />
                      {item.label}
                    </li>
                  ))}
                </ul>
              </section>

              <form onSubmit={handleSubmit} className="dl-login-form">
                <AppField
                  className="mb-3"
                  controlId="login-email"
                  label="メールアドレス"
                  type="email"
                  value={email}
                  onChange={(value) => handleEmailChange(value)}
                  autoComplete="username"
                  inputMode="email"
                  enterKeyHint="next"
                  required
                  disabled={loading}
                  placeholder="登録済みメールアドレス"
                  isInvalid={!!fieldErrors.email}
                  errorText={fieldErrors.email}
                  helpText="連絡先として登録したメールアドレスを入力してください。"
                />
                <Form.Group className="mb-3">
                  <div className="dl-password-row">
                    <Form.Label htmlFor="login-password">パスワード</Form.Label>
                    <span className="dl-password-row-note">Caps Lock と前後スペースに注意</span>
                  </div>
                  <div className="input-group">
                    <Form.Control
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      autoComplete="current-password"
                      enterKeyHint="go"
                      required
                      disabled={loading}
                      isInvalid={!!fieldErrors.password}
                      aria-describedby={passwordDescribedBy || undefined}
                      onChange={(event) => handlePasswordChange(event.target.value)}
                      onKeyUp={handlePasswordKeyUp}
                    />
                    <button
                      type="button"
                      className="btn btn-outline-secondary dl-password-toggle"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? 'パスワードを非表示' : 'パスワードを表示'}
                      disabled={loading}
                    >
                      {showPassword ? '非表示' : '表示'}
                    </button>
                  </div>
                  {fieldErrors.password && <div id="login-password-error" className="invalid-feedback d-block">{fieldErrors.password}</div>}
                  <Form.Text id="login-password-help" className="text-muted">
                    共用端末では入力後に周囲確認を行ってください。
                  </Form.Text>
                  {capsLockOn && (
                    <div id="login-password-caps-lock" className="dl-caps-lock-note" role="status">
                      Caps Lock が有効です。大文字入力に注意してください。
                    </div>
                  )}
                </Form.Group>
                <LoadingButton
                  type="submit"
                  variant={mode === 'admin' ? 'danger' : 'primary'}
                  className="w-100"
                  loading={loading}
                  loadingLabel="ログイン中..."
                >
                  {mode === 'admin' ? '管理者ログイン' : 'ログイン'}
                </LoadingButton>

                <div className="dl-login-quick-actions" role="group" aria-label="ログイン入力の操作">
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={clearLoginFields}
                    disabled={loading}
                  >
                    入力をクリア
                  </button>
                  {isUserMode && testLoginFeatureEnabled && (
                    <button
                      type="button"
                      className="btn btn-outline-primary btn-sm"
                      onClick={() => {
                        void applyRandomTestPharmacy();
                      }}
                      disabled={loading || testPharmacyLoading}
                    >
                      {testPharmacyLoading ? 'お試し読込中...' : 'ランダムでお試し入力'}
                    </button>
                  )}
                </div>
              </form>

              <div className="dl-login-links">
                <Link to="/password-reset">パスワードを忘れた方</Link>
                {isUserMode && <Link to="/register">新規登録はこちら</Link>}
              </div>
            </section>

            <section className="dl-login-support-panel" aria-label="ログイン補助">
              <article className="dl-support-card">
                <div className="dl-support-card-head">
                  <span className="dl-support-card-badge">Guidance</span>
                  <h3 className="h6 mb-0">この入口でできること</h3>
                </div>
                <ul className="dl-support-list">
                  {afterLoginItems.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>

              <article className="dl-support-card">
                <div className="dl-support-card-head">
                  <span className="dl-support-card-badge">Checklist</span>
                  <h3 className="h6 mb-0">ログイン前の確認</h3>
                </div>
                <ul className="dl-support-list">
                  {supportChecklist.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>

              {isUserMode && testLoginFeatureEnabled && (
                <article className="dl-support-card dl-support-card-emphasis" aria-label="お試しログイン">
                  <div className="dl-support-card-head">
                    <span className="dl-support-card-badge">Try It</span>
                    <h3 className="dl-demo-title mb-0">まずはお試しログイン</h3>
                  </div>
                  <p className="dl-demo-hint">
                    画面の流れを先に確認したい場合は、DB登録済みのテスト薬局からそのまま入力できます。
                  </p>
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm w-100"
                    onClick={() => {
                      void openTestPharmacyModal(false);
                    }}
                    disabled={loading || testPharmacyLoading}
                  >
                    {testPharmacyLoading ? '読込中...' : 'お試しアカウントを選ぶ'}
                  </button>
                  <p className="dl-demo-flow">
                    一覧でアカウントを選ぶと、メールアドレスとパスワードが自動入力されます。
                  </p>
                </article>
              )}

              <article className="dl-support-card">
                <div className="dl-support-card-head">
                  <span className="dl-support-card-badge">Recovery</span>
                  <h3 className="h6 mb-0">ログインできない場合</h3>
                </div>
                <ol className="dl-support-steps">
                  <li>メールアドレスの前後スペースがないか確認</li>
                  <li>Caps Lock の状態を確認</li>
                  <li>「パスワードを忘れた方」から再設定</li>
                </ol>
                {mode === 'admin' && (
                  <p className="text-muted small mb-0">
                    管理者アカウントでログインしてください。
                  </p>
                )}
              </article>
            </section>
          </div>

          <AppModalShell
            show={testLoginFeatureEnabled && showTestPharmacyModal}
            onHide={() => setShowTestPharmacyModal(false)}
            title="登録済みテスト薬局"
            size="lg"
          >
            {testPharmacyLoading && <p className="text-center mb-0 py-3">テスト薬局情報を読み込み中です...</p>}
            {!testPharmacyLoading && (
              <div className="dl-test-pharmacy-toolbar">
                <Form.Control
                  type="search"
                  size="sm"
                  value={testPharmacyQuery}
                  placeholder="薬局名・ログインID・都道府県で検索"
                  aria-label="テスト薬局を検索"
                  onChange={(event) => setTestPharmacyQuery(event.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm"
                  onClick={() => {
                    void openTestPharmacyModal(true);
                  }}
                  disabled={testPharmacyLoading}
                >
                  再読み込み
                </button>
              </div>
            )}
            {!testPharmacyLoading && !testPharmacyError && (
              <p className="dl-test-pharmacy-meta">
                {filteredTestPharmacies.length} / {testPharmacies.length} 件を表示
              </p>
            )}
            {testPharmacyError && <AppAlert variant="danger" className="dl-status-alert">{testPharmacyError}</AppAlert>}
            {!testPharmacyLoading && !testPharmacyError && filteredTestPharmacies.length === 0 && (
              <p className="text-muted mb-0">
                {testPharmacyQuery ? '検索条件に一致するテスト薬局が見つかりませんでした。' : '表示できるテスト薬局が見つかりませんでした。'}
              </p>
            )}
            {!testPharmacyLoading && !testPharmacyError && filteredTestPharmacies.length > 0 && (
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
                        {filteredTestPharmacies.map((pharmacy) => (
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
                    {filteredTestPharmacies.map((pharmacy) => (
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
        <section aria-label="運用上の確認事項" className="dl-aside-stack">
          <article className="dl-aside-card">
            <span className="dl-support-card-badge">Flow</span>
            <h3 className="h6 mb-3">ログイン後の進み方</h3>
            <ol className="dl-support-steps">
              <li>入口を選び、認証情報を入力</li>
              <li>{mode === 'admin' ? '管理画面' : '業務トップ'}へ遷移</li>
              <li>{mode === 'admin' ? '監査・審査・設定' : '在庫アップロードと提案確認'}を開始</li>
            </ol>
          </article>

          <article className="dl-aside-card">
            <span className="dl-support-card-badge">Safety</span>
            <h3 className="h6 mb-3">運用上の確認</h3>
            <ul className="dl-trust-list">
              <li>患者情報や薬歴情報はこの画面で入力しないでください。</li>
              <li>入力エラー時は内容を確認し、同じ操作を連続しないでください。</li>
              <li>管理者ログインは運用担当者のみ利用してください。</li>
              <li>共用端末では操作後に必ずログアウトしてください。</li>
            </ul>
          </article>
        </section>
      )}
    />
  );
}
