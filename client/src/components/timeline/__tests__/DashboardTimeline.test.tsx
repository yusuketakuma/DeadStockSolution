import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../../../test/helpers';
import DashboardTimeline from '../DashboardTimeline';
import type { TimelineEvent } from '../../../types/timeline';

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
  };
});

const defaultProps = {
  events: [] as TimelineEvent[],
  total: 0,
  loading: false,
  hasMore: false,
  selectedPriority: null,
  onPriorityChange: vi.fn(),
  onLoadMore: vi.fn(),
  onRefresh: vi.fn(),
};

function makeEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: 'test_1',
    source: 'notification',
    type: 'proposal_status_changed',
    title: 'テストイベント',
    body: 'テスト本文',
    timestamp: new Date().toISOString(),
    priority: 'medium',
    isRead: true,
    actionPath: '/',
    ...overrides,
  };
}

function makeYesterdayEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return makeEvent({ id: 'yesterday_1', timestamp: yesterday.toISOString(), ...overrides });
}

describe('DashboardTimeline', () => {
  it('shows empty state when no events', () => {
    renderWithProviders(
      <DashboardTimeline {...defaultProps} />
    );
    expect(screen.getByText('タイムラインにイベントはありません')).toBeInTheDocument();
  });

  it('shows loading state when loading and no events', () => {
    renderWithProviders(
      <DashboardTimeline {...defaultProps} loading={true} />
    );
    expect(screen.getByText('読み込み中...')).toBeInTheDocument();
  });

  it('renders events without date grouping', () => {
    const event = makeEvent();
    renderWithProviders(
      <DashboardTimeline {...defaultProps} events={[event]} total={1} />
    );
    expect(screen.getByText('テストイベント')).toBeInTheDocument();
  });

  it('renders multiple events in flat list', () => {
    const todayEvent = makeEvent({ id: 'today_1' });
    const yesterdayEvent = makeYesterdayEvent({ id: 'yesterday_2' });
    renderWithProviders(
      <DashboardTimeline {...defaultProps} events={[todayEvent, yesterdayEvent]} total={2} />
    );
    expect(screen.getAllByText('テストイベント')).toHaveLength(2);
    expect(screen.getAllByTestId('date-header').length).toBeGreaterThan(0);
  });

  it('shows "もっと見る" button when hasMore is true', () => {
    const events = [makeEvent()];
    renderWithProviders(
      <DashboardTimeline {...defaultProps} events={events} total={10} hasMore={true} />
    );
    const button = screen.getByRole('button', { name: 'さらに9件を見る' });
    expect(button).toBeInTheDocument();
  });

  it('does not show "もっと見る" button when all events loaded', () => {
    const events = [makeEvent()];
    renderWithProviders(
      <DashboardTimeline {...defaultProps} events={events} total={1} hasMore={false} />
    );
    expect(screen.queryByRole('button', { name: 'もっと見る' })).not.toBeInTheDocument();
  });

  it('calls onLoadMore when "もっと見る" button is clicked', () => {
    const onLoadMore = vi.fn();
    const events = [makeEvent()];
    renderWithProviders(
      <DashboardTimeline {...defaultProps} events={events} total={5} hasMore={true} onLoadMore={onLoadMore} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'さらに4件を見る' }));
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it('renders header title', () => {
    renderWithProviders(
      <DashboardTimeline {...defaultProps} />
    );
    expect(screen.getByText('タイムライン')).toBeInTheDocument();
  });

  it('shows active filter summary when filtered', () => {
    renderWithProviders(
      <DashboardTimeline {...defaultProps} selectedPriority="critical" events={[makeEvent({ priority: 'critical' })]} total={1} />
    );
    expect(screen.getByText(/絞り込み: 緊急/)).toBeInTheDocument();
  });
});
