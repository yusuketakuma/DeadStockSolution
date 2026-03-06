import { useState, useCallback, useMemo } from 'react';
import { api, isConflictError } from '../api/client';
import { useAutoSave, type AutoSaveResult } from './useAutoSave';
import {
  type BusinessHourEntry,
  type BusinessHourSettingsResponse,
  type SpecialHourEntry,
  type SpecialType,
  createDefaultHours,
  createDefaultSpecialHour,
  normalizeBusinessHours,
  normalizeSpecialHours,
} from '../components/account/types';

/** 営業時間の自動保存対象 */
export interface BusinessHoursDraftData {
  businessHours: BusinessHourEntry[];
  specialHours: SpecialHourEntry[];
}

interface UseBusinessHoursFormOptions {
  userId?: number | string;
}

export interface UseBusinessHoursFormReturn {
  businessHours: BusinessHourEntry[];
  specialHours: SpecialHourEntry[];
  hoursVersion: number;
  hoursLoaded: boolean;
  hoursLoadFailed: boolean;
  hoursHasRemoteData: boolean;
  hoursEditing: boolean;
  hoursSaving: boolean;
  hoursMessage: string;
  hoursError: string;
  hoursConflict: boolean;
  setHoursMessage: (message: string) => void;
  setHoursError: (error: string) => void;
  setHoursConflict: (value: boolean) => void;
  loadBusinessHours: (signal?: AbortSignal) => Promise<void>;
  handleHoursChange: (dayOfWeek: number, field: 'openTime' | 'closeTime', value: string) => void;
  handleClosedChange: (dayOfWeek: number, isClosed: boolean) => void;
  handle24HoursChange: (dayOfWeek: number, is24Hours: boolean) => void;
  handleHoursSave: () => Promise<void>;
  handleHoursEditStart: () => void;
  handleHoursEditCancel: () => void;
  handleReloadBusinessHours: () => Promise<void>;
  handleAddSpecialHour: () => void;
  handleRemoveSpecialHour: (index: number) => void;
  handleSpecialTypeChange: (index: number, specialType: SpecialType) => void;
  handleSpecialDateChange: (index: number, field: 'startDate' | 'endDate', value: string) => void;
  handleSpecialNoteChange: (index: number, value: string) => void;
  handleSpecialHoursChange: (index: number, field: 'openTime' | 'closeTime', value: string) => void;
  handleSpecialClosedChange: (index: number, isClosed: boolean) => void;
  handleSpecial24HoursChange: (index: number, is24Hours: boolean) => void;
  hoursAutoSave: AutoSaveResult<BusinessHoursDraftData>;
  hoursDraftData: BusinessHoursDraftData;
  handleHoursDraftRestore: () => void;
  handleHoursDraftDiscard: () => void;
}

export function useBusinessHoursForm({ userId }: UseBusinessHoursFormOptions): UseBusinessHoursFormReturn {
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

  // 営業時間の自動保存対象データ
  const hoursDraftData = useMemo<BusinessHoursDraftData>(() => ({
    businessHours,
    specialHours,
  }), [businessHours, specialHours]);

  const hoursAutoSave = useAutoSave<BusinessHoursDraftData>('business-hours', hoursDraftData, {
    userId,
    enabled: hoursLoaded && hoursEditing,
  });

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
      // Use functional state update to avoid dependency on hoursHasRemoteData
      setHoursHasRemoteData((prev) => {
        if (!prev) {
          setBusinessHours([]);
          setSavedBusinessHours([]);
          setSpecialHours([]);
          setSavedSpecialHours([]);
        }
        return prev;
      });
      setHoursEditing(false);
      setHoursError(err instanceof Error ? err.message : '営業時間の取得に失敗しました');
    } finally {
      if (!signal?.aborted) {
        setHoursLoaded(true);
      }
    }
  }, []);

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
    // Need to read current state values - use refs pattern via state reads
    // We access hoursLoadFailed and hoursHasRemoteData directly (they're in closure)
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

  const handleReloadBusinessHours = useCallback(async () => {
    setHoursConflict(false);
    setHoursError('');
    setHoursMessage('');
    setHoursEditing(false);
    setHoursLoadFailed(false);
    await loadBusinessHours();
  }, [loadBusinessHours]);

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
    businessHours,
    specialHours,
    hoursVersion,
    hoursLoaded,
    hoursLoadFailed,
    hoursHasRemoteData,
    hoursEditing,
    hoursSaving,
    hoursMessage,
    hoursError,
    hoursConflict,
    setHoursMessage,
    setHoursError,
    setHoursConflict,
    loadBusinessHours,
    handleHoursChange,
    handleClosedChange,
    handle24HoursChange,
    handleHoursSave,
    handleHoursEditStart,
    handleHoursEditCancel,
    handleReloadBusinessHours,
    handleAddSpecialHour,
    handleRemoveSpecialHour,
    handleSpecialTypeChange,
    handleSpecialDateChange,
    handleSpecialNoteChange,
    handleSpecialHoursChange,
    handleSpecialClosedChange,
    handleSpecial24HoursChange,
    hoursAutoSave,
    hoursDraftData,
    handleHoursDraftRestore,
    handleHoursDraftDiscard,
  };
}
