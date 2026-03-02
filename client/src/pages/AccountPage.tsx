import { useState, useEffect, useCallback, FormEvent, useMemo, useRef, type ChangeEvent } from 'react';
import { Form } from 'react-bootstrap';
import AppAlert from '../components/ui/AppAlert';
import AppButton from '../components/ui/AppButton';
import { useAuth } from '../contexts/AuthContext';
import { api, isConflictError, isVerificationStatusError, isPartialSuccessError } from '../api/client';
import { useNavigate } from 'react-router-dom';
import ConfirmActionModal from '../components/ConfirmActionModal';
import ConflictAlert from '../components/ConflictAlert';
import DraftRestoreAlert from '../components/DraftRestoreAlert';
import AccountInfoForm, { AccountFormState } from '../components/account/AccountInfoForm';
import BusinessHoursSettings from '../components/account/BusinessHoursSettings';
import WithdrawSection from '../components/account/WithdrawSection';
import AppDataPanel from '../components/ui/AppDataPanel';
import { useAutoSave } from '../hooks/useAutoSave';
import InlineLoader from '../components/ui/InlineLoader';
import PageShell, { ScrollArea } from '../components/ui/PageShell';
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
  email: string;
  name: string;
  postalCode: string;
  address: string;
  phone: string;
  fax: string;
  prefecture: string;
  licenseNumber: string;
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
    email: '', name: '', postalCode: '', address: '', phone: '', fax: '', prefecture: '', licenseNumber: '',
    currentPassword: '', newPassword: '',
  });
  const [account, setAccount] = useState<AccountData | null>(null);
  const [accountLoaded, setAccountLoaded] = useState(false);
  const [message, setMessage] = useState('');
  const [warning, setWarning] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawPassword, setWithdrawPassword] = useState('');
  const [showWithdrawConfirm, setShowWithdrawConfirm] = useState(false);
  // 通知設定
  const [notifySaving, setNotifySaving] = useState(false);
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
  const [hoursLoadFailed, setHoursLoadFailed] = useState(false);
  const [hoursHasRemoteData, setHoursHasRemoteData] = useState(false);
  const [hoursEditing, setHoursEditing] = useState(false);
  const [hoursSaving, setHoursSaving] = useState(false);
  const [hoursMessage, setHoursMessage] = useState('');
  const [hoursError, setHoursError] = useState('');

  const matchingAutoNotify = account?.matchingAutoNotifyEnabled ?? true;

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
      setHoursLoadFailed(false);
      setHoursHasRemoteData(true);
      setHoursError('');
      setHoursConflict(false);
    } catch (err) {
      if (signal?.aborted) return;
      setHoursLoadFailed(true);
      if (!hoursHasRemoteData) {
        setBusinessHours([]);
        setSavedBusinessHours([]);
        setSpecialHours([]);
        setSavedSpecialHours([]);
      }
      setHoursEditing(false);
      setHoursError(err instanceof Error ? err.message : '営業時間の取得に失敗しました');
    } finally {
      if (!signal?.aborted) {
        setHoursLoaded(true);
      }
    }
  }, [hoursHasRemoteData]);

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

  const handleNotifyToggle = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const enabled = e.target.checked;
    const previousValue = account?.matchingAutoNotifyEnabled ?? true;
    const currentVersion = account?.version;
    // 楽観的にUIを更新
    setAccount((prev) => prev ? { ...prev, matchingAutoNotifyEnabled: enabled } : prev);
    setNotifySaving(true);
    setError('');
    try {
      const result = await api.put<{ message: string; version: number }>('/account', {
        matchingAutoNotifyEnabled: enabled,
        version: currentVersion,
      });
      setAccount((prev) => prev ? { ...prev, matchingAutoNotifyEnabled: enabled, version: result.version } : prev);
    } catch (err) {
      if (isConflictError(err)) {
        setAccountConflict(true);
        const latestData = err.data.latestData as AccountData | undefined;
        if (latestData) {
          applyLatestAccountData(latestData);
        } else {
          // ロールバック
          setAccount((prev) => prev ? { ...prev, matchingAutoNotifyEnabled: previousValue } : prev);
        }
        setError('他のデバイスまたはタブで更新されています。最新データを読み込みました。通知設定を確認して再度保存してください。');
      } else {
        // ロールバック
        setAccount((prev) => prev ? { ...prev, matchingAutoNotifyEnabled: previousValue } : prev);
        setError(err instanceof Error ? err.message : '通知設定の保存に失敗しました');
      }
    } finally {
      setNotifySaving(false);
    }
  }, [account, applyLatestAccountData]);

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
    setHoursLoadFailed(false);
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
    if (hoursLoadFailed || !hoursHasRemoteData) {
      setHoursError('営業時間データを取得できていないため保存できません。再読み込みしてください。');
      return;
    }
    setHoursError('');
    setHoursMessage('');
    setHoursConflict(false);

    const invalidDateRange = specialHours.find((entry) => entry.startDate > entry.endDate);
    if (invalidDateRange) {
      setHoursError('特例営業時間の開始日と終了日の順序が不正です');
      return;
    }

    const invalidWeeklyHours = businessHours.find((entry) =>
      !entry.isClosed
      && !entry.is24Hours
      && (!entry.openTime || !entry.closeTime || entry.openTime === entry.closeTime));
    if (invalidWeeklyHours) {
      setHoursError('通常営業時間の開店時間・閉店時間を正しく入力してください');
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
    if (hoursLoadFailed || !hoursHasRemoteData) {
      setHoursError('営業時間データを取得できていないため編集できません。再読み込みしてください。');
      return;
    }
    setHoursError('');
    setHoursMessage('');
    setHoursConflict(false);
    setHoursEditing(true);
  }, [hoursHasRemoteData, hoursLoadFailed]);

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
      <PageShell>
        <h4 className="page-title mb-3">薬局登録情報の編集</h4>
        {error && <AppAlert variant="danger">{error}</AppAlert>}
        <AppButton variant="outline-secondary" onClick={() => void loadAccount()}>
          再読み込み
        </AppButton>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <h4 className="page-title mb-3">薬局登録情報の編集</h4>
      {message && <AppAlert variant="success" onClose={() => setMessage('')} dismissible>{message}</AppAlert>}
      {warning && <AppAlert variant="warning" onClose={() => setWarning('')} dismissible>{warning}</AppAlert>}
      {error && <AppAlert variant="danger" onClose={() => setError('')} dismissible>{error}</AppAlert>}

      <ScrollArea>
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
        form={form}
        loading={loading}
        submitDisabled={!isAccountDirty}
        onSubmit={handleSubmit}
        onChange={handleChange}
      />

      <AppDataPanel title="通知設定" className="mb-3">
        <Form.Check
          type="switch"
          id="matching-auto-notify"
          label="マッチング候補更新の自動通知"
          checked={matchingAutoNotify}
          disabled={notifySaving}
          onChange={handleNotifyToggle}
        />
        <Form.Text className="text-muted">
          他薬局のアップロードでマッチング候補が更新された時に通知を受け取ります。
        </Form.Text>
      </AppDataPanel>

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
        hoursEditable={!hoursLoadFailed}
        hoursSaving={hoursSaving}
        hoursMessage={hoursMessage}
        hoursError={hoursError}
        onRetryLoad={() => void handleReloadBusinessHours()}
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
      </ScrollArea>

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
    </PageShell>
  );
}
