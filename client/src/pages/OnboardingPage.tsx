import { useEffect, useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, type FieldError } from '../api/client';
import AuthPageLayout from '../components/ui/AuthPageLayout';
import AppAlert from '../components/ui/AppAlert';
import { useAsyncState } from '../hooks/useAsyncState';
import OnboardingProgressBar from '../components/onboarding/OnboardingProgressBar';
import OnboardingStep1 from '../components/onboarding/OnboardingStep1';
import OnboardingStep2 from '../components/onboarding/OnboardingStep2';
import OnboardingStep3 from '../components/onboarding/OnboardingStep3';

interface OnboardingForm {
  name: string;
  postalCode: string;
  address: string;
  phone: string;
  fax: string;
  licenseNumber: string;
  permitLicenseNumber: string;
  permitPharmacyName: string;
  permitAddress: string;
  prefecture: string;
}

const TOTAL_STEPS = 3;

export default function OnboardingPage() {
  const [form, setForm] = useState<OnboardingForm>({
    name: '', postalCode: '', address: '',
    phone: '', fax: '', licenseNumber: '', permitLicenseNumber: '',
    permitPharmacyName: '', permitAddress: '', prefecture: '',
  });
  const [agreed, setAgreed] = useState(false);
  const { loading, setLoading, error, setError } = useAsyncState();
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [workosInfo, setWorkosInfo] = useState<{ workosUserId: string; email: string } | null>(null);
  const [infoLoading, setInfoLoading] = useState(true);
  const [step, setStep] = useState(1);
  const navigate = useNavigate();

  // onboarding ページロード時に onboarding トークンから WorkOS 情報を取得
  useEffect(() => {
    api.get<{ email: string; workosUserId: string }>('/auth/onboarding-info')
      .then((data) => {
        if (data.email && data.workosUserId) {
          setWorkosInfo({ workosUserId: data.workosUserId, email: data.email });
        } else {
          navigate('/login');
        }
      })
      .catch(() => {
        navigate('/login');
      })
      .finally(() => setInfoLoading(false));
  }, [navigate]);

  const handleChange = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => prev.filter((fe) => fe.field !== field));
  };

  const handleSubmit = async () => {
    if (!agreed || !workosInfo) {
      setError('免責事項に同意してください');
      return;
    }
    setError('');
    setFieldErrors([]);
    setLoading(true);
    try {
      // workosUserId/email はサーバー側で onboarding cookie から取得（C2修正）
      await api.post('/auth/complete-registration', form);
      navigate(`/verification-pending?email=${encodeURIComponent(workosInfo.email)}`);
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors && err.fieldErrors.length > 0) {
        setFieldErrors(err.fieldErrors);
        setError('入力内容にエラーがあります。各項目を確認してください。');
        // フィールドエラーがどのステップに属するか判定してステップを戻す
        const step1Fields = ['name', 'postalCode', 'address', 'phone', 'fax', 'prefecture'];
        const step2Fields = ['licenseNumber', 'permitLicenseNumber', 'permitPharmacyName', 'permitAddress'];
        const hasStep1Error = err.fieldErrors.some((fe) => step1Fields.includes(fe.field));
        const hasStep2Error = err.fieldErrors.some((fe) => step2Fields.includes(fe.field));
        if (hasStep1Error) {
          setStep(1);
        } else if (hasStep2Error) {
          setStep(2);
        }
      } else {
        setError(err instanceof Error ? err.message : '登録に失敗しました');
      }
    } finally {
      setLoading(false);
    }
  };

  // form の onSubmit は Step3 の submit ボタン経由で呼ばれるが、
  // Enter キーによる意図しない送信を防ぐためフォームタグで wrap しない
  const handleFormSubmit = (e: FormEvent) => {
    e.preventDefault();
  };

  if (infoLoading) {
    return (
      <div className="d-flex flex-column align-items-center justify-content-center vh-100">
        <div className="spinner-border text-primary mb-3" role="status">
          <span className="visually-hidden">読み込み中...</span>
        </div>
      </div>
    );
  }

  return (
    <AuthPageLayout
      footerNote="登録情報は薬局運用の識別に使用されます。最新情報を維持してください。"
      main={(
        <>
          <h1 className="h4 text-center mb-2">薬局情報登録</h1>
          <p className="dl-lead text-center">
            認証が完了しました。薬局情報を入力して登録を完了してください。
          </p>
          {workosInfo?.email && (
            <AppAlert variant="info" className="mb-3">
              {workosInfo.email} で認証済みです
            </AppAlert>
          )}

          <OnboardingProgressBar currentStep={step} totalSteps={TOTAL_STEPS} />

          {error && <AppAlert variant="danger" className="dl-status-alert mb-3">{error}</AppAlert>}

          <form onSubmit={handleFormSubmit} noValidate>
            {step === 1 && (
              <OnboardingStep1
                formData={form}
                onChange={handleChange}
                onNext={() => setStep(2)}
                fieldErrors={fieldErrors}
              />
            )}
            {step === 2 && (
              <OnboardingStep2
                formData={form}
                onChange={handleChange}
                onNext={() => setStep(3)}
                onBack={() => setStep(1)}
                fieldErrors={fieldErrors}
              />
            )}
            {step === 3 && (
              <OnboardingStep3
                formData={form}
                agreed={agreed}
                onAgreeChange={setAgreed}
                onSubmit={handleSubmit}
                onBack={() => setStep(2)}
                loading={loading}
              />
            )}
          </form>
        </>
      )}
      aside={(
        <section aria-label="登録時の留意事項">
          <h2 className="h6 mb-3">登録時の留意事項</h2>
          <ul className="dl-trust-list">
            <li>住所は位置情報推定に使われるため、省略せず入力してください。</li>
            <li>許可番号は照合のため正確な表記で入力してください。</li>
            <li>許可証記載の薬局名・所在地・許可番号は証票どおり入力してください。</li>
          </ul>
        </section>
      )}
    />
  );
}
