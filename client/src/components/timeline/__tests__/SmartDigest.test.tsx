import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/helpers';
import SmartDigest from '../SmartDigest';
import type { TimelineEvent } from '../../../types/timeline';
import type { UploadStatus } from '../../dashboard/types';

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
      <a href={to} className={className} data-testid="action-link">
        {children}
      </a>
    ),
  };
});

function makeEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: 'test_1',
    source: 'notification',
    type: 'proposal_status_changed',
    title: 'テストイベント',
    body: 'テスト本文',
    timestamp: new Date().toISOString(),
    priority: 'critical',
    isRead: false,
    actionPath: '/proposals/1',
    ...overrides,
  };
}

function makeCompleteStatus(): UploadStatus {
  return {
    deadStockUploaded: true,
    usedMedicationUploaded: true,
    lastDeadStockUpload: new Date().toISOString(),
    lastUsedMedicationUpload: new Date().toISOString(),
  };
}

describe('SmartDigest', () => {
  it('shows matching prompt when events is empty and uploads complete', () => {
    renderWithProviders(<SmartDigest events={[]} status={makeCompleteStatus()} loading={false} />);
    expect(screen.getByText('マッチングを実行')).toBeInTheDocument();
  });

  it('shows upload prompt when dead stock not uploaded', () => {
    const status: UploadStatus = { ...makeCompleteStatus(), deadStockUploaded: false };
    renderWithProviders(<SmartDigest events={[]} status={status} loading={false} />);
    expect(screen.getByText('デッドストックリストをアップロード')).toBeInTheDocument();
  });

  it('shows loading state when loading is true', () => {
    renderWithProviders(<SmartDigest events={[]} status={makeCompleteStatus()} loading={true} />);
    expect(screen.getByText('読み込み中...')).toBeInTheDocument();
    expect(screen.queryByText('マッチングを実行')).not.toBeInTheDocument();
  });

  it('does not show items while loading', () => {
    renderWithProviders(<SmartDigest events={[makeEvent()]} status={makeCompleteStatus()} loading={true} />);
    expect(screen.queryByTestId('digest-item')).not.toBeInTheDocument();
  });

  it('renders items when not loading', () => {
    const events = [makeEvent(), makeEvent({ id: 'test_2', priority: 'high' })];
    renderWithProviders(<SmartDigest events={events} status={makeCompleteStatus()} loading={false} />);
    expect(screen.getAllByTestId('digest-item')).toHaveLength(2);
  });

  it('shows critical items before high items regardless of input order', () => {
    const events = [
      makeEvent({ id: 'high_1', priority: 'high', title: '高優先度' }),
      makeEvent({ id: 'critical_1', priority: 'critical', title: '重要タスク' }),
    ];
    renderWithProviders(<SmartDigest events={events} status={makeCompleteStatus()} loading={false} />);
    const digestItems = screen.getAllByTestId('digest-item');
    expect(digestItems[0]).toHaveTextContent('重要タスク');
    expect(digestItems[1]).toHaveTextContent('高優先度');
  });

  it('shows max 5 items even when more provided', () => {
    const events = Array.from({ length: 8 }, (_, i) =>
      makeEvent({ id: `event_${i}`, priority: 'critical' })
    );
    renderWithProviders(<SmartDigest events={events} status={makeCompleteStatus()} loading={false} />);
    expect(screen.getAllByTestId('digest-item')).toHaveLength(5);
  });

  it('shows critical priority badge', () => {
    renderWithProviders(<SmartDigest events={[makeEvent()]} status={makeCompleteStatus()} loading={false} />);
    // critical items use priority='critical' for data-testid
    const badge = screen.getByTestId('priority-badge-critical');
    expect(badge).toHaveClass('bg-danger');
    expect(badge).toHaveTextContent('重要');
  });

  it('shows action button with correct label', () => {
    const event = makeEvent({ actionPath: '/proposals/99' });
    renderWithProviders(<SmartDigest events={[event]} status={makeCompleteStatus()} loading={false} />);
    // Action is a button that triggers onEventClick, not a Link
    expect(screen.getByText('今すぐ確認 →')).toBeInTheDocument();
  });

  it('renders header title', () => {
    renderWithProviders(<SmartDigest events={[]} status={makeCompleteStatus()} loading={false} />);
    expect(screen.getByText('今日やること')).toBeInTheDocument();
  });
});
