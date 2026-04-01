import { useCallback } from 'react';
import {
  createDefaultSpecialHour,
  type SpecialHourEntry,
  type SpecialType,
} from '../components/account/types';

export interface UseAdminSpecialHoursParams {
  setSpecialHours: React.Dispatch<React.SetStateAction<SpecialHourEntry[]>>;
}

export interface UseAdminSpecialHoursReturn {
  handleAddSpecialHour: () => void;
  handleRemoveSpecialHour: (index: number) => void;
  handleSpecialTypeChange: (index: number, specialType: SpecialType) => void;
  handleSpecialDateChange: (index: number, field: 'startDate' | 'endDate', value: string) => void;
  handleSpecialNoteChange: (index: number, value: string) => void;
  handleSpecialHoursChange: (index: number, field: 'openTime' | 'closeTime', value: string) => void;
  handleSpecialClosedChange: (index: number, isClosed: boolean) => void;
  handleSpecial24HoursChange: (index: number, is24Hours: boolean) => void;
}

/**
 * 特例営業時間の編集ハンドラーフック
 */
export function useAdminSpecialHours({
  setSpecialHours,
}: UseAdminSpecialHoursParams): UseAdminSpecialHoursReturn {
  const handleAddSpecialHour = useCallback(() => {
    setSpecialHours((prev) => [...prev, { ...createDefaultSpecialHour(), clientId: crypto.randomUUID() }]);
  }, [setSpecialHours]);

  const handleRemoveSpecialHour = useCallback((index: number) => {
    setSpecialHours((prev) => prev.filter((_, i) => i !== index));
  }, [setSpecialHours]);

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
  }, [setSpecialHours]);

  const handleSpecialDateChange = useCallback((index: number, field: 'startDate' | 'endDate', value: string) => {
    setSpecialHours((prev) =>
      prev.map((entry, i) => (i === index ? { ...entry, [field]: value } : entry)),
    );
  }, [setSpecialHours]);

  const handleSpecialNoteChange = useCallback((index: number, value: string) => {
    setSpecialHours((prev) =>
      prev.map((entry, i) => (i === index ? { ...entry, note: value || null } : entry)),
    );
  }, [setSpecialHours]);

  const handleSpecialHoursChange = useCallback((index: number, field: 'openTime' | 'closeTime', value: string) => {
    setSpecialHours((prev) =>
      prev.map((entry, i) => (i === index ? { ...entry, [field]: value } : entry)),
    );
  }, [setSpecialHours]);

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
  }, [setSpecialHours]);

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
  }, [setSpecialHours]);

  return {
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
