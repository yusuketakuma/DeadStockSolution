import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DashboardTimeline from '../../components/timeline/DashboardTimeline';
import type { TimelineEvent, TimelinePriority } from '../../types/timeline';

vi.mock('../../components/timeline/TimelineEventCard', () => ({
  default: ({ event, onClick }: { event: { id: string; title: string }; onClick?: (e: unknown) => void }) => (
    <div data-testid={`event-card-${event.id}`} onClick={() => onClick?.(event)}>
      {event.title}
    </div>
  ),
}));

function makeEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: 'evt-1',
    source: 'notification',
    type: 'request_update',
    title: 'テストイベント',
    body: 'テスト本文',
    timestamp: '2026-03-01T00:00:00Z',
    priority: 'medium',
    isRead: false,
    ...overrides,
  };
}

const defaultProps = {
  events: [] as TimelineEvent[],
  loading: false,
  hasMore: false,
  total: 0,
  selectedPriority: null as TimelinePriority | null,
  onPriorityChange: vi.fn(),
  onLoadMore: vi.fn(),
  onEventClick: vi.fn(),
  onRefresh: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DashboardTimeline', () => {
  it('イベント一覧を表示する', () => {
    const events = [
      makeEvent({ id: 'evt-1', title: 'イベント1' }),
      makeEvent({ id: 'evt-2', title: 'イベント2' }),
    ];
    render(<DashboardTimeline {...defaultProps} events={events} total={2} />);

    expect(screen.getByTestId('event-card-evt-1')).toBeInTheDocument();
    expect(screen.getByTestId('event-card-evt-2')).toBeInTheDocument();
    expect(screen.getByText('イベント1')).toBeInTheDocument();
    expect(screen.getByText('イベント2')).toBeInTheDocument();
  });

  it('優先度フィルタボタンをすべて表示する', () => {
    render(<DashboardTimeline {...defaultProps} />);

    expect(screen.getByRole('button', { name: 'すべて' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '緊急' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重要' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '通常' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'その他' })).toBeInTheDocument();
  });

  it('優先度フィルタをクリックするとonPriorityChangeが呼ばれる', () => {
    const onPriorityChange = vi.fn();
    render(<DashboardTimeline {...defaultProps} onPriorityChange={onPriorityChange} />);

    fireEvent.click(screen.getByRole('button', { name: '緊急' }));
    expect(onPriorityChange).toHaveBeenCalledWith('critical');

    fireEvent.click(screen.getByRole('button', { name: 'すべて' }));
    expect(onPriorityChange).toHaveBeenCalledWith(null);
  });

  it('hasMore=trueのとき「もっと見る」ボタンを表示する', () => {
    render(<DashboardTimeline {...defaultProps} hasMore={true} />);
    expect(screen.getByRole('button', { name: /もっと見る/ })).toBeInTheDocument();
  });

  it('hasMore=falseのとき「もっと見る」ボタンを表示しない', () => {
    render(<DashboardTimeline {...defaultProps} hasMore={false} />);
    expect(screen.queryByRole('button', { name: /もっと見る/ })).not.toBeInTheDocument();
  });

  it('イベントがない場合は空状態メッセージを表示する', () => {
    render(<DashboardTimeline {...defaultProps} events={[]} />);
    expect(screen.getByText('タイムラインにイベントはありません')).toBeInTheDocument();
  });

  it('errorがある場合はエラーメッセージと再試行ボタンを表示する', () => {
    render(<DashboardTimeline {...defaultProps} error="データの取得に失敗しました" />);
    expect(screen.getByText('データの取得に失敗しました')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '再試行' })).toBeInTheDocument();
  });

  it('loading=trueのときInlineLoaderを表示する', () => {
    render(<DashboardTimeline {...defaultProps} loading={true} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('更新ボタンをクリックするとonRefreshが呼ばれる', () => {
    const onRefresh = vi.fn();
    render(<DashboardTimeline {...defaultProps} onRefresh={onRefresh} />);

    fireEvent.click(screen.getByRole('button', { name: '更新' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
