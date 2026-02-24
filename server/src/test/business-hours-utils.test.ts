import { describe, it, expect } from 'vitest';
import { getBusinessHoursStatus, formatDayHours } from '../utils/business-hours-utils';

describe('getBusinessHoursStatus', () => {
  const mondayOpenHours = [
    { dayOfWeek: 0, openTime: null, closeTime: null, isClosed: true },
    { dayOfWeek: 1, openTime: '09:00', closeTime: '18:00', isClosed: false },
    { dayOfWeek: 2, openTime: '09:00', closeTime: '18:00', isClosed: false },
    { dayOfWeek: 3, openTime: '09:00', closeTime: '18:00', isClosed: false },
    { dayOfWeek: 4, openTime: '09:00', closeTime: '18:00', isClosed: false },
    { dayOfWeek: 5, openTime: '09:00', closeTime: '18:00', isClosed: false },
    { dayOfWeek: 6, openTime: '10:00', closeTime: '15:00', isClosed: false },
  ];

  it('returns isOpen=true when no business hours are set', () => {
    const status = getBusinessHoursStatus([]);
    expect(status.isOpen).toBe(true);
    expect(status.closingSoon).toBe(false);
    expect(status.todayHours).toBeNull();
  });

  it('returns isOpen=true during business hours on Monday', () => {
    // Monday at 10:00
    const monday10am = new Date('2026-02-23T10:00:00'); // Monday
    const status = getBusinessHoursStatus(mondayOpenHours, monday10am);
    expect(status.isOpen).toBe(true);
    expect(status.closingSoon).toBe(false);
    expect(status.todayHours).toEqual({ openTime: '09:00', closeTime: '18:00' });
  });

  it('returns isOpen=false before opening time', () => {
    // Monday at 08:00
    const monday8am = new Date('2026-02-23T08:00:00');
    const status = getBusinessHoursStatus(mondayOpenHours, monday8am);
    expect(status.isOpen).toBe(false);
    expect(status.closingSoon).toBe(false);
  });

  it('returns isOpen=false after closing time', () => {
    // Monday at 19:00
    const monday7pm = new Date('2026-02-23T19:00:00');
    const status = getBusinessHoursStatus(mondayOpenHours, monday7pm);
    expect(status.isOpen).toBe(false);
    expect(status.closingSoon).toBe(false);
  });

  it('returns isOpen=false on a closed day (Sunday)', () => {
    // Sunday
    const sunday = new Date('2026-02-22T12:00:00'); // Sunday
    const status = getBusinessHoursStatus(mondayOpenHours, sunday);
    expect(status.isOpen).toBe(false);
    expect(status.closingSoon).toBe(false);
    expect(status.todayHours).toBeNull();
  });

  it('returns closingSoon=true when within 1 hour of closing', () => {
    // Monday at 17:30 (30 minutes before 18:00 close)
    const monday530pm = new Date('2026-02-23T17:30:00');
    const status = getBusinessHoursStatus(mondayOpenHours, monday530pm);
    expect(status.isOpen).toBe(true);
    expect(status.closingSoon).toBe(true);
  });

  it('returns closingSoon=true at exactly 1 hour before closing', () => {
    // Monday at 17:00 (exactly 1 hour before 18:00 close)
    const monday5pm = new Date('2026-02-23T17:00:00');
    const status = getBusinessHoursStatus(mondayOpenHours, monday5pm);
    expect(status.isOpen).toBe(true);
    expect(status.closingSoon).toBe(true);
  });

  it('returns closingSoon=false when more than 1 hour before closing', () => {
    // Monday at 16:59 (1h1m before 18:00 close)
    const monday459pm = new Date('2026-02-23T16:59:00');
    const status = getBusinessHoursStatus(mondayOpenHours, monday459pm);
    expect(status.isOpen).toBe(true);
    expect(status.closingSoon).toBe(false);
  });

  it('handles Saturday with different hours', () => {
    // Saturday at 12:00
    const saturday = new Date('2026-02-28T12:00:00'); // Saturday
    const status = getBusinessHoursStatus(mondayOpenHours, saturday);
    expect(status.isOpen).toBe(true);
    expect(status.todayHours).toEqual({ openTime: '10:00', closeTime: '15:00' });
  });

  it('returns closingSoon for Saturday within 1 hour of close', () => {
    // Saturday at 14:15 (45 minutes before 15:00 close)
    const saturday215pm = new Date('2026-02-28T14:15:00');
    const status = getBusinessHoursStatus(mondayOpenHours, saturday215pm);
    expect(status.isOpen).toBe(true);
    expect(status.closingSoon).toBe(true);
  });
});

describe('formatDayHours', () => {
  it('formats open hours', () => {
    expect(formatDayHours({ dayOfWeek: 1, openTime: '09:00', closeTime: '18:00', isClosed: false }))
      .toBe('09:00〜18:00');
  });

  it('formats closed day', () => {
    expect(formatDayHours({ dayOfWeek: 0, openTime: null, closeTime: null, isClosed: true }))
      .toBe('定休日');
  });

  it('formats day with null times as closed', () => {
    expect(formatDayHours({ dayOfWeek: 0, openTime: null, closeTime: null, isClosed: false }))
      .toBe('定休日');
  });
});
