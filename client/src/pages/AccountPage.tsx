import { useState, useEffect, useCallback, FormEvent, useMemo, useRef } from 'react';
import AppAlert from '../components/ui/AppAlert';
import AppButton from '../components/ui/AppButton';
import { useAuth } from '../contexts/AuthContext';
import { api, isConflictError } from '../api/client';
import { useNavigate } from 'react-router-dom';
import ConfirmActionModal from '../components/ConfirmActionModal';
import ConflictAlert from '../components/ConflictAlert';
import DraftRestoreAlert from '../components/DraftRestoreAlert';
import AccountInfoForm, { AccountFormState } from '../components/account/AccountInfoForm';
import BusinessHoursSettings from '../components/account/BusinessHoursSettings';
import WithdrawSection from '../components/account/WithdrawSection';
import { useAutoSave } from '../hooks/useAutoSave';
import InlineLoader from '../components/ui/InlineLoader';
import {
  AccountData,
  BusinessHourEntry,
  BusinessHourSettingsResponse,
  SpecialHourEntry,
  SpecialType,
  createDefaultHours,
  createDefaultSpecialHour,
  normalizeBusinessHours,
  normalizeSpecialHours,
} from '../components/account/types';

/** アカウント情報フォームの自動保存対象（パスワードは除外） */
interface AccountDraftData {
  name: string;
  postalCode: string;
  address: string;
  phone: string;
  fax: string;
  prefecture: string;
}

/** 営業時間の自動保存対象 */
interface BusinessHoursDraftData {
  businessHours: BusinessHourEntry[];
  specialHours: SpecialHourEntry[];
}

export default function AccountPage() {
  const { user, refreshUser, logout } = useAuth();
  const navigate = useNavigate();
  const initialLoadAbortRef = useRef<AbortController | null>(null);
  const [form, setForm] = useState<AccountFormState>({
    name: '', postalCode: '', address: '', phone: '', fax: '', prefecture: '',
    currentPassword: '', newPassword: '',
  });
  const [account, setAccount] = useState<AccountData | null>(null);
  const [accountLoaded, setAccountLoaded] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawPassword, setWithdrawPassword] = useState('');
  const [showWithdrawConfirm, setShowWithdrawConfirm] = useState(false);
  // 楽観的ロック競合フラグ
  const [accountConflict, setAccountConflict] = useState(false);
  const [hoursConflict, setHoursConflict] = useState(false);

  // Business hours state
  const [businessHours, setBusinessHours] = useState<BusinessHourEntry[]>(createDefaultHours());
  const [savedBusinessHours, setSavedBusinessHours] = useState<BusinessHourEntry[]>(createDefaultHours());
  const [specialHours, setSpecialHours] = useState<SpecialHourEntry[]>([]);
  const [savedSpecialHours, setSavedSpecialHours] = useState<SpecialHourEntry[]>([]);
  const [hoursVersion, setHoursVersion] = useState(1);
  const [hoursLoaded, setHoursLoaded] = useState(false);
  const [hoursEditing, setHoursEditing] = useState(false);
  const [hoursSaving, setHoursSaving] = useState(false);
  const [hoursMessage, setHoursMessage] = useState('');
  const [hoursError, setHoursError] = useState('');

  // パスワードを除外した自動保存対象データ
  const accountDraftData = useMemo<AccountDraftData>(() => ({
    name: form.name,
    postalCode: form.postalCode,
    address: form.address,
    phone: form.phone,
    fax: form.fax,
    prefecture: form.prefecture,
  }), [form.name, form.postalCode, form.address, form.phone, form.fax, form.prefecture]);

  const accountAutoSave = useAutoSave<AccountDraftData>('account-info', accountDraftData, {
    userId: user?.id,
    enabled: accountLoaded,
  });

  // 営業時間の自動保存対象データ
  const hoursDraftData = useMemo<BusinessHoursDraftData>(() => ({
    businessHours,
    specialHours,
  }), [businessHours, specialHours]);

  const hoursAutoSave = useAutoSave<BusinessHoursDraftData>('business-hours', hoursDraftData, {
    userId: user?.id,
    enabled: hoursLoaded && hoursEditing,
  });

  // アカウント情報の下書き復元
  const handleAccountDraftRestore = useCallback(() => {
    const draft = accountAutoSave.restoreDraft();
    if (draft) {
      setForm((prev) => ({
        ...prev,
        name: draft.name,
        postalCode: draft.postalCode,
        address: draft.address,
        phone: draft.phone,
        fax: draft.fax,
        prefecture: draft.prefecture,
      }));
    }
    accountAutoSave.clearDraft();
  }, [accountAutoSave]);

  const handleAccountDraftDiscard = useCallback(() => {
    accountAutoSave.clearDraft();
  }, [accountAutoSave]);

  // 営業時間の下書き復元
  const handleHoursDraftRestore = useCallback(() => {
    const draft = hoursAutoSave.restoreDraft();
    if (draft) {
      setBusinessHours(draft.businessHours);
      setSpecialHours(draft.specialHours);
      setHoursEditing(true);
    }
    hoursAutoSave.clearDraft();
  }, [hoursAutoSave]);

  const handleHoursDraftDiscard = useCallback(() => {
    hoursAutoSave.clearDraft();
  }, [hoursAutoSave]);

  const loadAccount = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await api.get<AccountData>('/account', { signal });
      if (signal?.aborted) return;
      setAccount(data);
      setForm((prev) => ({
        ...prev,
        name: data.name,
        postalCode: data.postalCode,
        address: data.address,
        phone: data.phone,
        fax: data.fax,
        prefecture: data.prefecture,
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

  const loadBusinessHours = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await api.get<BusinessHourSettingsResponse>('/business-hours/settings', { signal });
      if (signal?.aborted) return;
      const normalizedWeekly = normalizeBusinessHours(data.hours ?? []);
      const normalizedSpecial = normalizeSpecialHours(data.specialHours ?? []);
      setBusinessHours(normalizedWeekly);
      setSavedBusinessHours(normalizedWeekly);
      setSpecialHours(normalizedSpecial);
      setSavedSpecialHours(normalizedSpecial);
      setHoursVersion(data.version ?? 1);
      setHoursConflict(false);
    } catch (err) {
      if (signal?.aborted) return;
      const defaults = createDefaultHours();
      setBusinessHours(defaults);
      setSavedBusinessHours(defaults);
      setSpecialHours([]);
      setSavedSpecialHours([]);
      setHoursError(err instanceof Error ? err.message : '営業時間の取得に失敗しました');
    } finally {
      if (!signal?.aborted) {
        setHoursLoaded(true);
      }
    }
  }, []);

  useEffect(() => {
    initialLoadAbortRef.current?.abort();
    const controller = new AbortController();
    initialLoadAbortRef.current = controller;
    void Promise.all([loadAccount(controller.signal), loadBusinessHours(controller.signal)]);
    return () => {
      controller.abort();
      if (initialLoadAbortRef.current === controller) {
        initialLoadAbortRef.current = null;
      }
    };
  }, [loadAccount, loadBusinessHours]);

  const handleChange = useCallback((field: keyof AccountFormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
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
        // 最新データでアカウント状態を更新
        const latestData = err.data.latestData as AccountData | undefined;
        if (latestData) {
          setAccount(latestData);
          setForm((prev) => ({
            ...prev,
            name: latestData.name,
            postalCode: latestData.postalCode,
            address: latestData.address,
            phone: latestData.phone,
            fax: latestData.fax,
            prefecture: latestData.prefecture,
            currentPassword: '',
            newPassword: '',
          }));
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

  const handleReloadBusinessHours = useCallback(async () => {
    setHoursConflict(false);
    setHoursError('');
    setHoursMessage('');
    setHoursEditing(false);
    await loadBusinessHours();
  }, [loadBusinessHours]);

  const handleHoursChange = useCallback((dayOfWeek: number, field: 'openTime' | 'closeTime', value: string) => {
    setBusinessHours((prev) =>
      prev.map((h) => h.dayOfWeek === dayOfWeek ? { ...h, [field]: value } : h),
    );
  }, []);

  const handleClosedChange = useCallback((dayOfWeek: number, isClosed: boolean) => {
    setBusinessHours((prev) =>
      prev.map((h) => h.dayOfWeek === dayOfWeek
        ? { ...h, isClosed, is24Hours: false, openTime: isClosed ? null : (h.openTime || '09:00'), closeTime: isClosed ? null : (h.closeTime || '18:00') }
        : h,
      ),
    );
  }, []);

  const handle24HoursChange = useCallback((dayOfWeek: number, is24Hours: boolean) => {
    setBusinessHours((prev) =>
      prev.map((h) => h.dayOfWeek === dayOfWeek
        ? { ...h, is24Hours, isClosed: false, openTime: is24Hours ? null : (h.openTime || '09:00'), closeTime: is24Hours ? null : (h.closeTime || '18:00') }
        : h,
      ),
    );
  }, []);

  const handleHoursSave = async () => {
    setHoursError('');
    setHoursMessage('');
    setHoursConflict(false);

    const invalidDateRange = specialHours.find((entry) => entry.startDate > entry.endDate);
    if (invalidDateRange) {
      setHoursError('特例営業時間の開始日と終了日の順序が不正です');
      return;
    }

    const invalidSpecialHours = specialHours.find((entry) =>
      entry.specialType === 'special_open'
      && !entry.isClosed
      && !entry.is24Hours
      && (!entry.openTime || !entry.closeTime || entry.openTime === entry.closeTime));
    if (invalidSpecialHours) {
      setHoursError('特別営業時間の開店時間・閉店時間を正しく入力してください');
      return;
    }

    setHoursSaving(true);
    try {
      const payloadSpecialHours = specialHours.map((entry) => ({
        specialType: entry.specialType,
        startDate: entry.startDate,
        endDate: entry.endDate,
        openTime: entry.isClosed || entry.is24Hours ? null : entry.openTime,
        closeTime: entry.isClosed || entry.is24Hours ? null : entry.closeTime,
        isClosed: entry.isClosed,
        is24Hours: entry.is24Hours,
        note: entry.note?.trim() || null,
      }));
      const result = await api.put<{ message: string; version: number }>('/business-hours', {
        hours: businessHours,
        specialHours: payloadSpecialHours,
        version: hoursVersion,
      });
      const normalizedSpecial = normalizeSpecialHours(specialHours);
      setSpecialHours(normalizedSpecial);
      setSavedBusinessHours(businessHours);
      setSavedSpecialHours(normalizedSpecial);
      setHoursEditing(false);
      hoursAutoSave.clearDraft();
      setHoursMessage('営業時間を更新しました');
      // version を更新
      if (result.version) {
        setHoursVersion(result.version);
      }
    } catch (err) {
      if (isConflictError(err)) {
        setHoursConflict(true);
        // 最新データで営業時間状態を更新
        const latestData = err.data.latestData as BusinessHourSettingsResponse | undefined;
        if (latestData) {
          const normalizedWeekly = normalizeBusinessHours(latestData.hours ?? []);
          const normalizedSpecial = normalizeSpecialHours(latestData.specialHours ?? []);
          setBusinessHours(normalizedWeekly);
          setSavedBusinessHours(normalizedWeekly);
          setSpecialHours(normalizedSpecial);
          setSavedSpecialHours(normalizedSpecial);
          setHoursVersion(latestData.version ?? 1);
          setHoursEditing(false);
        }
      } else {
        setHoursError(err instanceof Error ? err.message : '営業時間の更新に失敗しました');
      }
    } finally {
      setHoursSaving(false);
    }
  };

  const handleHoursEditStart = useCallback(() => {
    setHoursError('');
    setHoursMessage('');
    setHoursConflict(false);
    setHoursEditing(true);
  }, []);

  const handleHoursEditCancel = useCallback(() => {
    setBusinessHours(savedBusinessHours);
    setSpecialHours(savedSpecialHours);
    setHoursError('');
    setHoursMessage('');
    setHoursConflict(false);
    setHoursEditing(false);
  }, [savedBusinessHours, savedSpecialHours]);

  const handleAddSpecialHour = useCallback(() => {
    setSpecialHours((prev) => [...prev, { ...createDefaultSpecialHour(), clientId: crypto.randomUUID() }]);
  }, []);

  const handleRemoveSpecialHour = useCallback((index: number) => {
    setSpecialHours((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSpecialTypeChange = useCallback((index: number, specialType: SpecialType) => {
    setSpecialHours((prev) =>
      prev.map((entry, i) => {
        if (i !== index) return entry;
        if (specialType !== 'special_open') {
          return { ...entry, specialType, isClosed: true, is24Hours: false, openTime: null, closeTime: null };
        }
        return {
          ...entry,
          specialType,
          isClosed: false,
          is24Hours: false,
          openTime: entry.openTime || '09:00',
          closeTime: entry.closeTime || '18:00',
        };
      }),
    );
  }, []);

  const handleSpecialDateChange = useCallback((index: number, field: 'startDate' | 'endDate', value: string) => {
    setSpecialHours((prev) =>
      prev.map((entry, i) => (i === index ? { ...entry, [field]: value } : entry)),
    );
  }, []);

  const handleSpecialNoteChange = useCallback((index: number, value: string) => {
    setSpecialHours((prev) =>
      prev.map((entry, i) => (i === index ? { ...entry, note: value || null } : entry)),
    );
  }, []);

  const handleSpecialHoursChange = useCallback((index: number, field: 'openTime' | 'closeTime', value: string) => {
    setSpecialHours((prev) =>
      prev.map((entry, i) => (i === index ? { ...entry, [field]: value } : entry)),
    );
  }, []);

  const handleSpecialClosedChange = useCallback((index: number, isClosed: boolean) => {
    setSpecialHours((prev) =>
      prev.map((entry, i) => {
        if (i !== index) return entry;
        return {
          ...entry,
          isClosed,
          is24Hours: false,
          openTime: isClosed ? null : (entry.openTime || '09:00'),
          closeTime: isClosed ? null : (entry.closeTime || '18:00'),
        };
      }),
    );
  }, []);

  const handleSpecial24HoursChange = useCallback((index: number, is24Hours: boolean) => {
    setSpecialHours((prev) =>
      prev.map((entry, i) => {
        if (i !== index) return entry;
        return {
          ...entry,
          is24Hours,
          isClosed: false,
          openTime: is24Hours ? null : (entry.openTime || '09:00'),
          closeTime: is24Hours ? null : (entry.closeTime || '18:00'),
        };
      }),
    );
  }, []);

  const handleWithdraw = () => {
    if (!withdrawPassword) {
      setError('退会には現在のパスワードが必要です');
      return;
    }
    setShowWithdrawConfirm(true);
  };

  const handleWithdrawConfirmed = async () => {
    setShowWithdrawConfirm(false);
    setWithdrawing(true);
    setError('');
    setMessage('');
    try {
      await api.delete<{ message: string }>('/account', { currentPassword: withdrawPassword });
      setWithdrawPassword('');
      await logout();
      navigate('/login');
    } catch (err) {
      setError(err instanceof Error ? err.message : '退会処理に失敗しました');
    } finally {
      setWithdrawing(false);
    }
  };

  if (!accountLoaded) {
    return (
      <InlineLoader text="アカウント情報を読み込み中..." className="text-muted small" />
    );
  }

  if (!account) {
    return (
      <div>
        <h4 className="page-title mb-3">薬局登録情報の編集</h4>
        {error && <AppAlert variant="danger">{error}</AppAlert>}
        <AppButton variant="outline-secondary" onClick={() => void loadAccount()}>
          再読み込み
        </AppButton>
      </div>
    );
  }

  return (
    <div>
      <h4 className="page-title mb-3">薬局登録情報の編集</h4>
      {message && <AppAlert variant="success" onClose={() => setMessage('')} dismissible>{message}</AppAlert>}
      {error && <AppAlert variant="danger" onClose={() => setError('')} dismissible>{error}</AppAlert>}

      <ConflictAlert
        show={accountConflict}
        onReload={handleReloadAccount}
        onDismiss={() => setAccountConflict(false)}
        message="他のデバイスまたはタブでアカウント情報が更新されました。最新のデータを読み込みました。内容を確認してから再度保存してください。"
      />

      {accountAutoSave.hasDraft && (
        <DraftRestoreAlert
          draftTimestamp={accountAutoSave.draftTimestamp}
          onRestore={handleAccountDraftRestore}
          onDiscard={handleAccountDraftDiscard}
        />
      )}

      <AccountInfoForm
        account={account}
        form={form}
        loading={loading}
        onSubmit={handleSubmit}
        onChange={handleChange}
      />

      <ConflictAlert
        show={hoursConflict}
        onReload={handleReloadBusinessHours}
        onDismiss={() => setHoursConflict(false)}
        message="他のデバイスまたはタブで営業時間が更新されました。最新のデータを読み込みました。内容を確認してから再度保存してください。"
      />

      {hoursAutoSave.hasDraft && (
        <DraftRestoreAlert
          draftTimestamp={hoursAutoSave.draftTimestamp}
          onRestore={handleHoursDraftRestore}
          onDiscard={handleHoursDraftDiscard}
        />
      )}

      <BusinessHoursSettings
        businessHours={businessHours}
        specialHours={specialHours}
        hoursLoaded={hoursLoaded}
        hoursEditing={hoursEditing}
        hoursSaving={hoursSaving}
        hoursMessage={hoursMessage}
        hoursError={hoursError}
        onHoursMessage={setHoursMessage}
        onHoursError={setHoursError}
        onHoursChange={handleHoursChange}
        onClosedChange={handleClosedChange}
        on24HoursChange={handle24HoursChange}
        onHoursSave={handleHoursSave}
        onHoursEditStart={handleHoursEditStart}
        onHoursEditCancel={handleHoursEditCancel}
        onAddSpecialHour={handleAddSpecialHour}
        onRemoveSpecialHour={handleRemoveSpecialHour}
        onSpecialTypeChange={handleSpecialTypeChange}
        onSpecialDateChange={handleSpecialDateChange}
        onSpecialNoteChange={handleSpecialNoteChange}
        onSpecialHoursChange={handleSpecialHoursChange}
        onSpecialClosedChange={handleSpecialClosedChange}
        onSpecial24HoursChange={handleSpecial24HoursChange}
      />

      <WithdrawSection
        withdrawPassword={withdrawPassword}
        withdrawing={withdrawing}
        onPasswordChange={setWithdrawPassword}
        onWithdraw={handleWithdraw}
      />

      <ConfirmActionModal
        show={showWithdrawConfirm}
        title="退会の確認"
        body="退会するとアカウントは無効化され、現在のセッションは終了します。実行してよろしいですか？"
        confirmLabel="退会する"
        confirmVariant="danger"
        onCancel={() => setShowWithdrawConfirm(false)}
        onConfirm={handleWithdrawConfirmed}
        pending={withdrawing}
      />
    </div>
  );
}
