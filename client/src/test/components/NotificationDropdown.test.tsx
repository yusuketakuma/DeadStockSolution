import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import NotificationDropdown from '../../components/header/NotificationDropdown';
import type { TimelineEvent } from '../../types/timeline';

function makeEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: 'evt-1',
    source: 'notification',
    type: 'request_update',
    title: '通知タイトル',
    body: '通知本文',
    timestamp: '2026-04-02T00:00:00.000Z',
    priority: 'medium',
    isRead: false,
    actionPath: '/requests',
    ...overrides,
  };
}

describe('NotificationDropdown', () => {
  it('uses dashboard hint when an unsafe action path is sanitized to root', () => {
    render(
      <MemoryRouter>
        <NotificationDropdown
          events={[makeEvent({ actionPath: '//evil.example/phish' })]}
          unreadCount={1}
          show
          onToggle={vi.fn()}
          onMarkViewed={vi.fn()}
        />
      </MemoryRouter>,
    );

    const item = screen.getByRole('link', { name: /通知タイトル/ });
    expect(item).toHaveAttribute('href', '/');
    expect(within(item).getByText('ダッシュボードへ →')).toBeInTheDocument();
  });
});
