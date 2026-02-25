import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import BusinessHoursSettings from '../../components/account/BusinessHoursSettings';
import { createDefaultHours, type SpecialHourEntry } from '../../components/account/types';

const noop = (..._args: unknown[]) => undefined;

function createProps() {
  const specialHours: SpecialHourEntry[] = [
    {
      id: 1,
      specialType: 'special_open',
      startDate: '2026-03-01',
      endDate: '2026-03-01',
      openTime: '10:00',
      closeTime: '15:00',
      isClosed: false,
      is24Hours: false,
      note: null,
    },
  ];

  return {
    businessHours: createDefaultHours(),
    specialHours,
    hoursLoaded: true,
    hoursEditing: true,
    hoursSaving: false,
    hoursMessage: '',
    hoursError: '',
    onHoursMessage: noop,
    onHoursError: noop,
    onHoursChange: noop,
    onClosedChange: noop,
    on24HoursChange: noop,
    onHoursSave: noop,
    onHoursEditStart: noop,
    onHoursEditCancel: noop,
    onAddSpecialHour: noop,
    onRemoveSpecialHour: noop,
    onSpecialTypeChange: noop,
    onSpecialDateChange: noop,
    onSpecialNoteChange: noop,
    onSpecialHoursChange: noop,
    onSpecialClosedChange: noop,
    onSpecial24HoursChange: noop,
  };
}

describe('BusinessHoursSettings accessibility labels', () => {
  it('renders accessible labels for regular-hour controls', () => {
    render(<BusinessHoursSettings {...createProps()} />);

    expect(screen.getByLabelText('月曜日 定休日')).toBeInTheDocument();
    expect(screen.getByLabelText('月曜日 24時間営業')).toBeInTheDocument();
    expect(screen.getByLabelText('月曜日 開店時間')).toBeInTheDocument();
    expect(screen.getByLabelText('月曜日 閉店時間')).toBeInTheDocument();
  });

  it('renders accessible labels for special-hour controls', () => {
    render(<BusinessHoursSettings {...createProps()} />);

    expect(screen.getByLabelText('特例営業時間 1 種別')).toBeInTheDocument();
    expect(screen.getByLabelText('特例営業時間 1 開始日')).toBeInTheDocument();
    expect(screen.getByLabelText('特例営業時間 1 終了日')).toBeInTheDocument();
    expect(screen.getByLabelText('特例営業時間 1 開店時間')).toBeInTheDocument();
    expect(screen.getByLabelText('特例営業時間 1 閉店時間')).toBeInTheDocument();
  });
});
