import { useState, useCallback, useMemo, type FormEvent } from 'react';
import { api, isConflictError, isVerificationStatusError, isPartialSuccessError } from '../api/client';
import type { AccountFormState } from '../components/account/AccountInfoForm';
import type { AdminPharmacyData } from './useAdminPharmacyEdit.types';

function toAccountFormState(pharmacy: AdminPharmacyData): AccountFormState {
  return {
    email: pharmacy.email,
    name: pharmacy.name,
    postalCode: pharmacy.postalCode,
    address: pharmacy.address,
    phone: pharmacy.phone,
    fax: pharmacy.fax,
    prefecture: pharmacy.prefecture,
    licenseNumber: pharmacy.licenseNumber,
    currentPassword: '',
    newPassword: '',
  };
}

function applyAdminPharmacyDraft(
  current: AdminPharmacyData,
  form: AccountFormState,
  isTestAccount: boolean,
  testAccountPassword: string,
  version?: number,
): AdminPharmacyData {
  return {
    ...current,
    email: form.email,
    name: form.name,
    postalCode: form.postalCode,
    address: form.address,
    phone: form.phone,
    fax: form.fax,
    prefecture: form.prefecture,
    licenseNumber: form.licenseNumber,
    isTestAccount,
    testAccountPassword: isTestAccount ? testAccountPassword : null,
    ...(version ? { version } : {}),
  };
}

export interface UseAdminPharmacyFormParams {
  pharmacyId: number;
  hasValidId: boolean;
  pharmacy: AdminPharmacyData | null;
  setPharmacy: React.Dispatch<React.SetStateAction<AdminPharmacyData | null>>;
}

export interface UseAdminPharmacyFormReturn {
  form: AccountFormState;
  loading: boolean;
  accountConflict: boolean;
  setAccountConflict: (value: boolean) => void;
  isAccountDirty: boolean;
  isTestAccount: boolean;
  testAccountPassword: string;
  setTestAccountPassword: (value: string) => void;
  handleTestAccountToggle: (checked: boolean) => void;
  handleChange: (field: keyof AccountFormState, value: string) => void;
  handleSubmit: (e: FormEvent) => Promise<void>;
  /** loadPharmacy 後にフォームを同期するコールバック */
  syncFormFromPharmacy: (data: AdminPharmacyData) => void;
}

/**
 * アカウント情報フォーム（テストアカウント含む）の状態管理フック
 */
export function useAdminPharmacyForm({
  pharmacyId,
  hasValidId,
  pharmacy,
  setPharmacy,
}: UseAdminPharmacyFormParams): UseAdminPharmacyFormReturn {
  const [form, setForm] = useState<AccountFormState>({
    email: '',
    name: '',
    postalCode: '',
    address: '',
    phone: '',
    fax: '',
    prefecture: '',
    licenseNumber: '',
    currentPassword: '',
    newPassword: '',
  });

  const [loading, setLoading] = useState(false);
  const [accountConflict, setAccountConflict] = useState(false);
  const [isTestAccount, setIsTestAccount] = useState(false);
  const [testAccountPassword, setTestAccountPassword] = useState('');

  // --- Derived state ---
  const isAccountDirty = useMemo(() => {
    if (!pharmacy) return false;
    return form.email !== pharmacy.email
      || form.name !== pharmacy.name
      || form.postalCode !== pharmacy.postalCode
      || form.address !== pharmacy.address
      || form.phone !== pharmacy.phone
      || form.fax !== pharmacy.fax
      || form.prefecture !== pharmacy.prefecture
      || form.licenseNumber !== pharmacy.licenseNumber
      || isTestAccount !== pharmacy.isTestAccount
      || (isTestAccount && testAccountPassword !== (pharmacy.testAccountPassword ?? ''));
  }, [form, isTestAccount, pharmacy, testAccountPassword]);

  // --- フォーム同期（loadPharmacy 後に呼ばれる） ---
  const syncFormFromPharmacy = useCallback((data: AdminPharmacyData) => {
    setIsTestAccount(Boolean(data.isTestAccount));
    setTestAccountPassword(data.testAccountPassword ?? '');
    setForm(toAccountFormState(data));
    setAccountConflict(false);
  }, []);

  // --- ハンドラー ---
  const handleChange = useCallback((field: keyof AccountFormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleTestAccountToggle = useCallback((checked: boolean) => {
    setIsTestAccount(checked);
    if (!checked) {
      setTestAccountPassword('');
    }
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!hasValidId || !pharmacy) return;
    setAccountConflict(false);
    setLoading(true);
    try {
      const result = await api.put<{ message: string; version: number }>(`/admin/pharmacies/${pharmacyId}`, {
        email: form.email,
        name: form.name,
        postalCode: form.postalCode,
        address: form.address,
        phone: form.phone,
        fax: form.fax,
        prefecture: form.prefecture,
        licenseNumber: form.licenseNumber,
        isTestAccount,
        testAccountPassword: isTestAccount ? testAccountPassword : null,
        version: pharmacy.version,
      });
      setForm((prev) => ({ ...prev, currentPassword: '', newPassword: '' }));
      setPharmacy((prev) => (prev
        ? applyAdminPharmacyDraft(prev, form, isTestAccount, testAccountPassword, result.version)
        : prev));
      return; // success — caller sets message
    } catch (err) {
      if (isConflictError(err)) {
        setAccountConflict(true);
        const latestData = err.data.latestData as AdminPharmacyData | undefined;
        if (latestData) {
          setPharmacy(latestData);
          setForm(toAccountFormState(latestData));
          setIsTestAccount(Boolean(latestData.isTestAccount));
          setTestAccountPassword(latestData.testAccountPassword ?? '');
        }
        throw err; // re-throw so caller can identify conflict
      } else if (isPartialSuccessError(err)) {
        setForm((prev) => ({ ...prev, currentPassword: '', newPassword: '' }));
        setPharmacy((prev) => (prev
          ? applyAdminPharmacyDraft(prev, form, isTestAccount, testAccountPassword, err.data.version)
          : prev));
        throw err; // re-throw so caller can set error message
      } else if (isVerificationStatusError(err)) {
        throw new Error('審査ステータスにより操作を実行できません', { cause: err });
      } else {
        throw err;
      }
    } finally {
      setLoading(false);
    }
  };

  return {
    form,
    loading,
    accountConflict,
    setAccountConflict,
    isAccountDirty,
    isTestAccount,
    testAccountPassword,
    setTestAccountPassword,
    handleTestAccountToggle,
    handleChange,
    handleSubmit,
    syncFormFromPharmacy,
  };
}
