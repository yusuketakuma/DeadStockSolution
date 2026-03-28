import { useState } from 'react';
import type { EnrichedProposalTimelineEvent } from '../../types/timeline';
import AppCard from '../ui/AppCard';
import AppEmptyState from '../ui/AppEmptyState';
import AppSelect from '../ui/AppSelect';

const EVENT_ICON: Record<EnrichedProposalTimelineEvent['eventType'], string> = {
  status_change: '🔄',
  comment: '💬',
  feedback: '⭐',
  item_detail: '📋',
};

function formatTimestamp(at: string | null): string {
  if (!at) return '日時不明';
  return new Date(at).toLocaleString('ja-JP');
}

function truncate(text: string, maxLen = 60): string {
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

function getNextStepMessage(events: EnrichedProposalTimelineEvent[]): string | null {
  if (events.length === 0) return null;
  const lastAction = events[events.length - 1].action;

  if (lastAction.includes('proposal_expired')) return '有効期限切れで自動却下されました。必要なら条件を見直して再提案してください。';
  if (lastAction.includes('proposal_expiry_reminder')) return '期限が近い提案です。期限内に承認または拒否を行ってください。';
  if (lastAction.includes('proposal_accept')) return '承認済みです。相手薬局の確認または確定手続きへ進んでください。';
  if (lastAction.includes('proposal_reject') || lastAction.includes('proposal_rejected')) return '提案が拒否されました。';
  if (lastAction.includes('proposal_complete')) return '交換完了が記録されました。必要に応じて評価を登録してください。';
  if (lastAction.includes('proposed')) return '承認または拒否を待っています。';
  return null;
}

function getEventKey(event: EnrichedProposalTimelineEvent, index: number): string {
  return [
    event.action,
    event.at ?? 'pending',
    event.actorPharmacyId ?? 'anonymous',
    event.label,
    index,
  ].join(':');
}

function StarRating({ rating }: { rating: number }) {
  return (
    <span aria-label={`評価${rating}点`} data-testid="star-rating">
      {'⭐'.repeat(Math.max(0, Math.min(5, rating)))}
    </span>
  );
}

interface ProposalTimelineProps {
  events: EnrichedProposalTimelineEvent[];
  currentPharmacyId: number;
}

export default function ProposalTimeline({ events }: ProposalTimelineProps) {
  const [filter, setFilter] = useState<'all' | 'decision'>('all');
  const filteredEvents = filter === 'all'
    ? events
    : events.filter((e) => ['proposal_accept', 'proposal_reject', 'proposal_complete'].includes(e.action));
  const nextStep = getNextStepMessage(events);

  if (events.length === 0) {
    return <AppEmptyState title="履歴はありません" />;
  }

  return (
    <div data-testid="proposal-timeline">
      <div className="mb-2" style={{ maxWidth: 280 }}>
        <AppSelect
          controlId="proposal-timeline-filter"
          value={filter}
          ariaLabel="進行履歴フィルタ"
          onChange={(value) => setFilter(value as 'all' | 'decision')}
          options={[
            { value: 'all', label: 'すべて表示' },
            { value: 'decision', label: '承認/拒否/完了のみ' },
          ]}
        />
      </div>
      <div style={{ position: 'relative', paddingLeft: '28px' }}>
        {/* Vertical line */}
        <div
          style={{
            position: 'absolute',
            left: '10px',
            top: '6px',
            bottom: '6px',
            borderLeft: '2px solid #dee2e6',
          }}
        />

        {filteredEvents.length === 0 ? (
          <div className="text-muted">表示できる履歴はありません。</div>
        ) : filteredEvents.map((event, i) => {
          const isCompleted = event.at !== null;
          const icon = EVENT_ICON[event.eventType];
          const isLast = i === filteredEvents.length - 1;

          return (
            <div
              key={getEventKey(event, i)}
              style={{ position: 'relative', marginBottom: isLast ? 0 : '20px' }}
              data-testid="timeline-node"
            >
              {/* Node dot */}
              <div
                style={{
                  position: 'absolute',
                  left: '-22px',
                  top: '4px',
                  width: '14px',
                  height: '14px',
                  borderRadius: '50%',
                  backgroundColor: isCompleted ? '#0d6efd' : 'white',
                  border: '2px solid #0d6efd',
                }}
                data-testid={isCompleted ? 'node-completed' : 'node-pending'}
              />

              <div>
                <div className="d-flex align-items-center gap-2 mb-1">
                  <span aria-label={`icon-${event.eventType}`}>{icon}</span>
                  <strong>{event.label}</strong>
                  <span className="text-muted small">
                    — {event.actorName ?? '不明'}
                  </span>
                </div>

                <div className="text-muted small mb-1">
                  {formatTimestamp(event.at)}
                </div>

                {event.eventType === 'comment' && event.commentBody && (
                  <div
                    className="small bg-light p-2 rounded"
                    data-testid="comment-preview"
                  >
                    {truncate(event.commentBody)}
                  </div>
                )}

                {event.eventType === 'feedback' && event.feedbackRating != null && (
                  <div className="small mb-1">
                    <StarRating rating={event.feedbackRating} />
                    {event.feedbackComment && (
                      <span className="text-muted ms-2">{truncate(event.feedbackComment)}</span>
                    )}
                  </div>
                )}

                {event.statusFrom && event.statusTo && (
                  <div className="text-muted small">
                    [{event.statusFrom} → {event.statusTo}]
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {nextStep && (
        <AppCard className="mt-3 border-primary" data-testid="next-step-indicator">
          <AppCard.Body className="py-2 small">
            <strong>次のステップ:</strong> {nextStep}
          </AppCard.Body>
        </AppCard>
      )}
    </div>
  );
}
