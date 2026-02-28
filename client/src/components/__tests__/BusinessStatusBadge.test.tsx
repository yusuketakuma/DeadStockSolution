import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import BusinessStatusBadge from '../BusinessStatusBadge';

describe('BusinessStatusBadge', () => {
  it('shows not configured when isOpen is true and todayHours is not set', () => {
    render(
      <BusinessStatusBadge
        status={{
          isOpen: true,
          closingSoon: false,
          is24Hours: false,
          todayHours: null,
          isConfigured: false,
        }}
        showHours
        fallback="dash"
      />,
    );

    expect(screen.getByText('未設定')).toBeInTheDocument();
  });

  it('shows open badge with hours when todayHours exists', () => {
    render(
      <BusinessStatusBadge
        status={{
          isOpen: true,
          closingSoon: false,
          is24Hours: false,
          todayHours: {
            openTime: '09:00',
            closeTime: '18:00',
          },
          isConfigured: true,
        }}
        showHours
      />,
    );

    expect(screen.getByText('営業中 09:00〜18:00')).toBeInTheDocument();
  });

  it('shows closed when configured pharmacy is outside business hours', () => {
    render(
      <BusinessStatusBadge
        status={{
          isOpen: false,
          closingSoon: false,
          is24Hours: false,
          todayHours: {
            openTime: '09:00',
            closeTime: '18:00',
          },
          isConfigured: true,
        }}
      />,
    );

    expect(screen.getByText('営業時間外')).toBeInTheDocument();
  });

  it('shows dash when status is missing and fallback is dash', () => {
    render(<BusinessStatusBadge fallback="dash" />);

    expect(screen.getByText('-')).toBeInTheDocument();
  });
});
