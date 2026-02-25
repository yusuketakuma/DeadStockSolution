import { useState, useEffect, FormEvent } from 'react';
import { Alert, Spinner } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';
import { useNavigate } from 'react-router-dom';
import ConfirmActionModal from '../components/ConfirmActionModal';
import AccountInfoForm, { AccountFormState } from '../components/account/AccountInfoForm';
import BusinessHoursSettings from '../components/account/BusinessHoursSettings';
import WithdrawSection from '../components/account/WithdrawSection';
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

export default function AccountPage() {
  const { refreshUser, logout } = useAuth();
  const navigate = useNavigate();
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

  // Business hours state
  const [businessHours, setBusinessHours] = useState<BusinessHourEntry[]>(createDefaultHours());
  const [savedBusinessHours, setSavedBusinessHours] = useState<BusinessHourEntry[]>(createDefaultHours());
  const [specialHours, setSpecialHours] = useState<SpecialHourEntry[]>([]);
  const [savedSpecialHours, setSavedSpecialHours] = useState<SpecialHourEntry[]>([]);
  const [hoursLoaded, setHoursLoaded] = useState(false);
  const [hoursEditing, setHoursEditing] = useState(false);
  const [hoursSaving, setHoursSaving] = useState(false);
  const [hoursMessage, setHoursMessage] = useState('');
  const [hoursError, setHoursError] = useState('');

  useEffect(() => {
    let mounted = true;

    const loadAccount = async () => {
      try {
        const data = await api.get<AccountData>('/account');
        if (!mounted) return;
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
      } catch {
        if (!mounted) return;
        setError('アカウント情報の取得に失敗しました');
      } finally {
        if (!mounted) return;
        setAccountLoaded(true);
      }
    };

    const loadBusinessHours = async () => {
      try {
        const data = await api.get<BusinessHourSettingsResponse>('/business-hours/settings');
        if (!mounted) return;
        const normalizedWeekly = normalizeBusinessHours(data.hours ?? []);
        const normalizedSpecial = normalizeSpecialHours(data.specialHours ?? []);
        setBusinessHours(normalizedWeekly);
        setSavedBusinessHours(normalizedWeekly);
        setSpecialHours(normalizedSpecial);
        setSavedSpecialHours(normalizedSpecial);
      } catch (err) {
        if (!mounted) return;
        const defaults = createDefaultHours();
        setBusinessHours(defaults);
        setSavedBusinessHours(defaults);
        setSpecialHours([]);
        setSavedSpecialHours([]);
        setHoursError(err instanceof Error ? err.message : '営業時間の取得に失敗しました');
      } finally {
        if (!mounted) return;
        setHoursLoaded(true);
      }
    };

    void loadAccount();
    void loadBusinessHours();

    return () => {
      mounted = false;
    };
  }, []);

  const handleChange = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);
    try {
      await api.put('/account', form);
      setMessage('アカウント情報を更新しました');
      setForm((prev) => ({ ...prev, currentPassword: '', newPassword: '' }));
      refreshUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const handleHoursChange = (dayOfWeek: number, field: 'openTime' | 'closeTime', value: string) => {
    setBusinessHours((prev) =>
      prev.map((h) => h.dayOfWeek === dayOfWeek ? { ...h, [field]: value } : h),
    );
  };

  const handleClosedChange = (dayOfWeek: number, isClosed: boolean) => {
    setBusinessHours((prev) =>
      prev.map((h) => h.dayOfWeek === dayOfWeek
        ? { ...h, isClosed, is24Hours: false, openTime: isClosed ? null : (h.openTime || '09:00'), closeTime: isClosed ? null : (h.closeTime || '18:00') }
        : h,
      ),
    );
  };

  const handle24HoursChange = (dayOfWeek: number, is24Hours: boolean) => {
    setBusinessHours((prev) =>
      prev.map((h) => h.dayOfWeek === dayOfWeek
        ? { ...h, is24Hours, isClosed: false, openTime: is24Hours ? null : (h.openTime || '09:00'), closeTime: is24Hours ? null : (h.closeTime || '18:00') }
        : h,
      ),
    );
  };

  const handleHoursSave = async () => {
    setHoursError('');
    setHoursMessage('');

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
      await api.put('/business-hours', { hours: businessHours, specialHours: payloadSpecialHours });
      const normalizedSpecial = normalizeSpecialHours(specialHours);
      setSpecialHours(normalizedSpecial);
      setSavedBusinessHours(businessHours);
      setSavedSpecialHours(normalizedSpecial);
      setHoursEditing(false);
      setHoursMessage('営業時間を更新しました');
    } catch (err) {
      setHoursError(err instanceof Error ? err.message : '営業時間の更新に失敗しました');
    } finally {
      setHoursSaving(false);
    }
  };

  const handleHoursEditStart = () => {
    setHoursError('');
    setHoursMessage('');
    setHoursEditing(true);
  };

  const handleHoursEditCancel = () => {
    setBusinessHours(savedBusinessHours);
    setSpecialHours(savedSpecialHours);
    setHoursError('');
    setHoursMessage('');
    setHoursEditing(false);
  };

  const handleAddSpecialHour = () => {
    setSpecialHours((prev) => [...prev, createDefaultSpecialHour()]);
  };

  const handleRemoveSpecialHour = (index: number) => {
    setSpecialHours((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSpecialTypeChange = (index: number, specialType: SpecialType) => {
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
  };

  const handleSpecialDateChange = (index: number, field: 'startDate' | 'endDate', value: string) => {
    setSpecialHours((prev) =>
      prev.map((entry, i) => (i === index ? { ...entry, [field]: value } : entry)),
    );
  };

  const handleSpecialNoteChange = (index: number, value: string) => {
    setSpecialHours((prev) =>
      prev.map((entry, i) => (i === index ? { ...entry, note: value || null } : entry)),
    );
  };

  const handleSpecialHoursChange = (index: number, field: 'openTime' | 'closeTime', value: string) => {
    setSpecialHours((prev) =>
      prev.map((entry, i) => (i === index ? { ...entry, [field]: value } : entry)),
    );
  };

  const handleSpecialClosedChange = (index: number, isClosed: boolean) => {
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
  };

  const handleSpecial24HoursChange = (index: number, is24Hours: boolean) => {
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
  };

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
      <div className="d-flex align-items-center gap-2 text-muted small">
        <Spinner size="sm" />
        アカウント情報を読み込み中...
      </div>
    );
  }

  if (!account) {
    return (
      <div>
        <h4 className="page-title mb-3">薬局登録情報の編集</h4>
        {error && <Alert variant="danger">{error}</Alert>}
        <button className="btn btn-outline-secondary" onClick={() => window.location.reload()}>
          再読み込み
        </button>
      </div>
    );
  }

  return (
    <div>
      <h4 className="page-title mb-3">薬局登録情報の編集</h4>
      {message && <Alert variant="success" onClose={() => setMessage('')} dismissible>{message}</Alert>}
      {error && <Alert variant="danger" onClose={() => setError('')} dismissible>{error}</Alert>}

      <AccountInfoForm
        account={account}
        form={form}
        loading={loading}
        onSubmit={handleSubmit}
        onChange={handleChange}
      />

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
