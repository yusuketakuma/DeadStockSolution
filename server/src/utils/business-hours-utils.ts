import type { BusinessHoursStatus } from '../types';

export type { BusinessHoursStatus };

interface BusinessHourEntry {
  dayOfWeek: number;
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean | null;
  is24Hours?: boolean | null;
}

/** Minutes before closing to trigger "closing soon" warning */
const CLOSING_SOON_MINUTES = 60;

/**
 * Parse "HH:MM" into total minutes since midnight.
 */
function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Check if a pharmacy is currently open based on its business hours.
 * Returns open/closed status and whether it's closing soon (within 1 hour).
 *
 * - No hours registered → assumed always open.
 * - Supports overnight spans (e.g. 22:00–06:00) where closeTime < openTime.
 */
export function getBusinessHoursStatus(
  hours: BusinessHourEntry[],
  now: Date = new Date()
): BusinessHoursStatus {
  if (hours.length === 0) {
    // No business hours set = assume always open
    return { isOpen: true, closingSoon: false, is24Hours: false, todayHours: null };
  }

  // Use JST explicitly to avoid server timezone issues
  const jstNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  const dayOfWeek = jstNow.getDay(); // 0=Sunday, 6=Saturday
  const currentMinutes = jstNow.getHours() * 60 + jstNow.getMinutes();

  // Check if we're in the overnight period of YESTERDAY's business hours
  const yesterdayDow = (dayOfWeek + 6) % 7;
  const yesterdayEntry = hours.find((h) => h.dayOfWeek === yesterdayDow);
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

  const todayEntry = hours.find((h) => h.dayOfWeek === dayOfWeek);

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
