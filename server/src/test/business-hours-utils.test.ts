import { describe, it, expect } from 'vitest';
import { getBusinessHoursStatus, formatDayHours } from '../utils/business-hours-utils';

/**
 * Create a Date object that represents the given JST time.
 * This ensures tests are consistent across CI (UTC) and local (Asia/Tokyo) environments.
 */
function jstDate(isoDateTime: string): Date {
  // Append +09:00 if no timezone specified
  const withTz = isoDateTime.includes('T') && !/[+-Z]/.test(isoDateTime.slice(-6))
    ? `${isoDateTime}+09:00`
    : isoDateTime;
  return new Date(withTz);
}

describe('getBusinessHoursStatus', () => {
  const standardHours = [
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
    const monday10am = jstDate('2026-02-23T10:00:00');
    const status = getBusinessHoursStatus(standardHours, monday10am);
    expect(status.isOpen).toBe(true);
    expect(status.closingSoon).toBe(false);
    expect(status.todayHours).toEqual({ openTime: '09:00', closeTime: '18:00' });
  });

  it('returns isOpen=false before opening time', () => {
    const monday8am = jstDate('2026-02-23T08:00:00');
    const status = getBusinessHoursStatus(standardHours, monday8am);
    expect(status.isOpen).toBe(false);
    expect(status.closingSoon).toBe(false);
  });

  it('returns isOpen=false after closing time', () => {
    const monday7pm = jstDate('2026-02-23T19:00:00');
    const status = getBusinessHoursStatus(standardHours, monday7pm);
    expect(status.isOpen).toBe(false);
    expect(status.closingSoon).toBe(false);
  });

  it('returns isOpen=false on a closed day (Sunday)', () => {
    const sunday = jstDate('2026-02-22T12:00:00');
    const status = getBusinessHoursStatus(standardHours, sunday);
    expect(status.isOpen).toBe(false);
    expect(status.closingSoon).toBe(false);
    expect(status.todayHours).toBeNull();
  });

  it('returns closingSoon=true when within 1 hour of closing', () => {
    const monday530pm = jstDate('2026-02-23T17:30:00');
    const status = getBusinessHoursStatus(standardHours, monday530pm);
    expect(status.isOpen).toBe(true);
    expect(status.closingSoon).toBe(true);
  });

  it('returns closingSoon=true at exactly 1 hour before closing', () => {
    const monday5pm = jstDate('2026-02-23T17:00:00');
    const status = getBusinessHoursStatus(standardHours, monday5pm);
    expect(status.isOpen).toBe(true);
    expect(status.closingSoon).toBe(true);
  });

  it('returns closingSoon=false when more than 1 hour before closing', () => {
    const monday459pm = jstDate('2026-02-23T16:59:00');
    const status = getBusinessHoursStatus(standardHours, monday459pm);
    expect(status.isOpen).toBe(true);
    expect(status.closingSoon).toBe(false);
  });

  it('handles Saturday with different hours', () => {
    const saturday = jstDate('2026-02-28T12:00:00');
    const status = getBusinessHoursStatus(standardHours, saturday);
    expect(status.isOpen).toBe(true);
    expect(status.todayHours).toEqual({ openTime: '10:00', closeTime: '15:00' });
  });

  it('returns closingSoon for Saturday within 1 hour of close', () => {
    const saturday215pm = jstDate('2026-02-28T14:15:00');
    const status = getBusinessHoursStatus(standardHours, saturday215pm);
    expect(status.isOpen).toBe(true);
    expect(status.closingSoon).toBe(true);
  });

  it('returns isOpen=false at exactly closing time', () => {
    const monday6pm = jstDate('2026-02-23T18:00:00');
    const status = getBusinessHoursStatus(standardHours, monday6pm);
    expect(status.isOpen).toBe(false);
  });

  it('returns isOpen=true at exactly opening time', () => {
    const monday9am = jstDate('2026-02-23T09:00:00');
    const status = getBusinessHoursStatus(standardHours, monday9am);
    expect(status.isOpen).toBe(true);
  });

  // Overnight hours tests (e.g. 22:00-06:00)
  describe('overnight hours', () => {
    const overnightHours = [
      { dayOfWeek: 0, openTime: null, closeTime: null, isClosed: true },
      { dayOfWeek: 1, openTime: '22:00', closeTime: '06:00', isClosed: false },
      { dayOfWeek: 2, openTime: '22:00', closeTime: '06:00', isClosed: false },
      { dayOfWeek: 3, openTime: '22:00', closeTime: '06:00', isClosed: false },
      { dayOfWeek: 4, openTime: '22:00', closeTime: '06:00', isClosed: false },
      { dayOfWeek: 5, openTime: '22:00', closeTime: '06:00', isClosed: false },
      { dayOfWeek: 6, openTime: '22:00', closeTime: '06:00', isClosed: false },
    ];

    it('is open after opening time before midnight', () => {
      // Monday 23:00
      const monday11pm = jstDate('2026-02-23T23:00:00');
      const status = getBusinessHoursStatus(overnightHours, monday11pm);
      expect(status.isOpen).toBe(true);
      expect(status.closingSoon).toBe(false);
    });

    it('is open after midnight before closing', () => {
      // Monday 03:00 (still within Mon's 22:00-06:00)
      const monday3am = jstDate('2026-02-23T03:00:00');
      const status = getBusinessHoursStatus(overnightHours, monday3am);
      expect(status.isOpen).toBe(true);
      expect(status.closingSoon).toBe(false);
    });

    it('is closed before opening time', () => {
      // Monday 15:00
      const monday3pm = jstDate('2026-02-23T15:00:00');
      const status = getBusinessHoursStatus(overnightHours, monday3pm);
      expect(status.isOpen).toBe(false);
    });

    it('is closed after closing time (morning)', () => {
      // Monday 07:00 (after 06:00 close)
      const monday7am = jstDate('2026-02-23T07:00:00');
      const status = getBusinessHoursStatus(overnightHours, monday7am);
      expect(status.isOpen).toBe(false);
    });

    it('closingSoon before midnight when close is soon after midnight', () => {
      // closeTime=06:00, so closingSoon at 05:30 (30 min before close)
      const monday530am = jstDate('2026-02-23T05:30:00');
      const status = getBusinessHoursStatus(overnightHours, monday530am);
      expect(status.isOpen).toBe(true);
      expect(status.closingSoon).toBe(true);
    });

    it('not closingSoon when well before midnight', () => {
      // At 22:30, close is at 06:00 next day = 7.5 hours away
      const monday1030pm = jstDate('2026-02-23T22:30:00');
      const status = getBusinessHoursStatus(overnightHours, monday1030pm);
      expect(status.isOpen).toBe(true);
      expect(status.closingSoon).toBe(false);
    });

    it('is open at exactly opening time', () => {
      const monday10pm = jstDate('2026-02-23T22:00:00');
      const status = getBusinessHoursStatus(overnightHours, monday10pm);
      expect(status.isOpen).toBe(true);
    });

    it('is closed at exactly closing time', () => {
      const monday6am = jstDate('2026-02-23T06:00:00');
      const status = getBusinessHoursStatus(overnightHours, monday6am);
      expect(status.isOpen).toBe(false);
    });
  });

  // 24-hour pharmacy tests
  describe('24-hour pharmacy', () => {
    const hours24 = [
      { dayOfWeek: 0, openTime: null, closeTime: null, isClosed: true, is24Hours: false },
      { dayOfWeek: 1, openTime: null, closeTime: null, isClosed: false, is24Hours: true },
      { dayOfWeek: 2, openTime: null, closeTime: null, isClosed: false, is24Hours: true },
      { dayOfWeek: 3, openTime: null, closeTime: null, isClosed: false, is24Hours: true },
      { dayOfWeek: 4, openTime: null, closeTime: null, isClosed: false, is24Hours: true },
      { dayOfWeek: 5, openTime: null, closeTime: null, isClosed: false, is24Hours: true },
      { dayOfWeek: 6, openTime: null, closeTime: null, isClosed: false, is24Hours: true },
    ];

    it('is always open during 24-hour day', () => {
      const monday3am = jstDate('2026-02-23T03:00:00');
      const status = getBusinessHoursStatus(hours24, monday3am);
      expect(status.isOpen).toBe(true);
      expect(status.closingSoon).toBe(false);
      expect(status.is24Hours).toBe(true);
      expect(status.todayHours).toBeNull();
    });

    it('is open at midnight for 24-hour day', () => {
      const mondayMidnight = jstDate('2026-02-23T00:00:00');
      const status = getBusinessHoursStatus(hours24, mondayMidnight);
      expect(status.isOpen).toBe(true);
      expect(status.closingSoon).toBe(false);
    });

    it('is open at 23:59 for 24-hour day', () => {
      const monday2359 = jstDate('2026-02-23T23:59:00');
      const status = getBusinessHoursStatus(hours24, monday2359);
      expect(status.isOpen).toBe(true);
      expect(status.closingSoon).toBe(false);
    });

    it('is closed on Sunday even when other days are 24h', () => {
      const sunday = jstDate('2026-02-22T12:00:00');
      const status = getBusinessHoursStatus(hours24, sunday);
      expect(status.isOpen).toBe(false);
    });

    it('never shows closingSoon for 24-hour day', () => {
      const monday1159pm = jstDate('2026-02-23T23:59:00');
      const status = getBusinessHoursStatus(hours24, monday1159pm);
      expect(status.closingSoon).toBe(false);
    });
  });

  describe('mixed hours (24h, normal, closed)', () => {
    const mixedHours = [
      { dayOfWeek: 0, openTime: null, closeTime: null, isClosed: true, is24Hours: false },
      { dayOfWeek: 1, openTime: null, closeTime: null, isClosed: false, is24Hours: true },
      { dayOfWeek: 2, openTime: '09:00', closeTime: '18:00', isClosed: false, is24Hours: false },
      { dayOfWeek: 3, openTime: null, closeTime: null, isClosed: true, is24Hours: false },
      { dayOfWeek: 4, openTime: '09:00', closeTime: '18:00', isClosed: false, is24Hours: false },
      { dayOfWeek: 5, openTime: '09:00', closeTime: '18:00', isClosed: false, is24Hours: false },
      { dayOfWeek: 6, openTime: '10:00', closeTime: '15:00', isClosed: false, is24Hours: false },
    ];

    it('Monday (24h) is open at any time', () => {
      const status = getBusinessHoursStatus(mixedHours, jstDate('2026-02-23T03:00:00'));
      expect(status.isOpen).toBe(true);
      expect(status.is24Hours).toBe(true);
    });

    it('Tuesday (normal) is open during hours', () => {
      const status = getBusinessHoursStatus(mixedHours, jstDate('2026-02-24T12:00:00'));
      expect(status.isOpen).toBe(true);
      expect(status.is24Hours).toBe(false);
      expect(status.todayHours).toEqual({ openTime: '09:00', closeTime: '18:00' });
    });

    it('Tuesday (normal) is closed outside hours', () => {
      const status = getBusinessHoursStatus(mixedHours, jstDate('2026-02-24T20:00:00'));
      expect(status.isOpen).toBe(false);
    });

    it('Wednesday (closed) is closed', () => {
      const status = getBusinessHoursStatus(mixedHours, jstDate('2026-02-25T12:00:00'));
      expect(status.isOpen).toBe(false);
    });

    it('Sunday (closed) is closed', () => {
      const status = getBusinessHoursStatus(mixedHours, jstDate('2026-02-22T12:00:00'));
      expect(status.isOpen).toBe(false);
    });
  });

  // Edge cases
  it('handles null isClosed as not closed', () => {
    const hours = [
      { dayOfWeek: 1, openTime: '09:00', closeTime: '18:00', isClosed: null },
    ];
    // Monday at 12:00
    const monday12pm = jstDate('2026-02-23T12:00:00');
    const status = getBusinessHoursStatus(hours, monday12pm);
    expect(status.isOpen).toBe(true);
  });

  it('handles missing day entry as closed', () => {
    // Only has Monday, testing on Tuesday
    const hours = [
      { dayOfWeek: 1, openTime: '09:00', closeTime: '18:00', isClosed: false },
    ];
    // Tuesday at 12:00
    const tuesday12pm = jstDate('2026-02-24T12:00:00');
    const status = getBusinessHoursStatus(hours, tuesday12pm);
    expect(status.isOpen).toBe(false);
  });

  describe('special business hours', () => {
    const weeklyHours = [
      { dayOfWeek: 0, openTime: null, closeTime: null, isClosed: true },
      { dayOfWeek: 1, openTime: '09:00', closeTime: '18:00', isClosed: false },
      { dayOfWeek: 2, openTime: '09:00', closeTime: '18:00', isClosed: false },
      { dayOfWeek: 3, openTime: '09:00', closeTime: '18:00', isClosed: false },
      { dayOfWeek: 4, openTime: '09:00', closeTime: '18:00', isClosed: false },
      { dayOfWeek: 5, openTime: '09:00', closeTime: '18:00', isClosed: false },
      { dayOfWeek: 6, openTime: '10:00', closeTime: '15:00', isClosed: false },
    ];

    it('overrides weekly open hours with holiday closure', () => {
      const specialHours = [
        {
          id: 1,
          specialType: 'holiday_closed',
          startDate: '2026-02-23',
          endDate: '2026-02-23',
          openTime: null,
          closeTime: null,
          isClosed: true,
          is24Hours: false,
        },
      ];
      const mondayNoon = jstDate('2026-02-23T12:00:00');
      const status = getBusinessHoursStatus(weeklyHours, specialHours, mondayNoon);
      expect(status.isOpen).toBe(false);
    });

    it('overrides weekly closed day with temporary special opening', () => {
      const specialHours = [
        {
          id: 2,
          specialType: 'special_open',
          startDate: '2026-02-22',
          endDate: '2026-02-22',
          openTime: '10:00',
          closeTime: '14:00',
          isClosed: false,
          is24Hours: false,
        },
      ];
      const sundayNoon = jstDate('2026-02-22T12:00:00');
      const status = getBusinessHoursStatus(weeklyHours, specialHours, sundayNoon);
      expect(status.isOpen).toBe(true);
      expect(status.todayHours).toEqual({ openTime: '10:00', closeTime: '14:00' });
    });

    it('prefers more specific date range when multiple special hours match', () => {
      const specialHours = [
        {
          id: 10,
          specialType: 'long_holiday_closed',
          startDate: '2026-05-01',
          endDate: '2026-05-07',
          openTime: null,
          closeTime: null,
          isClosed: true,
          is24Hours: false,
        },
        {
          id: 11,
          specialType: 'special_open',
          startDate: '2026-05-03',
          endDate: '2026-05-03',
          openTime: '09:00',
          closeTime: '12:00',
          isClosed: false,
          is24Hours: false,
        },
      ];
      const duringGoldenWeek = jstDate('2026-05-03T10:00:00');
      const status = getBusinessHoursStatus(weeklyHours, specialHours, duringGoldenWeek);
      expect(status.isOpen).toBe(true);
      expect(status.todayHours).toEqual({ openTime: '09:00', closeTime: '12:00' });
    });

    it('supports overnight special hours from previous day', () => {
      const specialHours = [
        {
          id: 20,
          specialType: 'special_open',
          startDate: '2026-02-23',
          endDate: '2026-02-23',
          openTime: '22:00',
          closeTime: '03:00',
          isClosed: false,
          is24Hours: false,
        },
      ];
      const tuesday1am = jstDate('2026-02-24T01:00:00');
      const status = getBusinessHoursStatus(weeklyHours, specialHours, tuesday1am);
      expect(status.isOpen).toBe(true);
      expect(status.todayHours).toEqual({ openTime: '22:00', closeTime: '03:00' });
    });
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

  it('formats overnight hours', () => {
    expect(formatDayHours({ dayOfWeek: 1, openTime: '22:00', closeTime: '06:00', isClosed: false }))
      .toBe('22:00〜06:00');
  });

  it('formats 24-hour day', () => {
    expect(formatDayHours({ dayOfWeek: 1, openTime: null, closeTime: null, isClosed: false, is24Hours: true }))
      .toBe('24時間営業');
  });
});
