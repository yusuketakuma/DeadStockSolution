import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TimelineEventCard from '../../components/timeline/TimelineEventCard';
import type { TimelineEvent } from '../../types/timeline';

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
    id: 'evt-1',
    source: 'notification',
    type: 'request_update',
    title: 'テストタイトル',
    body: 'テスト本文',
    timestamp: new Date().toISOString(),
    priority: 'medium',
    isRead: true,
    ...overrides,
  };
}

describe('TimelineEventCard', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  // --- 優先度バッジのテスト ---
  it('renders critical priority badge with danger variant', () => {
    const event = makeEvent({ priority: 'critical' });
    render(<TimelineEventCard event={event} />);
    const badge = screen.getByTestId('priority-badge');
    expect(badge).toHaveTextContent('緊急');
    expect(badge.className).toContain('bg-danger');
  });

  it('renders high priority badge with warning variant', () => {
    const event = makeEvent({ priority: 'high' });
    render(<TimelineEventCard event={event} />);
    const badge = screen.getByTestId('priority-badge');
    expect(badge).toHaveTextContent('重要');
    expect(badge.className).toContain('bg-warning');
  });

  it('renders medium priority badge with primary variant', () => {
    const event = makeEvent({ priority: 'medium' });
    render(<TimelineEventCard event={event} />);
    const badge = screen.getByTestId('priority-badge');
    expect(badge).toHaveTextContent('通常');
    expect(badge.className).toContain('bg-primary');
  });

  // --- 未読インジケーターテスト ---
  it('shows unread dot when isRead is false', () => {
    const event = makeEvent({ isRead: false });
    render(<TimelineEventCard event={event} />);
    expect(screen.getByTestId('unread-dot')).toBeInTheDocument();
  });

  it('does not show unread dot when isRead is true', () => {
    const event = makeEvent({ isRead: true });
    render(<TimelineEventCard event={event} />);
    expect(screen.queryByTestId('unread-dot')).not.toBeInTheDocument();
  });

  // --- ナビゲーションテスト ---
  it('navigates to actionPath when card is clicked', () => {
    const event = makeEvent({ actionPath: '/proposals/1' });
    render(<TimelineEventCard event={event} />);
    fireEvent.click(screen.getByTestId('card-title'));
    expect(mockNavigate).toHaveBeenCalledWith('/proposals/1');
  });

  it('ignores unsafe action paths', () => {
    const event = makeEvent({ actionPath: '//evil.example/phish' });
    render(<TimelineEventCard event={event} />);
    fireEvent.click(screen.getByTestId('card-title'));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  // --- 相対時間表示テスト ---
  it('shows relative time for timestamps a few minutes ago', () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const event = makeEvent({ timestamp: fiveMinutesAgo });
    render(<TimelineEventCard event={event} />);
    expect(screen.getByTestId('relative-time')).toHaveTextContent('5分前');
  });
});
