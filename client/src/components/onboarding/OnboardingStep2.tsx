import { Button } from 'react-bootstrap';
import AppField from '../ui/AppField';
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
  onBack: () => void;
  fieldErrors?: FieldError[];
}

function getFieldError(fieldErrors: FieldError[] | undefined, field: string): string | undefined {
  return fieldErrors?.find((fe) => fe.field === field)?.message;
}

export default function OnboardingStep2({ formData, onChange, onNext, onBack, fieldErrors }: StepProps) {
  const canProceed = formData.licenseNumber.trim() !== '';

  return (
    <div>
      <AppField
        className="mb-3"
        controlId="onboarding-license-number"
        label="薬局開設許可番号"
        type="text"
        value={formData.licenseNumber}
        onChange={(value) => onChange('licenseNumber', value)}
        required
        isInvalid={!!getFieldError(fieldErrors, 'licenseNumber')}
        errorText={getFieldError(fieldErrors, 'licenseNumber')}
      />

      <AppField
        className="mb-3"
        controlId="onboarding-permit-license-number"
        label="許可証記載の許可番号"
        type="text"
        value={formData.permitLicenseNumber}
        onChange={(value) => onChange('permitLicenseNumber', value)}
        required
        isInvalid={!!getFieldError(fieldErrors, 'permitLicenseNumber')}
        errorText={getFieldError(fieldErrors, 'permitLicenseNumber')}
      />

      <AppField
        className="mb-3"
        controlId="onboarding-permit-pharmacy-name"
        label="許可証記載の薬局名"
        type="text"
        value={formData.permitPharmacyName}
        onChange={(value) => onChange('permitPharmacyName', value)}
        required
        isInvalid={!!getFieldError(fieldErrors, 'permitPharmacyName')}
        errorText={getFieldError(fieldErrors, 'permitPharmacyName')}
      />

      <AppField
        className="mb-3"
        controlId="onboarding-permit-address"
        label="許可証記載の所在地"
        type="text"
        value={formData.permitAddress}
        onChange={(value) => onChange('permitAddress', value)}
        required
        isInvalid={!!getFieldError(fieldErrors, 'permitAddress')}
        errorText={getFieldError(fieldErrors, 'permitAddress')}
        placeholder="許可証に記載されている所在地"
      />

      <div className="d-flex gap-2">
        <Button variant="outline-secondary" className="flex-fill" onClick={onBack}>
          戻る
        </Button>
        <Button variant="primary" className="flex-fill" onClick={onNext} disabled={!canProceed}>
          次へ
        </Button>
      </div>
    </div>
  );
}
