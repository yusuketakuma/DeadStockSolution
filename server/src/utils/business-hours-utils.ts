import type { BusinessHoursStatus } from '../types';

export type { BusinessHoursStatus };

interface BusinessHourEntry {
  dayOfWeek: number;
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean | null;
  is24Hours?: boolean | null;
}

export interface SpecialBusinessHourEntry {
  id?: number;
  specialType?: string;
  startDate: string;
  endDate: string;
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean | null;
  is24Hours?: boolean | null;
  note?: string | null;
  updatedAt?: string | null;
}

interface EffectiveBusinessHoursEntry {
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean;
  is24Hours: boolean;
}

interface OpenCloseLike {
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean | null;
  is24Hours?: boolean | null;
}

/** Minutes before closing to trigger "closing soon" warning */
const CLOSING_SOON_MINUTES = 60;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parse "HH:MM" into total minutes since midnight.
 */
function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function toJstDate(now: Date): Date {
  // Use Intl.DateTimeFormat to get JST components reliably across all environments
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? '00';
  // Create ISO string with explicit +09:00 timezone - parsed consistently in any environment
  return new Date(`${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}+09:00`);
}

function formatJstDate(now: Date): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

function addDaysJst(now: Date, deltaDays: number): Date {
  const jst = toJstDate(now);
  jst.setDate(jst.getDate() + deltaDays);
  return jst;
}

function toEffectiveEntry(entry: OpenCloseLike | undefined): EffectiveBusinessHoursEntry | null {
  if (!entry) return null;
  const isClosed = Boolean(entry.isClosed);
  const is24Hours = !isClosed && Boolean(entry.is24Hours);
  if (isClosed) {
    return { isClosed: true, is24Hours: false, openTime: null, closeTime: null };
  }
  if (is24Hours) {
    return { isClosed: false, is24Hours: true, openTime: null, closeTime: null };
  }
  if (!entry.openTime || !entry.closeTime) {
    return null;
  }
  return {
    isClosed: false,
    is24Hours: false,
    openTime: entry.openTime,
    closeTime: entry.closeTime,
  };
}

function toEffectiveWeeklyEntry(entry: BusinessHourEntry | undefined): EffectiveBusinessHoursEntry | null {
  return toEffectiveEntry(entry);
}

function isValidDateString(value: string): boolean {
  return DATE_REGEX.test(value);
}

function rangeSpanDays(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.floor((end - start) / (24 * 60 * 60 * 1000)));
}

function specialPriority(entry: SpecialBusinessHourEntry): number {
  if (entry.isClosed) return 3;
  if (entry.is24Hours) return 2;
  return 1;
}

function pickSpecialEntryForDate(
  dateKey: string,
  specialHours: SpecialBusinessHourEntry[],
): SpecialBusinessHourEntry | null {
  const matched = specialHours.filter((entry) => {
    if (!isValidDateString(entry.startDate) || !isValidDateString(entry.endDate)) {
      return false;
    }
    if (entry.startDate > entry.endDate) {
      return false;
    }
    return dateKey >= entry.startDate && dateKey <= entry.endDate;
  });

  if (matched.length === 0) return null;

  matched.sort((a, b) => {
    const rangeA = rangeSpanDays(a.startDate, a.endDate);
    const rangeB = rangeSpanDays(b.startDate, b.endDate);
    if (rangeA !== rangeB) return rangeA - rangeB;

    const priorityA = specialPriority(a);
    const priorityB = specialPriority(b);
    if (priorityA !== priorityB) return priorityB - priorityA;

    return (b.id ?? 0) - (a.id ?? 0);
  });

  return matched[0];
}

function toEffectiveSpecialEntry(entry: SpecialBusinessHourEntry): EffectiveBusinessHoursEntry | null {
  return toEffectiveEntry(entry);
}

function resolveEntryForDate(
  dateKey: string,
  dayOfWeek: number,
  weeklyHours: BusinessHourEntry[],
  specialHours: SpecialBusinessHourEntry[],
): EffectiveBusinessHoursEntry | null {
  const special = pickSpecialEntryForDate(dateKey, specialHours);
  if (special) {
    return toEffectiveSpecialEntry(special);
  }
  const weekly = weeklyHours.find((h) => h.dayOfWeek === dayOfWeek);
  return toEffectiveWeeklyEntry(weekly);
}

/**
 * Check if a pharmacy is currently open based on its business hours.
 * Returns open/closed status and whether it's closing soon (within 1 hour).
 *
 * - No weekly/special hours registered → assumed always open.
 * - Supports overnight spans (e.g. 22:00–06:00) where closeTime < openTime.
 */
export function getBusinessHoursStatus(
  hours: BusinessHourEntry[],
  specialHoursOrNow: SpecialBusinessHourEntry[] | Date = [],
  nowArg: Date = new Date(),
): BusinessHoursStatus {
  const specialHours = Array.isArray(specialHoursOrNow) ? specialHoursOrNow : [];
  const now = specialHoursOrNow instanceof Date ? specialHoursOrNow : nowArg;

  if (hours.length === 0 && specialHours.length === 0) {
    // No business hours set = assume always open
    return { isOpen: true, closingSoon: false, is24Hours: false, todayHours: null };
  }

  const jstNow = toJstDate(now);
  const todayDate = formatJstDate(jstNow);
  const yesterdayDate = formatJstDate(addDaysJst(jstNow, -1));
  const dayOfWeek = jstNow.getDay(); // 0=Sunday, 6=Saturday
  const currentMinutes = jstNow.getHours() * 60 + jstNow.getMinutes();

  // Check if we're in the overnight period of YESTERDAY's business hours
  const yesterdayDow = (dayOfWeek + 6) % 7;
  const yesterdayEntry = resolveEntryForDate(yesterdayDate, yesterdayDow, hours, specialHours);
  if (yesterdayEntry && !yesterdayEntry.isClosed && !yesterdayEntry.is24Hours
      && yesterdayEntry.openTime && yesterdayEntry.closeTime) {
    const yOpen = parseTimeToMinutes(yesterdayEntry.openTime);
    const yClose = parseTimeToMinutes(yesterdayEntry.closeTime);
    // Overnight span from yesterday: closeTime < openTime, and we're before closeTime
    if (yClose < yOpen && currentMinutes < yClose) {
      const minutesUntilClose = yClose - currentMinutes;
      return {
        isOpen: true,
        closingSoon: minutesUntilClose <= CLOSING_SOON_MINUTES,
        is24Hours: false,
        todayHours: { openTime: yesterdayEntry.openTime, closeTime: yesterdayEntry.closeTime },
      };
    }
  }

  const todayEntry = resolveEntryForDate(todayDate, dayOfWeek, hours, specialHours);

  if (!todayEntry || todayEntry.isClosed) {
    return { isOpen: false, closingSoon: false, is24Hours: false, todayHours: null };
  }

  // 24-hour pharmacy: always open, never closing soon
  if (todayEntry.is24Hours) {
    return { isOpen: true, closingSoon: false, is24Hours: true, todayHours: null };
  }

  if (!todayEntry.openTime || !todayEntry.closeTime) {
    return { isOpen: false, closingSoon: false, is24Hours: false, todayHours: null };
  }

  const openMinutes = parseTimeToMinutes(todayEntry.openTime);
  const closeMinutes = parseTimeToMinutes(todayEntry.closeTime);

  let isOpen: boolean;
  let minutesUntilClose: number;

  if (closeMinutes > openMinutes) {
    // Normal span (e.g. 09:00–18:00)
    isOpen = currentMinutes >= openMinutes && currentMinutes < closeMinutes;
    minutesUntilClose = closeMinutes - currentMinutes;
  } else {
    // Overnight span (e.g. 22:00–06:00): open if after open OR before close
    isOpen = currentMinutes >= openMinutes || currentMinutes < closeMinutes;
    if (currentMinutes >= openMinutes) {
      // Before midnight portion
      minutesUntilClose = (24 * 60 - currentMinutes) + closeMinutes;
    } else {
      // After midnight portion
      minutesUntilClose = closeMinutes - currentMinutes;
    }
  }

  const closingSoon = isOpen && minutesUntilClose <= CLOSING_SOON_MINUTES;

  return {
    isOpen,
    closingSoon,
    is24Hours: false,
    todayHours: { openTime: todayEntry.openTime, closeTime: todayEntry.closeTime },
  };
}

/**
 * Format business hours for a given day.
 */
export function formatDayHours(entry: BusinessHourEntry): string {
  if (entry.isClosed || (!entry.is24Hours && (!entry.openTime || !entry.closeTime))) {
    return '定休日';
  }
  if (entry.is24Hours) {
    return '24時間営業';
  }
  return `${entry.openTime}〜${entry.closeTime}`;
}
