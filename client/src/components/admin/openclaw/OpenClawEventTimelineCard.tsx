import { Badge } from 'react-bootstrap';
import AppCard from '../../ui/AppCard';
import InlineLoader from '../../ui/InlineLoader';
import { formatDateTimeJa } from '../../../utils/formatters';
import type { RequestEventItem } from './types';

interface OpenClawEventTimelineCardProps {
  selectedRequestId: number | null;
  eventsLoading: boolean;
  events: RequestEventItem[];
}

/** Request Event Timeline 表示カード */
export default function OpenClawEventTimelineCard({
  selectedRequestId,
  eventsLoading,
  events,
}: OpenClawEventTimelineCardProps) {
  return (
    <AppCard className="mt-3">
      <AppCard.Header>Request Event Timeline</AppCard.Header>
      <AppCard.Body>
        {!selectedRequestId ? (
          <div className="text-muted small">要望を選択するとイベント履歴を確認できます。</div>
        ) : eventsLoading ? (
          <InlineLoader text="イベント履歴を読み込み中..." className="text-muted small" />
        ) : events.length === 0 ? (
          <div className="text-muted small">イベント履歴はまだありません。</div>
        ) : (
          <div className="d-flex flex-column gap-2">
            {events.map((event) => (
              <div key={event.id} className="border rounded p-3 bg-light">
                <div className="d-flex justify-content-between align-items-center gap-3 flex-wrap">
                  <div className="fw-semibold">{event.summary ?? event.eventType}</div>
                  <Badge bg="secondary">{event.eventType}</Badge>
                </div>
                {event.note ? <div className="small mt-2" style={{ whiteSpace: 'pre-wrap' }}>{event.note}</div> : null}
                <div className="text-muted small mt-2">{formatDateTimeJa(event.createdAt)}</div>
              </div>
            ))}
          </div>
        )}
      </AppCard.Body>
    </AppCard>
  );
}
