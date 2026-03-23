import { Row, Col, Button } from 'react-bootstrap';
import AppField from '../ui/AppField';
import AppSelect from '../ui/AppSelect';
import type { FieldError } from '../../api/client';

interface OnboardingFormData {
  name: string;
  postalCode: string;
  address: string;
  phone: string;
  fax: string;
  prefecture: string;
  licenseNumber: string;
  permitLicenseNumber: string;
  permitPharmacyName: string;
  permitAddress: string;
}

interface StepProps {
  formData: OnboardingFormData;
  onChange: (field: string, value: string) => void;
  onNext: () => void;
  fieldErrors?: FieldError[];
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

function getFieldError(fieldErrors: FieldError[] | undefined, field: string): string | undefined {
  return fieldErrors?.find((fe) => fe.field === field)?.message;
}

export default function OnboardingStep1({ formData, onChange, onNext, fieldErrors }: StepProps) {
  const handleNext = () => {
    if (!formData.name.trim() || !formData.postalCode.trim() || !formData.address.trim()) {
      return;
    }
    onNext();
  };

  const canProceed = formData.name.trim() !== '' && formData.postalCode.trim() !== '' && formData.address.trim() !== '';

  return (
    <div>
      <AppField
        className="mb-3"
        controlId="onboarding-name"
        label="薬局名"
        type="text"
        value={formData.name}
        onChange={(value) => onChange('name', value)}
        required
        isInvalid={!!getFieldError(fieldErrors, 'name')}
        errorText={getFieldError(fieldErrors, 'name')}
      />

      <Row>
        <Col md={6}>
          <AppSelect
            className="mb-3"
            controlId="onboarding-prefecture"
            label="都道府県"
            value={formData.prefecture}
            onChange={(value) => onChange('prefecture', value)}
            required
            isInvalid={!!getFieldError(fieldErrors, 'prefecture')}
            errorText={getFieldError(fieldErrors, 'prefecture')}
            placeholder="選択してください"
            options={PREFECTURE_OPTIONS}
          />
        </Col>
        <Col md={6}>
          <AppField
            className="mb-3"
            controlId="onboarding-postal-code"
            label="郵便番号"
            type="text"
            value={formData.postalCode}
            onChange={(value) => onChange('postalCode', value)}
            placeholder="1234567"
            required
            isInvalid={!!getFieldError(fieldErrors, 'postalCode')}
            errorText={getFieldError(fieldErrors, 'postalCode')}
          />
        </Col>
      </Row>

      <AppField
        className="mb-3"
        controlId="onboarding-address"
        label="住所"
        type="text"
        value={formData.address}
        onChange={(value) => onChange('address', value)}
        required
        isInvalid={!!getFieldError(fieldErrors, 'address')}
        errorText={getFieldError(fieldErrors, 'address')}
        placeholder="市区町村以降の住所"
        helpText={!getFieldError(fieldErrors, 'address') ? '位置情報の特定に使用します。正確な住所を入力してください' : undefined}
      />

      <Row>
        <Col md={6}>
          <AppField
            className="mb-3"
            controlId="onboarding-phone"
            label="電話番号"
            type="tel"
            value={formData.phone}
            onChange={(value) => onChange('phone', value)}
            required
            isInvalid={!!getFieldError(fieldErrors, 'phone')}
            errorText={getFieldError(fieldErrors, 'phone')}
          />
        </Col>
        <Col md={6}>
          <AppField
            className="mb-3"
            controlId="onboarding-fax"
            label="FAX番号"
            type="tel"
            value={formData.fax}
            onChange={(value) => onChange('fax', value)}
            required
            isInvalid={!!getFieldError(fieldErrors, 'fax')}
            errorText={getFieldError(fieldErrors, 'fax')}
          />
        </Col>
      </Row>

      <Button
        variant="primary"
        className="w-100"
        onClick={handleNext}
        disabled={!canProceed}
      >
        次へ
      </Button>
    </div>
  );
}
