import { Badge, ListGroup } from 'react-bootstrap';
import AppCard from '../ui/AppCard';
import InlineLoader from '../ui/InlineLoader';
import type { TimelineEvent } from '../../types/timeline';

const MAX_ITEMS = 5;

interface SmartDigestProps {
  events: TimelineEvent[];
  loading: boolean;
  onEventClick?: (event: TimelineEvent) => void;
}

function PriorityBadge({ priority }: { priority: TimelineEvent['priority'] }) {
  if (priority === 'critical') {
    return <Badge bg="danger">緊急</Badge>;
  }
  return (
    <Badge bg="warning" text="dark">
      重要
    </Badge>
  );
}

export default function SmartDigest({ events, loading, onEventClick }: SmartDigestProps) {
  const displayEvents = events.slice(0, MAX_ITEMS);

  return (
    <AppCard className="mb-3">
      <AppCard.Header className="d-flex align-items-center justify-content-between py-2 px-3">
        <span className="fw-semibold small">今日のアクション</span>
        {!loading && (
          <Badge bg="secondary" pill>
            {events.length}
          </Badge>
        )}
      </AppCard.Header>

      <AppCard.Body className="p-0">
        {loading ? (
          <div className="px-3 py-2">
            <InlineLoader text="読み込み中..." />
          </div>
        ) : displayEvents.length === 0 ? (
          <div className="px-3 py-3 text-muted small text-center">
            対応が必要なタスクはありません
          </div>
        ) : (
          <ListGroup variant="flush">
            {displayEvents.map((event) => (
              <ListGroup.Item key={event.id} className="px-3 py-2">
                <div className="d-flex align-items-center justify-content-between gap-2">
                  <div className="d-flex align-items-center gap-2 min-w-0 flex-grow-1">
                    <PriorityBadge priority={event.priority} />
                    <span
                      className="small text-truncate"
                      style={{ maxWidth: '100%' }}
                    >
                      {event.title}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-link btn-sm p-0 text-nowrap small"
                    onClick={() => onEventClick?.(event)}
                  >
                    確認する →
                  </button>
                </div>
              </ListGroup.Item>
            ))}
          </ListGroup>
        )}
      </AppCard.Body>
    </AppCard>
  );
}
