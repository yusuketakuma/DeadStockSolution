import { Badge, Button, ListGroup } from 'react-bootstrap';
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
  return (
    <div className={`d-flex flex-column ${className ?? ''}`} style={{ minHeight: 0 }}>
      <div className="flex-shrink-0">
        <div className="d-flex justify-content-between align-items-center mb-1">
          <span className="fw-semibold">タイムライン</span>
          <div className="d-flex gap-2 align-items-center">
            {total > 0 && <Badge bg="secondary">{total}件</Badge>}
            <Button size="sm" variant="outline-secondary" onClick={onRefresh} disabled={loading}>
              更新
            </Button>
          </div>
        </div>

        <div className="d-flex gap-1 flex-wrap mb-1">
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
          <div className="text-danger small mb-1">
            {error}
            <Button size="sm" variant="outline-danger" className="ms-2" onClick={onRefresh}>
              再試行
            </Button>
          </div>
        )}

        {loading && <InlineLoader text="読み込み中..." className="text-muted small" />}
      </div>

      <div className="flex-grow-1" style={{ overflowY: 'auto', minHeight: 0 }}>
        {!loading && events.length === 0 && !error && (
          <div className="text-muted small">タイムラインにイベントはありません</div>
        )}

        {events.length > 0 && (
          <ListGroup variant="flush">
            {events.map((event) => (
              <TimelineEventCard key={event.id} event={event} onClick={onEventClick} />
            ))}
          </ListGroup>
        )}

        {hasMore && (
          <div className="text-center mt-1">
            <Button size="sm" variant="outline-secondary" onClick={onLoadMore} disabled={loading}>
              もっと見る
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
