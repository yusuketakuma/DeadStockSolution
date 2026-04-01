import { useEffect, useCallback } from 'react';
import type { FormEvent } from 'react';
import { useAdminPharmacyData } from './useAdminPharmacyData';
import { useAdminPharmacyForm } from './useAdminPharmacyForm';
import { useAdminBusinessHours } from './useAdminBusinessHours';
import type { AdminPharmacyData } from './useAdminPharmacyEdit.types';

// 型を re-export（既存の import パスを維持）
export type { AdminPharmacyData, UseAdminPharmacyEditReturn } from './useAdminPharmacyEdit.types';

export function useAdminPharmacyEdit() {
  // --- Sub-hooks ---
  const {
    pharmacyId, hasValidId, pharmacy, setPharmacy,
    pharmacyLoaded, setPharmacyLoaded,
    error, setError, message, setMessage,
    activeUpdating, verifyLoading, navigate,
    handleToggleActive, handleVerify,
  } = useAdminPharmacyData();

  const formHook = useAdminPharmacyForm({
    pharmacyId,
    hasValidId,
    pharmacy,
    setPharmacy,
  });

  const hoursHook = useAdminBusinessHours({
    pharmacyId,
    hasValidId,
    setPharmacy,
  });

  // --- loadPharmacy をフォーム同期付きでラップ ---
  const loadPharmacy = useCallback(async (signal?: AbortSignal) => {
    if (!hasValidId) return;
    const { api } = await import('../api/client');
    try {
      const fetchedData = await api.get<AdminPharmacyData>(`/admin/pharmacies/${pharmacyId}`, { signal });
      if (signal?.aborted) return;
      setPharmacy(fetchedData);
      formHook.syncFormFromPharmacy(fetchedData);
    } catch (err) {
      if (signal?.aborted) return;
      setError(err instanceof Error ? err.message : '薬局情報の取得に失敗しました');
    } finally {
      if (!signal?.aborted) {
        setPharmacyLoaded(true);
      }
    }
  }, [hasValidId, pharmacyId, setPharmacy, setPharmacyLoaded, setError, formHook.syncFormFromPharmacy]);

  // --- handleSubmit をメッセージ制御付きでラップ ---
  const handleSubmit = useCallback(async (e: FormEvent) => {
    setError('');
    setMessage('');
    try {
      await formHook.handleSubmit(e);
      setMessage('薬局情報を更新しました');
    } catch (err) {
      if (err && typeof err === 'object' && 'status' in err) {
        const httpErr = err as { status?: number; message?: string };
        if (httpErr.status === 409) {
          // conflict — formHook already updated form state (ConflictAlert handles UI)
        } else if (httpErr.status === 207) {
          setError(httpErr.message || '薬局情報の更新に一部失敗しました');
        } else {
          setError(err instanceof Error ? err.message : '薬局情報の更新に失敗しました');
        }
      } else {
        setError(err instanceof Error ? err.message : '薬局情報の更新に失敗しました');
      }
    }
  }, [formHook.handleSubmit, setError, setMessage]);

  // --- handleReloadAccount ---
  const handleReloadAccount = useCallback(async () => {
    formHook.setAccountConflict(false);
    setError('');
    setMessage('');
    await loadPharmacy();
  }, [loadPharmacy, formHook.setAccountConflict, setError, setMessage]);

  // --- hasUnsavedChanges（navigateToList + beforeunload で利用） ---
  const hasUnsavedChanges = formHook.isAccountDirty || hoursHook.isHoursDirty;

  const navigateToList = useCallback(() => {
    if (hasUnsavedChanges && !window.confirm('未保存の変更があります。保存せずに一覧へ戻りますか？')) {
      return;
    }
    navigate('/admin/pharmacies');
  }, [hasUnsavedChanges, navigate]);

  // --- Effects ---
  useEffect(() => {
    const controller = new AbortController();
    if (hasValidId) {
      void Promise.all([loadPharmacy(controller.signal), hoursHook.loadBusinessHours(controller.signal)]);
    } else {
      setError('薬局IDが不正です');
      setPharmacyLoaded(true);
      hoursHook.setHoursLoaded(true);
    }
    return () => controller.abort();
  }, [hasValidId, loadPharmacy, hoursHook.loadBusinessHours]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsavedChanges]);

  // --- 同一 API を返す ---
  return {
    pharmacy, pharmacyLoaded, hasValidId,
    form: formHook.form, message, setMessage, error, setError,
    loading: formHook.loading,
    accountConflict: formHook.accountConflict,
    setAccountConflict: formHook.setAccountConflict,
    isAccountDirty: formHook.isAccountDirty,
    isTestAccount: formHook.isTestAccount,
    testAccountPassword: formHook.testAccountPassword,
    setTestAccountPassword: formHook.setTestAccountPassword,
    handleTestAccountToggle: formHook.handleTestAccountToggle,
    activeUpdating, verifyLoading,
    businessHours: hoursHook.businessHours,
    specialHours: hoursHook.specialHours,
    hoursLoaded: hoursHook.hoursLoaded,
    hoursEditing: hoursHook.hoursEditing,
    hoursLoadFailed: hoursHook.hoursLoadFailed,
    hoursSaving: hoursHook.hoursSaving,
    hoursMessage: hoursHook.hoursMessage,
    hoursError: hoursHook.hoursError,
    hoursConflict: hoursHook.hoursConflict,
    setHoursMessage: hoursHook.setHoursMessage,
    setHoursError: hoursHook.setHoursError,
    setHoursConflict: hoursHook.setHoursConflict,
    loadPharmacy, handleChange: formHook.handleChange, handleSubmit,
    handleReloadAccount,
    handleReloadBusinessHours: hoursHook.handleReloadBusinessHours,
    handleToggleActive, handleVerify, navigateToList,
    handleHoursChange: hoursHook.handleHoursChange,
    handleClosedChange: hoursHook.handleClosedChange,
    handle24HoursChange: hoursHook.handle24HoursChange,
    handleHoursSave: hoursHook.handleHoursSave,
    handleHoursEditStart: hoursHook.handleHoursEditStart,
    handleHoursEditCancel: hoursHook.handleHoursEditCancel,
    handleAddSpecialHour: hoursHook.handleAddSpecialHour,
    handleRemoveSpecialHour: hoursHook.handleRemoveSpecialHour,
    handleSpecialTypeChange: hoursHook.handleSpecialTypeChange,
    handleSpecialDateChange: hoursHook.handleSpecialDateChange,
    handleSpecialNoteChange: hoursHook.handleSpecialNoteChange,
    handleSpecialHoursChange: hoursHook.handleSpecialHoursChange,
    handleSpecialClosedChange: hoursHook.handleSpecialClosedChange,
    handleSpecial24HoursChange: hoursHook.handleSpecial24HoursChange,
  };
}
