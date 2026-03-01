import { useMemo, useState } from 'react';
import AppSelect from '../ui/AppSelect';
import { formatDateTimeJa } from '../../utils/formatters';
import {
  filterProposalTimelineEvents,
  PROPOSAL_TIMELINE_FILTER_OPTIONS,
  type ProposalTimelineEvent,
  type ProposalTimelineFilter,
} from '../../utils/proposal-timeline';

interface ProposalTimelineProps {
  events: ProposalTimelineEvent[];
  statusLabelFormatter?: (status: string) => string;
  emptyMessage?: string;
  filterAriaLabel?: string;
}

function resolveActionMarker(action: string): string {
  if (action === 'proposal_accept') return 'OK';
  if (action === 'proposal_reject') return 'NO';
  if (action === 'proposal_complete') return 'END';
  if (action === 'proposal_created') return 'NEW';
  return 'UPD';
}

export default function ProposalTimeline({
  events,
  statusLabelFormatter,
  emptyMessage = '履歴はありません。',
  filterAriaLabel = '進行履歴フィルタ',
}: ProposalTimelineProps) {
  const [filter, setFilter] = useState<ProposalTimelineFilter>('all');

  const filtered = useMemo(
    () => filterProposalTimelineEvents(events, filter),
    [events, filter],
  );

  return (
    <div>
      <div className="mb-2" style={{ maxWidth: 280 }}>
        <AppSelect
          controlId="proposal-timeline-filter"
          value={filter}
          ariaLabel={filterAriaLabel}
          onChange={(value) => setFilter(value as ProposalTimelineFilter)}
          options={PROPOSAL_TIMELINE_FILTER_OPTIONS}
        />
      </div>
      {filtered.length === 0 ? (
        <div className="small text-muted">{emptyMessage}</div>
      ) : (
        <ul className="list-unstyled mb-0">
          {filtered.map((event, idx) => {
            const isLast = idx === filtered.length - 1;
            return (
              <li key={`${event.action}-${event.at ?? 'na'}-${idx}`} className={isLast ? '' : 'pb-3'}>
                <div className="d-flex gap-2">
                  <div className="d-flex flex-column align-items-center">
                    <span
                      className="rounded-circle border text-center small fw-semibold bg-light"
                      style={{ minWidth: 40, height: 24, lineHeight: '22px' }}
                    >
                      {resolveActionMarker(event.action)}
                    </span>
                    {!isLast && (
                      <span
                        className="border-start mt-1"
                        style={{ minHeight: 24 }}
                        aria-hidden
                      />
                    )}
                  </div>
                  <div className="flex-grow-1">
                    <div className="d-flex align-items-center gap-2 flex-wrap">
                      <strong>{event.label}</strong>
                      {event.statusFrom && event.statusTo && (
                        <span className="small text-muted">
                          [
                          {statusLabelFormatter ? statusLabelFormatter(event.statusFrom) : event.statusFrom}
                          {' -> '}
                          {statusLabelFormatter ? statusLabelFormatter(event.statusTo) : event.statusTo}
                          ]
                        </span>
                      )}
                    </div>
                    <div className="small text-muted">
                      {event.actorName ?? '不明'} / {formatDateTimeJa(event.at, '日時不明')}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
