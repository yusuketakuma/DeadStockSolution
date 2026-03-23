import { Button } from 'react-bootstrap';
import LoadingButton from '../ui/LoadingButton';

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

interface Step3Props {
  formData: OnboardingFormData;
  agreed: boolean;
  onAgreeChange: (agreed: boolean) => void;
  onSubmit: () => void;
  onBack: () => void;
  loading: boolean;
}

interface PreviewRowProps {
  label: string;
  value: string;
}

function PreviewRow({ label, value }: PreviewRowProps) {
  return (
    <div className="d-flex border-bottom py-2">
      <span className="text-muted small" style={{ minWidth: '160px' }}>{label}</span>
      <span className="small fw-medium">{value || '—'}</span>
    </div>
  );
}

export default function OnboardingStep3({ formData, agreed, onAgreeChange, onSubmit, onBack, loading }: Step3Props) {
  return (
    <div>
      <p className="text-muted small mb-3">入力内容を確認してください。</p>

      <div className="mb-3 border rounded p-3 bg-light">
        <h3 className="h6 mb-2 text-secondary">基本情報</h3>
        <PreviewRow label="薬局名" value={formData.name} />
        <PreviewRow label="都道府県" value={formData.prefecture} />
        <PreviewRow label="郵便番号" value={formData.postalCode} />
        <PreviewRow label="住所" value={formData.address} />
        <PreviewRow label="電話番号" value={formData.phone} />
        <PreviewRow label="FAX番号" value={formData.fax} />
      </div>

      <div className="mb-3 border rounded p-3 bg-light">
        <h3 className="h6 mb-2 text-secondary">許可証情報</h3>
        <PreviewRow label="薬局開設許可番号" value={formData.licenseNumber} />
        <PreviewRow label="許可証記載の許可番号" value={formData.permitLicenseNumber} />
        <PreviewRow label="許可証記載の薬局名" value={formData.permitPharmacyName} />
        <PreviewRow label="許可証記載の所在地" value={formData.permitAddress} />
      </div>

      <div className="form-check mb-3">
        <input
          type="checkbox"
          className="form-check-input"
          id="onboarding-agreed"
          checked={agreed}
          onChange={(e) => onAgreeChange(e.target.checked)}
        />
        <label className="form-check-label small" htmlFor="onboarding-agreed">
          本システムはあくまで業務補助ツールであり、医薬品の交換に関する一切の責任を負わないことに同意します
        </label>
      </div>

      <div className="d-flex gap-2">
        <Button variant="outline-secondary" className="flex-fill" onClick={onBack} disabled={loading}>
          戻る
        </Button>
        <LoadingButton
          variant="primary"
          className="flex-fill"
          disabled={!agreed}
          loading={loading}
          loadingLabel="登録中..."
          onClick={onSubmit}
        >
          薬局情報を登録
        </LoadingButton>
      </div>
    </div>
  );
}
