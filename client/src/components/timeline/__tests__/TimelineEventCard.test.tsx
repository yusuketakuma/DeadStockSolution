import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/helpers';
import TimelineEventCard from '../TimelineEventCard';
import type { TimelineEvent } from '../../../types/timeline';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function makeEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: 'notification_1',
    source: 'notification',
    type: 'proposal_status_changed',
    title: 'テストタイトル',
    body: 'テスト本文',
    timestamp: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
    priority: 'medium',
    isRead: true,
    actionPath: '/proposals/1',
    ...overrides,
  };
}

describe('TimelineEventCard', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('renders proposal icon for proposal source', () => {
    renderWithProviders(<TimelineEventCard event={makeEvent({ source: 'proposal' })} />);
    expect(screen.getAllByText(/↔️/)[0]).toBeInTheDocument();
  });

  it('renders comment icon for comment source', () => {
    renderWithProviders(<TimelineEventCard event={makeEvent({ source: 'comment' })} />);
    expect(screen.getAllByText(/💬/)[0]).toBeInTheDocument();
  });

  it('renders upload icon for upload source', () => {
    renderWithProviders(<TimelineEventCard event={makeEvent({ source: 'upload' })} />);
    expect(screen.getAllByText(/📦/)[0]).toBeInTheDocument();
  });

  it('renders expiry_risk icon', () => {
    renderWithProviders(<TimelineEventCard event={makeEvent({ source: 'expiry_risk' })} />);
    expect(screen.getAllByText(/⚠️/)[0]).toBeInTheDocument();
  });

  it('shows danger badge for critical priority', () => {
    renderWithProviders(<TimelineEventCard event={makeEvent({ priority: 'critical' })} />);
    const badges = screen.getAllByTestId('priority-badge');
    expect(badges[0]).toHaveClass('bg-danger');
    expect(badges[0]).toHaveTextContent('緊急');
  });

  it('shows warning badge for high priority', () => {
    renderWithProviders(<TimelineEventCard event={makeEvent({ priority: 'high' })} />);
    const badges = screen.getAllByTestId('priority-badge');
    expect(badges[0]).toHaveClass('bg-warning');
    expect(badges[0]).toHaveTextContent('重要');
  });

  it('shows primary badge for medium priority', () => {
    renderWithProviders(<TimelineEventCard event={makeEvent({ priority: 'medium' })} />);
    const badges = screen.getAllByTestId('priority-badge');
    expect(badges[0]).toHaveClass('bg-primary');
    expect(badges[0]).toHaveTextContent('通常');
  });

  it('shows secondary badge for low priority', () => {
    renderWithProviders(<TimelineEventCard event={makeEvent({ priority: 'low' })} />);
    const badges = screen.getAllByTestId('priority-badge');
    expect(badges[0]).toHaveClass('bg-secondary');
    expect(badges[0]).toHaveTextContent('補足');
  });

  it('shows unread dot when isRead is false', () => {
    renderWithProviders(<TimelineEventCard event={makeEvent({ isRead: false })} />);
    expect(screen.getAllByTestId('unread-dot').length).toBeGreaterThan(0);
    expect(screen.getByText('未読')).toBeInTheDocument();
  });

  it('does not show unread dot when isRead is true', () => {
    renderWithProviders(<TimelineEventCard event={makeEvent({ isRead: true })} />);
    expect(screen.queryByTestId('unread-dot')).not.toBeInTheDocument();
  });

  it('displays relative time', () => {
    const event = makeEvent({ timestamp: new Date(Date.now() - 3600000).toISOString() });
    renderWithProviders(<TimelineEventCard event={event} />);
    const timers = screen.getAllByTestId('relative-time');
    expect(timers[0]).toHaveTextContent('1時間前');
  });

  it('shows event title', () => {
    renderWithProviders(<TimelineEventCard event={makeEvent({ title: '提案が届きました' })} />);
    expect(screen.getAllByText(/提案が届きました/)[0]).toBeInTheDocument();
  });

  it('shows absolute timestamp metadata', () => {
    renderWithProviders(<TimelineEventCard event={makeEvent()} />);
    expect(screen.getByText(/\d{4}\/\d{1,2}\/\d{1,2}/)).toBeInTheDocument();
  });

  it('navigates on desktop card click', () => {
    renderWithProviders(
      <TimelineEventCard event={makeEvent({ actionPath: '/proposals/42' })} />
    );
    const card = screen.getByTestId('desktop-card');
    card.click();
    expect(mockNavigate).toHaveBeenCalledWith('/proposals/42');
  });
});
