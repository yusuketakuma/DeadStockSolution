import { useState, useEffect, useCallback, useMemo, useRef, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, isConflictError, isVerificationStatusError, isPartialSuccessError } from '../api/client';
import type { AccountFormState } from '../components/account/AccountInfoForm';
import {
  type BusinessHourEntry,
  type BusinessHourSettingsResponse,
  createDefaultHours,
  createDefaultSpecialHour,
  normalizeBusinessHours,
  normalizeSpecialHours,
  type SpecialHourEntry,
  type SpecialType,
} from '../components/account/types';

export interface AdminPharmacyData {
  id: number;
  email: string;
  name: string;
  postalCode: string;
  address: string;
  phone: string;
  fax: string;
  licenseNumber: string;
  prefecture: string;
  isActive: boolean;
  isAdmin: boolean;
  isTestAccount: boolean;
  testAccountPassword: string | null;
  version: number;
  createdAt: string | null;
  verificationStatus?: string;
}

export interface UseAdminPharmacyEditReturn {
  // Core
  pharmacy: AdminPharmacyData | null;
  pharmacyLoaded: boolean;
  hasValidId: boolean;

  // Account form
  form: AccountFormState;
  message: string;
  setMessage: (value: string) => void;
  error: string;
  setError: (value: string) => void;
  loading: boolean;
  accountConflict: boolean;
  setAccountConflict: (value: boolean) => void;
  isAccountDirty: boolean;

  // Test account
  isTestAccount: boolean;
  testAccountPassword: string;
  setTestAccountPassword: (value: string) => void;
  handleTestAccountToggle: (checked: boolean) => void;

  // Toggle active / verify
  activeUpdating: boolean;
  verifyLoading: boolean;

  // Business hours state
  businessHours: BusinessHourEntry[];
  specialHours: SpecialHourEntry[];
  hoursLoaded: boolean;
  hoursEditing: boolean;
  hoursLoadFailed: boolean;
  hoursSaving: boolean;
  hoursMessage: string;
  hoursError: string;
  hoursConflict: boolean;
  setHoursMessage: (value: string) => void;
  setHoursError: (value: string) => void;
  setHoursConflict: (value: boolean) => void;

  // Account handlers
  loadPharmacy: (signal?: AbortSignal) => Promise<void>;
  handleChange: (field: keyof AccountFormState, value: string) => void;
  handleSubmit: (e: FormEvent) => Promise<void>;
  handleReloadAccount: () => Promise<void>;
  handleToggleActive: () => Promise<void>;
  handleVerify: (approved: boolean, reason?: string) => Promise<void>;
  navigateToList: () => void;

  // Business hours handlers
  handleReloadBusinessHours: () => Promise<void>;
  handleHoursChange: (dayOfWeek: number, field: 'openTime' | 'closeTime', value: string) => void;
  handleClosedChange: (dayOfWeek: number, isClosed: boolean) => void;
  handle24HoursChange: (dayOfWeek: number, is24Hours: boolean) => void;
  handleHoursSave: () => Promise<void>;
  handleHoursEditStart: () => void;
  handleHoursEditCancel: () => void;
  handleAddSpecialHour: () => void;
  handleRemoveSpecialHour: (index: number) => void;
  handleSpecialTypeChange: (index: number, specialType: SpecialType) => void;
  handleSpecialDateChange: (index: number, field: 'startDate' | 'endDate', value: string) => void;
  handleSpecialNoteChange: (index: number, value: string) => void;
  handleSpecialHoursChange: (index: number, field: 'openTime' | 'closeTime', value: string) => void;
  handleSpecialClosedChange: (index: number, isClosed: boolean) => void;
  handleSpecial24HoursChange: (index: number, is24Hours: boolean) => void;
}

export function useAdminPharmacyEdit(): UseAdminPharmacyEditReturn {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const pharmacyId = Number(id);
  const hasValidId = Number.isInteger(pharmacyId) && pharmacyId > 0;

  // --- Account state ---
  const [pharmacy, setPharmacy] = useState<AdminPharmacyData | null>(null);
  const [pharmacyLoaded, setPharmacyLoaded] = useState(false);
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

  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeUpdating, setActiveUpdating] = useState(false);
  const [isTestAccount, setIsTestAccount] = useState(false);
  const [testAccountPassword, setTestAccountPassword] = useState('');
  const [accountConflict, setAccountConflict] = useState(false);
  const [verifyLoading, setVerifyLoading] = useState(false);

  // --- Business hours state ---
  const [businessHours, setBusinessHours] = useState<BusinessHourEntry[]>(createDefaultHours());
  const [savedBusinessHours, setSavedBusinessHours] = useState<BusinessHourEntry[]>(createDefaultHours());
  const [specialHours, setSpecialHours] = useState<SpecialHourEntry[]>([]);
  const [savedSpecialHours, setSavedSpecialHours] = useState<SpecialHourEntry[]>([]);
  const [hoursVersion, setHoursVersion] = useState(1);
  const [hoursLoaded, setHoursLoaded] = useState(false);
  const [hoursLoadFailed, setHoursLoadFailed] = useState(false);
  const [hoursHasRemoteData, setHoursHasRemoteData] = useState(false);
  const hoursHasRemoteDataRef = useRef(false);
  const [hoursEditing, setHoursEditing] = useState(false);
  const [hoursSaving, setHoursSaving] = useState(false);
  const [hoursMessage, setHoursMessage] = useState('');
  const [hoursError, setHoursError] = useState('');
  const [hoursConflict, setHoursConflict] = useState(false);

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

  const isHoursDirty = useMemo(() => {
    if (!hoursEditing) return false;
    return JSON.stringify(businessHours) !== JSON.stringify(savedBusinessHours)
      || JSON.stringify(specialHours) !== JSON.stringify(savedSpecialHours);
  }, [businessHours, savedBusinessHours, specialHours, savedSpecialHours, hoursEditing]);

  const hasUnsavedChanges = isAccountDirty || isHoursDirty;

  // --- Data loading ---
  const loadPharmacy = useCallback(async (signal?: AbortSignal) => {
    if (!hasValidId) return;
    try {
      const data = await api.get<AdminPharmacyData>(`/admin/pharmacies/${pharmacyId}`, { signal });
      if (signal?.aborted) return;

      setPharmacy(data);
      setIsTestAccount(Boolean(data.isTestAccount));
      setTestAccountPassword(data.testAccountPassword ?? '');
      setForm({
        email: data.email,
        name: data.name,
        postalCode: data.postalCode,
        address: data.address,
        phone: data.phone,
        fax: data.fax,
        prefecture: data.prefecture,
        licenseNumber: data.licenseNumber,
        currentPassword: '',
        newPassword: '',
      });
      setAccountConflict(false);
    } catch (err) {
      if (signal?.aborted) return;
      setError(err instanceof Error ? err.message : '薬局情報の取得に失敗しました');
    } finally {
      if (!signal?.aborted) {
        setPharmacyLoaded(true);
      }
    }
  }, [hasValidId, pharmacyId]);

  const loadBusinessHours = useCallback(async (signal?: AbortSignal) => {
    if (!hasValidId) return;
    try {
      const data = await api.get<BusinessHourSettingsResponse>(`/admin/pharmacies/${pharmacyId}/business-hours/settings`, { signal });
      if (signal?.aborted) return;
      const normalizedWeekly = normalizeBusinessHours(data.hours ?? []);
      const normalizedSpecial = normalizeSpecialHours(data.specialHours ?? []);
      setBusinessHours(normalizedWeekly);
      setSavedBusinessHours(normalizedWeekly);
      setSpecialHours(normalizedSpecial);
      setSavedSpecialHours(normalizedSpecial);
      setHoursVersion(data.version ?? 1);
      setHoursLoadFailed(false);
      hoursHasRemoteDataRef.current = true;
      setHoursHasRemoteData(true);
      setHoursError('');
      setHoursConflict(false);
    } catch (err) {
      if (signal?.aborted) return;
      setHoursLoadFailed(true);
      if (!hoursHasRemoteDataRef.current) {
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
  }, [hasValidId, pharmacyId]);

  // --- Effects ---
  useEffect(() => {
    const controller = new AbortController();
    if (hasValidId) {
      void Promise.all([loadPharmacy(controller.signal), loadBusinessHours(controller.signal)]);
    } else {
      setError('薬局IDが不正です');
      setPharmacyLoaded(true);
      setHoursLoaded(true);
    }
    return () => controller.abort();
  }, [hasValidId, loadPharmacy, loadBusinessHours]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsavedChanges]);

  // --- Account handlers ---
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
    setError('');
    setMessage('');
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
      setMessage('薬局情報を更新しました');
      setForm((prev) => ({ ...prev, currentPassword: '', newPassword: '' }));
      setPharmacy((prev) => (prev ? {
        ...prev,
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
        version: result.version,
      } : prev));
    } catch (err) {
      if (isConflictError(err)) {
        setAccountConflict(true);
        const latestData = err.data.latestData as AdminPharmacyData | undefined;
        if (latestData) {
          setPharmacy(latestData);
          setForm({
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
          });
          setIsTestAccount(Boolean(latestData.isTestAccount));
          setTestAccountPassword(latestData.testAccountPassword ?? '');
        }
      } else if (isPartialSuccessError(err)) {
        setError(err.message);
        setForm((prev) => ({ ...prev, currentPassword: '', newPassword: '' }));
        setPharmacy((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
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
            ...(err.data.version ? { version: err.data.version } : {}),
          };
        });
      } else if (isVerificationStatusError(err)) {
        setError('審査ステータスにより操作を実行できません');
      } else {
        setError(err instanceof Error ? err.message : '薬局情報の更新に失敗しました');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleReloadAccount = useCallback(async () => {
    setAccountConflict(false);
    setError('');
    setMessage('');
    await loadPharmacy();
  }, [loadPharmacy]);

  const handleReloadBusinessHours = useCallback(async () => {
    setHoursConflict(false);
    setHoursError('');
    setHoursMessage('');
    setHoursEditing(false);
    setHoursLoadFailed(false);
    await loadBusinessHours();
  }, [loadBusinessHours]);

  const handleToggleActive = async () => {
    if (!hasValidId || !pharmacy) return;
    setError('');
    setMessage('');
    setActiveUpdating(true);
    try {
      const result = await api.put<{ message: string }>(`/admin/pharmacies/${pharmacyId}/toggle-active`);
      setMessage(result.message);
      setPharmacy((prev) => (prev ? { ...prev, isActive: !prev.isActive } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : '状態変更に失敗しました');
    } finally {
      setActiveUpdating(false);
    }
  };

  const handleVerify = async (approved: boolean, reason?: string) => {
    setVerifyLoading(true);
    try {
      await api.post(`/admin/pharmacies/${pharmacyId}/verify`, {
        approved,
        reason: reason || undefined,
      });
      const updated = await api.get<AdminPharmacyData>(`/admin/pharmacies/${pharmacyId}`);
      setPharmacy(updated);
      setMessage(approved ? '薬局を承認しました' : '薬局を却下しました');
    } catch (err) {
      alert(err instanceof Error ? err.message : '審査処理に失敗しました');
    } finally {
      setVerifyLoading(false);
    }
  };

  const navigateToList = useCallback(() => {
    if (hasUnsavedChanges && !window.confirm('未保存の変更があります。保存せずに一覧へ戻りますか？')) {
      return;
    }
    navigate('/admin/pharmacies');
  }, [hasUnsavedChanges, navigate]);

  // --- Business hours handlers ---
  const handleHoursChange = useCallback((dayOfWeek: number, field: 'openTime' | 'closeTime', value: string) => {
    setBusinessHours((prev) =>
      prev.map((h) => h.dayOfWeek === dayOfWeek ? { ...h, [field]: value } : h),
    );
  }, []);

  const handleClosedChange = useCallback((dayOfWeek: number, isClosed: boolean) => {
    setBusinessHours((prev) =>
      prev.map((h) => h.dayOfWeek === dayOfWeek
        ? {
          ...h,
          isClosed,
          is24Hours: false,
          openTime: isClosed ? null : (h.openTime || '09:00'),
          closeTime: isClosed ? null : (h.closeTime || '18:00'),
        }
        : h),
    );
  }, []);

  const handle24HoursChange = useCallback((dayOfWeek: number, is24Hours: boolean) => {
    setBusinessHours((prev) =>
      prev.map((h) => h.dayOfWeek === dayOfWeek
        ? {
          ...h,
          is24Hours,
          isClosed: false,
          openTime: is24Hours ? null : (h.openTime || '09:00'),
          closeTime: is24Hours ? null : (h.closeTime || '18:00'),
        }
        : h),
    );
  }, []);

  const handleHoursSave = async () => {
    if (!hasValidId) return;
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
      const result = await api.put<{ message: string; version: number }>(`/admin/pharmacies/${pharmacyId}/business-hours`, {
        hours: businessHours,
        specialHours: payloadSpecialHours,
        version: hoursVersion,
      });
      const normalizedSpecial = normalizeSpecialHours(specialHours);
      setSpecialHours(normalizedSpecial);
      setSavedBusinessHours(businessHours);
      setSavedSpecialHours(normalizedSpecial);
      setHoursEditing(false);
      setHoursMessage('営業時間を更新しました');
      if (result.version) {
        setHoursVersion(result.version);
        setPharmacy((prev) => (prev ? { ...prev, version: result.version } : prev));
      }
    } catch (err) {
      if (isConflictError(err)) {
        setHoursConflict(true);
        const latestData = err.data.latestData as BusinessHourSettingsResponse | undefined;
        if (latestData) {
          const normalizedWeekly = normalizeBusinessHours(latestData.hours ?? []);
          const normalizedSpecial = normalizeSpecialHours(latestData.specialHours ?? []);
          setBusinessHours(normalizedWeekly);
          setSavedBusinessHours(normalizedWeekly);
          setSpecialHours(normalizedSpecial);
          setSavedSpecialHours(normalizedSpecial);
          setHoursVersion(latestData.version ?? 1);
          setPharmacy((prev) => (prev ? { ...prev, version: latestData.version ?? prev.version } : prev));
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

  return {
    pharmacy,
    pharmacyLoaded,
    hasValidId,
    form,
    message,
    setMessage,
    error,
    setError,
    loading,
    accountConflict,
    setAccountConflict,
    isAccountDirty,
    isTestAccount,
    testAccountPassword,
    setTestAccountPassword,
    handleTestAccountToggle,
    activeUpdating,
    verifyLoading,
    businessHours,
    specialHours,
    hoursLoaded,
    hoursEditing,
    hoursLoadFailed,
    hoursSaving,
    hoursMessage,
    hoursError,
    hoursConflict,
    setHoursMessage,
    setHoursError,
    setHoursConflict,
    loadPharmacy,
    handleChange,
    handleSubmit,
    handleReloadAccount,
    handleReloadBusinessHours,
    handleToggleActive,
    handleVerify,
    navigateToList,
    handleHoursChange,
    handleClosedChange,
    handle24HoursChange,
    handleHoursSave,
    handleHoursEditStart,
    handleHoursEditCancel,
    handleAddSpecialHour,
    handleRemoveSpecialHour,
    handleSpecialTypeChange,
    handleSpecialDateChange,
    handleSpecialNoteChange,
    handleSpecialHoursChange,
    handleSpecialClosedChange,
    handleSpecial24HoursChange,
  };
}
