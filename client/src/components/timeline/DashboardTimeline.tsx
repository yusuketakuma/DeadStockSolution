import { useMemo } from 'react';
import { Badge, Button, ListGroup } from 'react-bootstrap';
import AppCard from '../ui/AppCard';
import InlineLoader from '../ui/InlineLoader';
import TimelineEventCard from './TimelineEventCard';
import type { TimelineEvent, TimelinePriority } from '../../types/timeline';

interface DashboardTimelineProps {
  events: TimelineEvent[];
  loading: boolean;
  hasMore: boolean;
  total: number;
  selectedPriority: TimelinePriority | null;
  onPriorityChange: (priority: TimelinePriority | null) => void;
  onLoadMore: () => void;
  onEventClick: (event: TimelineEvent) => void;
  onRefresh: () => void;
  error?: string;
  className?: string;
}

const PRIORITY_FILTERS: Array<{ label: string; value: TimelinePriority | null }> = [
  { label: 'すべて', value: null },
  { label: '緊急', value: 'critical' },
  { label: '重要', value: 'high' },
  { label: '通常', value: 'medium' },
  { label: 'その他', value: 'low' },
];

export default function DashboardTimeline({
  events,
  loading,
  hasMore,
  total,
  selectedPriority,
  onPriorityChange,
  onLoadMore,
  onEventClick,
  onRefresh,
  error,
  className,
}: DashboardTimelineProps) {
  const renderedEvents = useMemo(
    () => events.map((event) => <TimelineEventCard key={event.id} event={event} onClick={onEventClick} />),
    [events, onEventClick],
  );

  return (
    <AppCard className={`d-flex flex-column ${className ?? ''}`} style={{ minHeight: 0 }}>
      <AppCard.Header className="flex-shrink-0 py-2 px-3">
        <div className="d-flex justify-content-between align-items-center mb-1">
          <span className="fw-semibold small">タイムライン</span>
          <div className="d-flex gap-2 align-items-center">
            {total > 0 && <Badge bg="secondary">{total}件</Badge>}
            <Button size="sm" variant="outline-secondary" onClick={onRefresh} disabled={loading}>
              更新
            </Button>
          </div>
        </div>

        <div className="d-flex gap-1 flex-wrap">
          {PRIORITY_FILTERS.map(({ label, value }) => (
            <Button
              key={label}
              size="sm"
              variant={selectedPriority === value ? 'primary' : 'outline-secondary'}
              onClick={() => onPriorityChange(value)}
            >
              {label}
            </Button>
          ))}
        </div>

        {error && (
          <div className="text-danger small mt-1">
            {error}
            <Button size="sm" variant="outline-danger" className="ms-2" onClick={onRefresh}>
              再試行
            </Button>
          </div>
        )}

        {loading && <InlineLoader text="読み込み中..." className="text-muted small mt-1" />}
      </AppCard.Header>

      <AppCard.Body className="flex-grow-1 p-0" style={{ overflowY: 'auto', minHeight: 0 }}>
        {!loading && events.length === 0 && !error && (
          <div className="text-muted small px-3 py-3 text-center">タイムラインにイベントはありません</div>
        )}

        {events.length > 0 && (
          <ListGroup variant="flush">
            {renderedEvents}
          </ListGroup>
        )}

        {hasMore && (
          <div className="text-center py-2">
            <Button size="sm" variant="outline-secondary" onClick={onLoadMore} disabled={loading}>
              もっと見る
            </Button>
          </div>
        )}
      </AppCard.Body>
    </AppCard>
  );
}
