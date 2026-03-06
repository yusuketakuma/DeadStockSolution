import { useMemo, useState, FormEvent } from 'react';
import { Row, Col } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ApiError, type FieldError } from '../api/client';
import AuthPageLayout from '../components/ui/AuthPageLayout';
import AppAlert from '../components/ui/AppAlert';
import AppSelect from '../components/ui/AppSelect';
import LoadingButton from '../components/ui/LoadingButton';
import AppField from '../components/ui/AppField';
import { useAsyncState } from '../hooks/useAsyncState';

interface RegisterForm {
  email: string;
  password: string;
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

const PREFECTURES = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県',
  '岐阜県', '静岡県', '愛知県', '三重県',
  '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
  '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県',
  '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
];
const PREFECTURE_OPTIONS = PREFECTURES.map((pref) => ({ value: pref, label: pref }));

export default function RegisterPage() {
  const [form, setForm] = useState<RegisterForm>({
    email: '', password: '', name: '', postalCode: '', address: '',
    phone: '', fax: '', licenseNumber: '', permitLicenseNumber: '',
    permitPharmacyName: '', permitAddress: '', prefecture: '',
  });
  const [agreed, setAgreed] = useState(false);
  const { loading, setLoading, error, setError } = useAsyncState();
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const { register } = useAuth();
  const navigate = useNavigate();

  const handleChange = (field: keyof RegisterForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => prev.filter((fe) => fe.field !== field));
  };

  const fieldErrorMap = useMemo(() => (
    new Map(fieldErrors.map((fieldError) => [fieldError.field, fieldError.message]))
  ), [fieldErrors]);

  const getFieldError = (field: string): string | undefined => fieldErrorMap.get(field);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!agreed) {
      setError('免責事項に同意してください');
      return;
    }
    setError('');
    setFieldErrors([]);
    setLoading(true);
    try {
      await register(form);
      navigate(`/verification-pending?email=${encodeURIComponent(form.email)}`);
      return;
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors && err.fieldErrors.length > 0) {
        setFieldErrors(err.fieldErrors);
        setError('入力内容にエラーがあります。各項目を確認してください。');
      } else {
        setError(err instanceof Error ? err.message : '登録に失敗しました');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthPageLayout
      footerNote="登録情報は薬局運用の識別に使用されます。最新情報を維持してください。"
      main={(
        <>
          <h1 className="h4 text-center mb-2">新規薬局登録</h1>
          <p className="dl-lead text-center">登録情報は薬局開設許可証の記載内容と自動照合されます。</p>
          {error && <AppAlert variant="danger" className="dl-status-alert">{error}</AppAlert>}
          <form onSubmit={handleSubmit}>
            <AppField
              className="mb-3"
              controlId="register-email"
              label="メールアドレス *"
              type="email"
              value={form.email}
              onChange={(value) => handleChange('email', value)}
              required
              isInvalid={!!getFieldError('email')}
              errorText={getFieldError('email')}
            />

            <AppField
              className="mb-3"
              controlId="register-password"
              label="パスワード *"
              type="password"
              value={form.password}
              onChange={(value) => handleChange('password', value)}
              required
              minLength={8}
              isInvalid={!!getFieldError('password')}
              errorText={getFieldError('password')}
              helpText={!getFieldError('password') ? '8文字以上' : undefined}
            />

            <AppField
              className="mb-3"
              controlId="register-name"
              label="薬局名 *"
              type="text"
              value={form.name}
              onChange={(value) => handleChange('name', value)}
              required
              isInvalid={!!getFieldError('name')}
              errorText={getFieldError('name')}
            />

            <AppField
              className="mb-3"
              controlId="register-license-number"
              label="薬局開設許可番号 *"
              type="text"
              value={form.licenseNumber}
              onChange={(value) => handleChange('licenseNumber', value)}
              required
              isInvalid={!!getFieldError('licenseNumber')}
              errorText={getFieldError('licenseNumber')}
            />

            <AppField
              className="mb-3"
              controlId="register-permit-license-number"
              label="許可証記載の許可番号 *"
              type="text"
              value={form.permitLicenseNumber}
              onChange={(value) => handleChange('permitLicenseNumber', value)}
              required
              isInvalid={!!getFieldError('permitLicenseNumber')}
              errorText={getFieldError('permitLicenseNumber')}
            />

            <AppField
              className="mb-3"
              controlId="register-permit-pharmacy-name"
              label="許可証記載の薬局名 *"
              type="text"
              value={form.permitPharmacyName}
              onChange={(value) => handleChange('permitPharmacyName', value)}
              required
              isInvalid={!!getFieldError('permitPharmacyName')}
              errorText={getFieldError('permitPharmacyName')}
            />

            <AppField
              className="mb-3"
              controlId="register-permit-address"
              label="許可証記載の所在地 *"
              type="text"
              value={form.permitAddress}
              onChange={(value) => handleChange('permitAddress', value)}
              required
              isInvalid={!!getFieldError('permitAddress')}
              errorText={getFieldError('permitAddress')}
              placeholder="許可証に記載されている所在地"
            />

            <Row>
              <Col md={6}>
                <AppSelect
                  className="mb-3"
                  controlId="register-prefecture"
                  label="都道府県 *"
                  value={form.prefecture}
                  onChange={(value) => {
                    handleChange('prefecture', value);
                  }}
                  required
                  isInvalid={!!getFieldError('prefecture')}
                  errorText={getFieldError('prefecture')}
                  placeholder="選択してください"
                  options={PREFECTURE_OPTIONS}
                />
              </Col>
              <Col md={6}>
                <AppField
                  className="mb-3"
                  controlId="register-postal-code"
                  label="郵便番号 *"
                  type="text"
                  value={form.postalCode}
                  onChange={(value) => handleChange('postalCode', value)}
                  placeholder="1234567"
                  required
                  isInvalid={!!getFieldError('postalCode')}
                  errorText={getFieldError('postalCode')}
                />
              </Col>
            </Row>

            <AppField
              className="mb-3"
              controlId="register-address"
              label="住所 *"
              type="text"
              value={form.address}
              onChange={(value) => handleChange('address', value)}
              required
              isInvalid={!!getFieldError('address')}
              errorText={getFieldError('address')}
              placeholder="市区町村以降の住所"
              helpText={!getFieldError('address') ? '位置情報の特定に使用します。正確な住所を入力してください' : undefined}
            />

            <Row>
              <Col md={6}>
                <AppField
                  className="mb-3"
                  controlId="register-phone"
                  label="電話番号 *"
                  type="tel"
                  value={form.phone}
                  onChange={(value) => handleChange('phone', value)}
                  required
                  isInvalid={!!getFieldError('phone')}
                  errorText={getFieldError('phone')}
                />
              </Col>
              <Col md={6}>
                <AppField
                  className="mb-3"
                  controlId="register-fax"
                  label="FAX番号 *"
                  type="tel"
                  value={form.fax}
                  onChange={(value) => handleChange('fax', value)}
                  required
                  isInvalid={!!getFieldError('fax')}
                  errorText={getFieldError('fax')}
                />
              </Col>
            </Row>

            <div className="form-check mb-3">
              <input
                type="checkbox"
                className="form-check-input"
                id="register-agreed"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
              />
              <label className="form-check-label" htmlFor="register-agreed">
                本システムはあくまで業務補助ツールであり、医薬品の交換に関する一切の責任を負わないことに同意します
              </label>
            </div>

            <LoadingButton
              type="submit"
              variant="primary"
              className="w-100"
              disabled={!agreed}
              loading={loading}
              loadingLabel="登録中..."
            >
              登録
            </LoadingButton>
          </form>
          <div className="dl-link-row">
            <Link to="/login">ログインはこちら</Link>
          </div>
        </>
      )}
      aside={(
        <section aria-label="登録時の留意事項">
          <h2 className="h6 mb-3">登録時の留意事項</h2>
          <ul className="dl-trust-list">
            <li>住所は位置情報推定に使われるため、省略せず入力してください。</li>
            <li>許可番号は照合のため正確な表記で入力してください。</li>
            <li>許可証記載の薬局名・所在地・許可番号は証票どおり入力してください。</li>
            <li>パスワードは8文字以上で、他システムと使い回さないでください。</li>
          </ul>
        </section>
      )}
    />
  );
}
