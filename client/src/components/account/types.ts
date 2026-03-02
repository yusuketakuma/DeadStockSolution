export const PREFECTURES = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県',
  '岐阜県', '静岡県', '愛知県', '三重県',
  '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
  '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県',
  '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県',
];

export const DAY_NAMES = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];

export interface AccountData {
  id: number;
  email: string;
  name: string;
  postalCode: string;
  address: string;
  phone: string;
  fax: string;
  licenseNumber: string;
  prefecture: string;
  version: number;
  verificationStatus?: string;
  matchingAutoNotifyEnabled?: boolean;
}

export interface BusinessHourEntry {
  dayOfWeek: number;
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean;
  is24Hours: boolean;
}

export type SpecialType = 'holiday_closed' | 'long_holiday_closed' | 'temporary_closed' | 'special_open';

export interface SpecialHourEntry {
  id?: number;
  clientId?: string;
  specialType: SpecialType;
  startDate: string;
  endDate: string;
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean;
  is24Hours: boolean;
  note: string | null;
}

export interface BusinessHourSettingsResponse {
  hours: BusinessHourEntry[];
  specialHours: SpecialHourEntry[];
  version: number;
}

export const SPECIAL_TYPE_LABELS: Record<SpecialType, string> = {
  holiday_closed: '祝日休業',
  long_holiday_closed: '大型連休休業',
  temporary_closed: '臨時休業',
  special_open: '特別営業時間',
};

export function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function createDefaultSpecialHour(): SpecialHourEntry {
  const today = toDateInputValue(new Date());
  return {
    specialType: 'holiday_closed',
    startDate: today,
    endDate: today,
    openTime: null,
    closeTime: null,
    isClosed: true,
    is24Hours: false,
    note: null,
  };
}

export function createDefaultHours(): BusinessHourEntry[] {
  return Array.from({ length: 7 }, (_, i) => ({
    dayOfWeek: i,
    openTime: i === 0 ? null : '09:00',
    closeTime: i === 0 ? null : '18:00',
    isClosed: i === 0,
    is24Hours: false,
  }));
}

export function normalizeBusinessHours(hours: BusinessHourEntry[]): BusinessHourEntry[] {
  const defaults = createDefaultHours();
  const byDay = new Map(
    hours
      .filter((h) => Number.isInteger(h.dayOfWeek) && h.dayOfWeek >= 0 && h.dayOfWeek <= 6)
      .map((h) => [h.dayOfWeek, h] as const),
  );

  return defaults.map((def) => {
    const found = byDay.get(def.dayOfWeek);
    if (!found) return def;

    const isClosed = Boolean(found.isClosed);
    const is24Hours = !isClosed && Boolean(found.is24Hours);
    return {
      dayOfWeek: def.dayOfWeek,
      isClosed,
      is24Hours,
      openTime: isClosed || is24Hours ? null : found.openTime ?? def.openTime,
      closeTime: isClosed || is24Hours ? null : found.closeTime ?? def.closeTime,
    };
  });
}

export function formatHours(entry: BusinessHourEntry): string {
  if (entry.isClosed) return '定休日';
  if (entry.is24Hours) return '24時間営業';
  if (entry.openTime && entry.closeTime) return `${entry.openTime} - ${entry.closeTime}`;
  return '未設定';
}

export function normalizeSpecialHours(entries: SpecialHourEntry[]): SpecialHourEntry[] {
  const validTypes: SpecialType[] = ['holiday_closed', 'long_holiday_closed', 'temporary_closed', 'special_open'];
  return [...entries]
    .filter(
      (entry) =>
        entry &&
        typeof entry.startDate === 'string' &&
        typeof entry.endDate === 'string' &&
        validTypes.includes(entry.specialType),
    )
    .map((entry) => {
      const isClosed = entry.specialType === 'special_open' ? Boolean(entry.isClosed) : true;
      const is24Hours = entry.specialType === 'special_open' && !isClosed && Boolean(entry.is24Hours);
      return {
        id: entry.id,
        specialType: entry.specialType,
        startDate: entry.startDate,
        endDate: entry.endDate,
        openTime: isClosed || is24Hours ? null : entry.openTime ?? '09:00',
        closeTime: isClosed || is24Hours ? null : entry.closeTime ?? '18:00',
        isClosed,
        is24Hours,
        note: entry.note ?? null,
      };
    })
    .sort((a, b) => {
      if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate);
      if (a.endDate !== b.endDate) return a.endDate.localeCompare(b.endDate);
      return (a.id ?? 0) - (b.id ?? 0);
    });
}

export function formatSpecialHours(entry: SpecialHourEntry): string {
  if (entry.isClosed) return '休業';
  if (entry.is24Hours) return '24時間営業';
  if (entry.openTime && entry.closeTime) return `${entry.openTime} - ${entry.closeTime}`;
  return '未設定';
}
