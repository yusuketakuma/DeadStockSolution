import type { FormEvent } from 'react';
import type { AccountFormState } from '../components/account/AccountInfoForm';
import {
  type BusinessHourEntry,
  type SpecialHourEntry,
  type SpecialType,
} from '../components/account/types';

/** 営業時間のバリデーション。エラーメッセージを返す。問題なければ null。 */
export function validateBusinessHoursData(
  businessHours: BusinessHourEntry[],
  specialHours: SpecialHourEntry[],
): string | null {
  if (specialHours.find((e) => e.startDate > e.endDate)) {
    return '特例営業時間の開始日と終了日の順序が不正です';
  }
  if (businessHours.find((e) => !e.isClosed && !e.is24Hours && (!e.openTime || !e.closeTime || e.openTime === e.closeTime))) {
    return '通常営業時間の開店時間・閉店時間を正しく入力してください';
  }
  if (specialHours.find((e) => e.specialType === 'special_open' && !e.isClosed && !e.is24Hours && (!e.openTime || !e.closeTime || e.openTime === e.closeTime))) {
    return '特別営業時間の開店時間・閉店時間を正しく入力してください';
  }
  return null;
}

/** 特例営業時間を API 送信用ペイロードに変換 */
export function buildSpecialHoursPayload(specialHours: SpecialHourEntry[]) {
  return specialHours.map((entry) => ({
    specialType: entry.specialType,
    startDate: entry.startDate,
    endDate: entry.endDate,
    openTime: entry.isClosed || entry.is24Hours ? null : entry.openTime,
    closeTime: entry.isClosed || entry.is24Hours ? null : entry.closeTime,
    isClosed: entry.isClosed,
    is24Hours: entry.is24Hours,
    note: entry.note?.trim() || null,
  }));
}

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

export interface UseAdminBusinessHoursParams {
  pharmacyId: number;
  hasValidId: boolean;
  setPharmacy: React.Dispatch<React.SetStateAction<AdminPharmacyData | null>>;
}

export interface UseAdminBusinessHoursReturn {
  businessHours: BusinessHourEntry[];
  specialHours: SpecialHourEntry[];
  hoursLoaded: boolean;
  setHoursLoaded: React.Dispatch<React.SetStateAction<boolean>>;
  hoursEditing: boolean;
  hoursLoadFailed: boolean;
  hoursSaving: boolean;
  hoursMessage: string;
  hoursError: string;
  hoursConflict: boolean;
  setHoursMessage: (value: string) => void;
  setHoursError: (value: string) => void;
  setHoursConflict: (value: boolean) => void;
  isHoursDirty: boolean;
  loadBusinessHours: (signal?: AbortSignal) => Promise<void>;
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
  navigateToHealth: () => void;
  navigateToBusinessHours: () => void;
  navigateToRelationships: () => void;

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
