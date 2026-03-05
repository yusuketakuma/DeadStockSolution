import { useState, useEffect, FormEvent } from 'react';
import AppButton from '../components/ui/AppButton';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import AuthPageLayout from '../components/ui/AuthPageLayout';
import AppAlert from '../components/ui/AppAlert';
import LoadingButton from '../components/ui/LoadingButton';
import AppField from '../components/ui/AppField';

const PASSWORD_ALPHA_PATTERN = /[a-zA-Z]/;
const PASSWORD_DIGIT_PATTERN = /\d/;

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
      const data = await api.post<{ message: string }>('/auth/password-reset/request', { email });
      setSuccess(data.message);
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
    if (!PASSWORD_ALPHA_PATTERN.test(newPassword)) {
      setError('パスワードにはアルファベットを含めてください');
      return;
    }
    if (!PASSWORD_DIGIT_PATTERN.test(newPassword)) {
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
    <AuthPageLayout
      footerNote="本人確認のため、リセットトークンは第三者に共有しないでください。"
      main={(
        <>
          <h1 className="h4 text-center mb-2">パスワードリセット</h1>
          <p className="dl-lead text-center">登録メールアドレス宛のトークンで再設定できます。</p>

          {error && <AppAlert variant="danger" className="dl-status-alert">{error}</AppAlert>}
          {success && <AppAlert variant="success" className="dl-status-alert">{success}</AppAlert>}

          {step === 'request' && (
            <form onSubmit={handleRequest}>
              <AppField
                className="mb-3"
                controlId="password-reset-email"
                label="メールアドレス"
                type="email"
                value={email}
                onChange={(value) => setEmail(value)}
                autoComplete="email"
                inputMode="email"
                enterKeyHint="send"
                required
                placeholder="登録済みのメールアドレス"
              />
              <LoadingButton
                type="submit"
                variant="primary"
                className="w-100"
                loading={loading}
                loadingLabel="送信中..."
              >
                リセットリンクを送信
              </LoadingButton>
              <div className="dl-link-row">
                <span className="text-muted small me-2">トークンをお持ちの場合</span>
                <AppButton variant="link" size="sm" onClick={() => setStep('confirm')}>
                  パスワード再設定へ
                </AppButton>
              </div>
            </form>
          )}

          {step === 'confirm' && (
            <form onSubmit={handleConfirm}>
              <AppField
                className="mb-3"
                controlId="password-reset-token"
                label="リセットトークン"
                type="text"
                value={token}
                onChange={(value) => setToken(value)}
                autoComplete="one-time-code"
                enterKeyHint="next"
                required
                placeholder="メールに記載のトークン"
              />
              <AppField
                className="mb-3"
                controlId="password-reset-new-password"
                label="新しいパスワード"
                type="password"
                value={newPassword}
                onChange={(value) => setNewPassword(value)}
                autoComplete="new-password"
                enterKeyHint="next"
                required
                minLength={8}
                placeholder="英字+数字を含む8文字以上"
              />
              <AppField
                className="mb-3"
                controlId="password-reset-confirm-password"
                label="新しいパスワード（確認）"
                type="password"
                value={confirmPassword}
                onChange={(value) => setConfirmPassword(value)}
                autoComplete="new-password"
                enterKeyHint="done"
                required
                minLength={8}
              />
              <LoadingButton
                type="submit"
                variant="primary"
                className="w-100"
                loading={loading}
                loadingLabel="再設定中..."
              >
                パスワードを再設定
              </LoadingButton>
              <div className="dl-link-row">
                <AppButton variant="link" size="sm" onClick={() => { setStep('request'); setError(''); setSuccess(''); }}>
                  メールアドレス入力に戻る
                </AppButton>
              </div>
            </form>
          )}

          <div className="dl-link-row">
            <Link to="/login">ログインに戻る</Link>
          </div>
        </>
      )}
      aside={(
        <section aria-label="再設定時の注意">
          <h2 className="h6 mb-3">再設定時の注意</h2>
          <ul className="dl-trust-list">
            <li>トークンは短時間で失効します。受信後は早めに再設定してください。</li>
            <li>英字と数字を含む推測されにくいパスワードを設定してください。</li>
            <li>再設定後、他端末でのログイン状態を確認してください。</li>
          </ul>
        </section>
      )}
    />
  );
}
