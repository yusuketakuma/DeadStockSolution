import { useState, useCallback, useMemo } from 'react';
import { api, isConflictError } from '../api/client';
import {
  type UseAdminBusinessHoursParams,
  type UseAdminBusinessHoursReturn,
  validateBusinessHoursData,
  buildSpecialHoursPayload,
} from './useAdminPharmacyEdit.types';
import {
  type BusinessHourEntry,
  type BusinessHourSettingsResponse,
  createDefaultHours,
  normalizeBusinessHours,
  normalizeSpecialHours,
  type SpecialHourEntry,
} from '../components/account/types';
import { useAdminSpecialHours } from './useAdminSpecialHours';

/**
 * 営業時間（通常・特例）の状態管理フック
 */
export function useAdminBusinessHours({
  pharmacyId,
  hasValidId,
  setPharmacy,
}: UseAdminBusinessHoursParams): UseAdminBusinessHoursReturn {
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
  const [hoursConflict, setHoursConflict] = useState(false);

  // --- 特例営業時間ハンドラー（サブフック） ---
  const specialHoursHandlers = useAdminSpecialHours({ setSpecialHours });

  // --- Derived state ---
  const isHoursDirty = useMemo(() => {
    if (!hoursEditing) return false;
    return JSON.stringify(businessHours) !== JSON.stringify(savedBusinessHours)
      || JSON.stringify(specialHours) !== JSON.stringify(savedSpecialHours);
  }, [businessHours, savedBusinessHours, specialHours, savedSpecialHours, hoursEditing]);

  // --- データ取得 ---
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
  }, [hasValidId, pharmacyId, hoursHasRemoteData]);

  const handleReloadBusinessHours = useCallback(async () => {
    setHoursConflict(false);
    setHoursError('');
    setHoursMessage('');
    setHoursEditing(false);
    setHoursLoadFailed(false);
    await loadBusinessHours();
  }, [loadBusinessHours]);

  // --- 通常営業時間ハンドラー ---
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

  // --- 保存 ---
  const handleHoursSave = async () => {
    if (!hasValidId) return;
    if (hoursLoadFailed || !hoursHasRemoteData) {
      setHoursError('営業時間データを取得できていないため保存できません。再読み込みしてください。');
      return;
    }
    setHoursError('');
    setHoursMessage('');
    setHoursConflict(false);

    const validationError = validateBusinessHoursData(businessHours, specialHours);
    if (validationError) {
      setHoursError(validationError);
      return;
    }

    setHoursSaving(true);
    try {
      const result = await api.put<{ message: string; version: number }>(`/admin/pharmacies/${pharmacyId}/business-hours`, {
        hours: businessHours,
        specialHours: buildSpecialHoursPayload(specialHours),
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

  // --- 編集制御 ---
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

  return {
    businessHours, specialHours,
    hoursLoaded, setHoursLoaded, hoursEditing, hoursLoadFailed, hoursSaving,
    hoursMessage, hoursError, hoursConflict,
    setHoursMessage, setHoursError, setHoursConflict, isHoursDirty,
    loadBusinessHours, handleReloadBusinessHours,
    handleHoursChange, handleClosedChange, handle24HoursChange,
    handleHoursSave, handleHoursEditStart, handleHoursEditCancel,
    ...specialHoursHandlers,
  };
}
