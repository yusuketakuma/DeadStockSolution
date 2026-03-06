import { useState, useCallback, useMemo, useRef, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, isConflictError, isVerificationStatusError, isPartialSuccessError } from '../api/client';
import { useAutoSave, type AutoSaveResult } from './useAutoSave';
import type { AccountFormState } from '../components/account/AccountInfoForm';
import type { AccountData } from '../components/account/types';

/** アカウント情報フォームの自動保存対象（パスワードは除外） */
export interface AccountDraftData {
  email: string;
  name: string;
  postalCode: string;
  address: string;
  phone: string;
  fax: string;
  prefecture: string;
  licenseNumber: string;
}

interface UseAccountFormOptions {
  userId?: number | string;
  refreshUser: () => Promise<void>;
}

export interface UseAccountFormReturn {
  form: AccountFormState;
  account: AccountData | null;
  accountLoaded: boolean;
  message: string;
  warning: string;
  error: string;
  setError: (error: string) => void;
  loading: boolean;
  accountConflict: boolean;
  setAccountConflict: (value: boolean) => void;
  loadAccount: (signal?: AbortSignal) => Promise<void>;
  handleChange: (field: keyof AccountFormState, value: string) => void;
  handleSubmit: (e: FormEvent) => Promise<void>;
  applyLatestAccountData: (latestData: AccountData) => void;
  handleReloadAccount: () => Promise<void>;
  setAccount: React.Dispatch<React.SetStateAction<AccountData | null>>;
  setMessage: (message: string) => void;
  setWarning: (warning: string) => void;
  accountAutoSave: AutoSaveResult<AccountDraftData>;
  accountDraftData: AccountDraftData;
  handleAccountDraftRestore: () => void;
  handleAccountDraftDiscard: () => void;
  isAccountDirty: boolean;
  initialLoadAbortRef: React.MutableRefObject<AbortController | null>;
}

export function useAccountForm({ userId, refreshUser }: UseAccountFormOptions): UseAccountFormReturn {
  const navigate = useNavigate();
  const initialLoadAbortRef = useRef<AbortController | null>(null);

  const [form, setForm] = useState<AccountFormState>({
    email: '', name: '', postalCode: '', address: '', phone: '', fax: '', prefecture: '', licenseNumber: '',
    currentPassword: '', newPassword: '',
  });
  const [account, setAccount] = useState<AccountData | null>(null);
  const [accountLoaded, setAccountLoaded] = useState(false);
  const [message, setMessage] = useState('');
  const [warning, setWarning] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [accountConflict, setAccountConflict] = useState(false);

  const isAccountDirty = useMemo(() => {
    if (!account) return false;
    return form.email !== account.email
      || form.name !== account.name
      || form.postalCode !== account.postalCode
      || form.address !== account.address
      || form.phone !== account.phone
      || form.fax !== account.fax
      || form.prefecture !== account.prefecture
      || form.licenseNumber !== account.licenseNumber
      || form.currentPassword.length > 0
      || form.newPassword.length > 0;
  }, [account, form]);

  // パスワードを除外した自動保存対象データ
  const accountDraftData = useMemo<AccountDraftData>(() => ({
    email: form.email,
    name: form.name,
    postalCode: form.postalCode,
    address: form.address,
    phone: form.phone,
    fax: form.fax,
    prefecture: form.prefecture,
    licenseNumber: form.licenseNumber,
  }), [
    form.email,
    form.name,
    form.postalCode,
    form.address,
    form.phone,
    form.fax,
    form.prefecture,
    form.licenseNumber,
  ]);

  const accountAutoSave = useAutoSave<AccountDraftData>('account-info', accountDraftData, {
    userId,
    enabled: accountLoaded,
  });

  const handleAccountDraftRestore = useCallback(() => {
    const draft = accountAutoSave.restoreDraft();
    if (draft) {
      setForm((prev) => ({
        ...prev,
        email: draft.email ?? prev.email,
        name: draft.name,
        postalCode: draft.postalCode,
        address: draft.address,
        phone: draft.phone,
        fax: draft.fax,
        prefecture: draft.prefecture,
        licenseNumber: draft.licenseNumber ?? prev.licenseNumber,
      }));
    }
    accountAutoSave.clearDraft();
  }, [accountAutoSave]);

  const handleAccountDraftDiscard = useCallback(() => {
    accountAutoSave.clearDraft();
  }, [accountAutoSave]);

  const loadAccount = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await api.get<AccountData>('/account', { signal });
      if (signal?.aborted) return;
      setAccount(data);
      setForm((prev) => ({
        ...prev,
        email: data.email,
        name: data.name,
        postalCode: data.postalCode,
        address: data.address,
        phone: data.phone,
        fax: data.fax,
        prefecture: data.prefecture,
        licenseNumber: data.licenseNumber,
      }));
      setAccountConflict(false);
    } catch {
      if (signal?.aborted) return;
      setError('アカウント情報の取得に失敗しました');
    } finally {
      if (!signal?.aborted) {
        setAccountLoaded(true);
      }
    }
  }, []);

  /** Conflict 時の最新データ反映（共通処理） */
  const applyLatestAccountData = useCallback((latestData: AccountData) => {
    setAccount(latestData);
    setForm((prev) => ({
      ...prev,
      email: latestData.email,
      name: latestData.name,
      postalCode: latestData.postalCode,
      address: latestData.address,
      phone: latestData.phone,
      fax: latestData.fax,
      prefecture: latestData.prefecture,
      licenseNumber: latestData.licenseNumber,
      currentPassword: '',
      newPassword: '',
    }));
  }, []);

  const handleChange = useCallback((field: keyof AccountFormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setWarning('');
    setAccountConflict(false);
    setLoading(true);
    try {
      const result = await api.put<{ message: string; version: number }>('/account', {
        ...form,
        version: account?.version,
      });
      setMessage('アカウント情報を更新しました');
      setForm((prev) => ({ ...prev, currentPassword: '', newPassword: '' }));
      accountAutoSave.clearDraft();
      // version を更新
      if (result.version && account) {
        setAccount({ ...account, ...form, version: result.version });
      }
      refreshUser();
    } catch (err) {
      if (isConflictError(err)) {
        setAccountConflict(true);
        const latestData = err.data.latestData as AccountData | undefined;
        if (latestData) {
          applyLatestAccountData(latestData);
        }
      } else if (isVerificationStatusError(err)) {
        const data = err.data as { verificationStatus: string; rejectionReason?: string };
        if (data.verificationStatus === 'pending_verification') {
          navigate('/verification-pending');
        } else if (data.verificationStatus === 'rejected') {
          setError(data.rejectionReason ? `${err.message}（理由: ${data.rejectionReason}）` : err.message);
        } else {
          setError(err.message);
        }
      } else if (isPartialSuccessError(err)) {
        setWarning(err.message);
        if (err.data.version && account) {
          setAccount({ ...account, version: err.data.version });
        }
      } else {
        setError(err instanceof Error ? err.message : '更新に失敗しました');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleReloadAccount = useCallback(async () => {
    setAccountConflict(false);
    setError('');
    setMessage('');
    await loadAccount();
  }, [loadAccount]);

  return {
    form,
    account,
    accountLoaded,
    message,
    warning,
    error,
    setError,
    loading,
    accountConflict,
    setAccountConflict,
    loadAccount,
    handleChange,
    handleSubmit,
    applyLatestAccountData,
    handleReloadAccount,
    setAccount,
    setMessage,
    setWarning,
    accountAutoSave,
    accountDraftData,
    handleAccountDraftRestore,
    handleAccountDraftDiscard,
    isAccountDirty,
    initialLoadAbortRef,
  };
}
