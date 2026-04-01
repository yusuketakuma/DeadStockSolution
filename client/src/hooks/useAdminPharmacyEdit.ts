import { useEffect, useCallback } from 'react';
import type { FormEvent } from 'react';
import { api } from '../api/client';
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

  const {
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
    handleSubmit: submitAccountForm,
    syncFormFromPharmacy,
  } = useAdminPharmacyForm({
    pharmacyId,
    hasValidId,
    pharmacy,
    setPharmacy,
  });

  const {
    businessHours,
    specialHours,
    hoursLoaded,
    setHoursLoaded,
    hoursEditing,
    hoursLoadFailed,
    hoursSaving,
    hoursMessage,
    hoursError,
    hoursConflict,
    setHoursMessage,
    setHoursError,
    setHoursConflict,
    isHoursDirty,
    loadBusinessHours,
    handleReloadBusinessHours,
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
  } = useAdminBusinessHours({
    pharmacyId,
    hasValidId,
    setPharmacy,
  });

  // --- loadPharmacy をフォーム同期付きでラップ ---
  const loadPharmacy = useCallback(async (signal?: AbortSignal) => {
    if (!hasValidId) return;
    try {
      const fetchedData = await api.get<AdminPharmacyData>(`/admin/pharmacies/${pharmacyId}`, { signal });
      if (signal?.aborted) return;
      setPharmacy(fetchedData);
      syncFormFromPharmacy(fetchedData);
    } catch (err) {
      if (signal?.aborted) return;
      setError(err instanceof Error ? err.message : '薬局情報の取得に失敗しました');
    } finally {
      if (!signal?.aborted) {
        setPharmacyLoaded(true);
      }
    }
  }, [hasValidId, pharmacyId, setPharmacy, syncFormFromPharmacy, setError, setPharmacyLoaded]);

  // --- handleSubmit をメッセージ制御付きでラップ ---
  const handleSubmit = useCallback(async (e: FormEvent) => {
    setError('');
    setMessage('');
    try {
      await submitAccountForm(e);
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
  }, [submitAccountForm, setError, setMessage]);

  // --- handleReloadAccount ---
  const handleReloadAccount = useCallback(async () => {
    setAccountConflict(false);
    setError('');
    setMessage('');
    await loadPharmacy();
  }, [loadPharmacy, setAccountConflict, setError, setMessage]);

  // --- hasUnsavedChanges（navigateToList + beforeunload で利用） ---
  const hasUnsavedChanges = isAccountDirty || isHoursDirty;

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
      void Promise.all([loadPharmacy(controller.signal), loadBusinessHours(controller.signal)]);
    } else {
      setError('薬局IDが不正です');
      setPharmacyLoaded(true);
      setHoursLoaded(true);
    }
    return () => controller.abort();
  }, [hasValidId, loadPharmacy, loadBusinessHours, setError, setPharmacyLoaded, setHoursLoaded]);

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
    form, message, setMessage, error, setError,
    loading,
    accountConflict,
    setAccountConflict,
    isAccountDirty,
    isTestAccount,
    testAccountPassword,
    setTestAccountPassword,
    handleTestAccountToggle,
    activeUpdating, verifyLoading,
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
    loadPharmacy, handleChange, handleSubmit,
    handleReloadAccount,
    handleReloadBusinessHours,
    handleToggleActive, handleVerify, navigateToList,
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
