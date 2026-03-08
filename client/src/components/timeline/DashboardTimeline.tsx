import { useMemo } from 'react';
import { Badge, Button, ListGroup } from 'react-bootstrap';
import AppCard from '../ui/AppCard';
import InlineLoader from '../ui/InlineLoader';
import TimelineEventCard from './TimelineEventCard';
import type { TimelineEvent, TimelinePriority } from '../../types/timeline';

function getDateLabel(timestamp: string): string {
  const eventDate = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (isSameDay(eventDate, today)) return '今日';
  if (isSameDay(eventDate, yesterday)) return '昨日';
  return `${eventDate.getFullYear()}/${eventDate.getMonth() + 1}/${eventDate.getDate()}`;
}

function groupEventsByDate(events: TimelineEvent[]): Array<{ label: string; events: TimelineEvent[] }> {
  const groups: Array<{ label: string; events: TimelineEvent[] }> = [];
  let currentLabel = '';
  for (const event of events) {
    const label = getDateLabel(event.timestamp);
    if (label !== currentLabel) {
      groups.push({ label, events: [event] });
      currentLabel = label;
    } else {
      groups[groups.length - 1].events.push(event);
    }
  }
  return groups;
}

interface DashboardTimelineProps {
  events: TimelineEvent[];
  loading: boolean;
  hasMore: boolean;
  total: number;
  selectedPriority: TimelinePriority | null;
  onPriorityChange: (priority: TimelinePriority | null) => void;
  onLoadMore: () => void;
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
  onRefresh,
  error,
  className,
}: DashboardTimelineProps) {
  const dateGroups = useMemo(() => groupEventsByDate(events), [events]);

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
            {dateGroups.map((group) => (
              <div key={group.label}>
                <div data-testid="date-header" className="px-3 py-1 bg-light small fw-semibold text-muted">{group.label}</div>
                {group.events.map((event) => (
                  <TimelineEventCard key={event.id} event={event} />
                ))}
              </div>
            ))}
          </ListGroup>
        )}

        {hasMore && (
          <div className="text-center py-2">
            <Button size="sm" variant="outline-secondary" onClick={onLoadMore} disabled={loading} data-testid="load-more-button">
              もっと見る
            </Button>
          </div>
        )}
      </AppCard.Body>
    </AppCard>
  );
}
