interface BusinessHourEntry {
  dayOfWeek: number;
  openTime: string | null;
  closeTime: string | null;
  isClosed: boolean | null;
}

export interface BusinessHoursStatus {
  isOpen: boolean;
  closingSoon: boolean; // true if closing within 1 hour
  todayHours: { openTime: string; closeTime: string } | null;
}

/**
 * Check if a pharmacy is currently open based on its business hours.
 * Returns open/closed status and whether it's closing soon (within 1 hour).
 */
export function getBusinessHoursStatus(
  hours: BusinessHourEntry[],
  now: Date = new Date()
): BusinessHoursStatus {
  if (hours.length === 0) {
    // No business hours set = assume always open
    return { isOpen: true, closingSoon: false, todayHours: null };
  }

  const dayOfWeek = now.getDay(); // 0=Sunday, 6=Saturday
  const todayEntry = hours.find((h) => h.dayOfWeek === dayOfWeek);

  if (!todayEntry || todayEntry.isClosed) {
    return { isOpen: false, closingSoon: false, todayHours: null };
  }

  if (!todayEntry.openTime || !todayEntry.closeTime) {
    return { isOpen: false, closingSoon: false, todayHours: null };
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const [openH, openM] = todayEntry.openTime.split(':').map(Number);
  const [closeH, closeM] = todayEntry.closeTime.split(':').map(Number);
  const openMinutes = openH * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;

  const isOpen = currentMinutes >= openMinutes && currentMinutes < closeMinutes;
  const closingSoon = isOpen && (closeMinutes - currentMinutes) <= 60;

  return {
    isOpen,
    closingSoon,
    todayHours: { openTime: todayEntry.openTime, closeTime: todayEntry.closeTime },
  };
}

/**
 * Format business hours for a given day.
 */
export function formatDayHours(entry: BusinessHourEntry): string {
  if (entry.isClosed || !entry.openTime || !entry.closeTime) {
    return '定休日';
  }
  return `${entry.openTime}〜${entry.closeTime}`;
}
