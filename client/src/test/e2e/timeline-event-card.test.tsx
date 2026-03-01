import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TimelineEventCard from '../../components/timeline/TimelineEventCard';
import type { TimelineEvent } from '../../types/timeline';

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
  // --- 優先度バッジのテスト (4テスト) ---
  it('renders critical priority badge with danger variant', () => {
    const event = makeEvent({ priority: 'critical' });
    render(<TimelineEventCard event={event} />);
    const badge = screen.getByText('critical');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-danger');
  });

  it('renders high priority badge with warning variant', () => {
    const event = makeEvent({ priority: 'high' });
    render(<TimelineEventCard event={event} />);
    const badge = screen.getByText('high');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-warning');
  });

  it('renders medium priority badge with info variant', () => {
    const event = makeEvent({ priority: 'medium' });
    render(<TimelineEventCard event={event} />);
    const badge = screen.getByText('medium');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-info');
  });

  it('renders low priority badge with secondary variant', () => {
    const event = makeEvent({ priority: 'low' });
    render(<TimelineEventCard event={event} />);
    const badge = screen.getByText('low');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('bg-secondary');
  });

  // --- 未読/既読の視覚的区別テスト (2テスト) ---
  it('applies unread styling when isRead is false', () => {
    const event = makeEvent({ isRead: false });
    const { container } = render(<TimelineEventCard event={event} />);
    const item = container.firstChild as HTMLElement;
    expect(item.className).toContain('unread');
  });

  it('does not apply unread styling when isRead is true', () => {
    const event = makeEvent({ isRead: true });
    const { container } = render(<TimelineEventCard event={event} />);
    const item = container.firstChild as HTMLElement;
    expect(item.className).not.toContain('unread');
  });

  // --- ソースラベルのテスト (2テスト) ---
  it('renders source label for proposal source', () => {
    const event = makeEvent({ source: 'proposal' });
    render(<TimelineEventCard event={event} />);
    expect(screen.getByText('提案')).toBeInTheDocument();
  });

  it('renders source label for admin_message source', () => {
    const event = makeEvent({ source: 'admin_message' });
    render(<TimelineEventCard event={event} />);
    expect(screen.getByText('管理者')).toBeInTheDocument();
  });

  // --- onClickコールバックテスト (1テスト) ---
  it('calls onClick callback with the event when clicked', () => {
    const event = makeEvent({ id: 'click-test' });
    const handleClick = vi.fn();
    render(<TimelineEventCard event={event} onClick={handleClick} />);
    fireEvent.click(screen.getByText('テストタイトル'));
    expect(handleClick).toHaveBeenCalledTimes(1);
    expect(handleClick).toHaveBeenCalledWith(event);
  });

  // --- 相対時間表示テスト (2テスト) ---
  it('shows "たった今" for timestamps within 60 seconds', () => {
    const event = makeEvent({ timestamp: new Date().toISOString() });
    render(<TimelineEventCard event={event} />);
    expect(screen.getByText('たった今')).toBeInTheDocument();
  });

  it('shows relative minutes for timestamps a few minutes ago', () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const event = makeEvent({ timestamp: fiveMinutesAgo });
    render(<TimelineEventCard event={event} />);
    expect(screen.getByText('5分前')).toBeInTheDocument();
  });
});
