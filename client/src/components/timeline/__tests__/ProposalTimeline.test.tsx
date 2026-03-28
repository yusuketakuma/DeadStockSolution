import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/helpers';
import ProposalTimeline from '../ProposalTimeline';
import type { EnrichedProposalTimelineEvent } from '../../../types/timeline';

function makeEvent(overrides: Partial<EnrichedProposalTimelineEvent> = {}): EnrichedProposalTimelineEvent {
  return {
    action: 'proposed',
    label: '提案送信',
    at: new Date().toISOString(),
    actorPharmacyId: 1,
    actorName: 'テスト薬局A',
    eventType: 'status_change',
    ...overrides,
  };
}

describe('ProposalTimeline', () => {
  it('shows empty state when events is empty', () => {
    renderWithProviders(<ProposalTimeline events={[]} currentPharmacyId={1} />);
    expect(screen.getByText('履歴はありません')).toBeInTheDocument();
  });

  it('renders N nodes for N events', () => {
    const events = [
      makeEvent({ action: 'proposed' }),
      makeEvent({ action: 'proposal_approved', label: '承認' }),
      makeEvent({ action: 'completed', label: '完了' }),
    ];
    renderWithProviders(<ProposalTimeline events={events} currentPharmacyId={1} />);
    expect(screen.getAllByTestId('timeline-node')).toHaveLength(3);
  });

  it('shows actor name for each event', () => {
    const events = [makeEvent({ actorName: 'やくきょくB' })];
    renderWithProviders(<ProposalTimeline events={events} currentPharmacyId={1} />);
    expect(screen.getByText(/やくきょくB/)).toBeInTheDocument();
  });

  it('shows completed node (filled) when event has timestamp', () => {
    const events = [makeEvent({ at: new Date().toISOString() })];
    renderWithProviders(<ProposalTimeline events={events} currentPharmacyId={1} />);
    expect(screen.getByTestId('node-completed')).toBeInTheDocument();
  });

  it('shows pending node (empty) when event has no timestamp', () => {
    const events = [makeEvent({ at: null })];
    renderWithProviders(<ProposalTimeline events={events} currentPharmacyId={1} />);
    expect(screen.getByTestId('node-pending')).toBeInTheDocument();
  });

  it('shows comment preview for comment events', () => {
    const events = [
      makeEvent({
        eventType: 'comment',
        commentBody: 'これはテストコメントです',
      }),
    ];
    renderWithProviders(<ProposalTimeline events={events} currentPharmacyId={1} />);
    expect(screen.getByTestId('comment-preview')).toHaveTextContent('これはテストコメントです');
  });

  it('shows star rating for feedback events', () => {
    const events = [
      makeEvent({
        eventType: 'feedback',
        feedbackRating: 4,
      }),
    ];
    renderWithProviders(<ProposalTimeline events={events} currentPharmacyId={1} />);
    const rating = screen.getByTestId('star-rating');
    expect(rating).toHaveTextContent('⭐⭐⭐⭐');
  });

  it('shows correct icon for each event type', () => {
    const statusEvent = makeEvent({ eventType: 'status_change', label: 'ステータス変更' });
    const commentEvent = makeEvent({ eventType: 'comment', label: 'コメント', commentBody: 'test' });
    renderWithProviders(
      <ProposalTimeline events={[statusEvent, commentEvent]} currentPharmacyId={1} />
    );
    expect(screen.getAllByText('🔄').length).toBeGreaterThan(0);
    expect(screen.getAllByText('💬').length).toBeGreaterThan(0);
  });

  it('shows next step indicator for accepted proposal', () => {
    const events = [makeEvent({ action: 'proposal_accept' })];
    renderWithProviders(<ProposalTimeline events={events} currentPharmacyId={1} />);
    expect(screen.getByTestId('next-step-indicator')).toHaveTextContent(
      '承認済みです。相手薬局の確認または確定手続きへ進んでください。'
    );
  });

  it('shows rejection message for rejected proposal', () => {
    const events = [makeEvent({ action: 'proposal_rejected' })];
    renderWithProviders(<ProposalTimeline events={events} currentPharmacyId={1} />);
    expect(screen.getByTestId('next-step-indicator')).toHaveTextContent(
      '提案が拒否されました。'
    );
  });

  it('shows waiting message for pending proposal', () => {
    const events = [makeEvent({ action: 'proposed' })];
    renderWithProviders(<ProposalTimeline events={events} currentPharmacyId={1} />);
    expect(screen.getByTestId('next-step-indicator')).toHaveTextContent(
      '承認または拒否を待っています。'
    );
  });

  it('shows reminder message for reminder event', () => {
    const events = [makeEvent({ action: 'proposal_expiry_reminder' })];
    renderWithProviders(<ProposalTimeline events={events} currentPharmacyId={1} />);
    expect(screen.getByTestId('next-step-indicator')).toHaveTextContent(
      '期限が近い提案です。期限内に承認または拒否を行ってください。'
    );
  });

  it('shows expiry message for expired proposal', () => {
    const events = [makeEvent({ action: 'proposal_expired' })];
    renderWithProviders(<ProposalTimeline events={events} currentPharmacyId={1} />);
    expect(screen.getByTestId('next-step-indicator')).toHaveTextContent(
      '有効期限切れで自動却下されました。必要なら条件を見直して再提案してください。'
    );
  });
});
