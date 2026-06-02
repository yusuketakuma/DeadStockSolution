import { useMemo } from 'react';
import { Badge, Button, ListGroup } from 'react-bootstrap';
import AppCard from '../ui/AppCard';
import InlineLoader from '../ui/InlineLoader';
import TimelineEventCard from './TimelineEventCard';
import type { TimelineEvent, TimelinePriority } from '../../types/timeline';

function getDateLabel(timestamp: string): string {
  const jstOptions = { timeZone: 'Asia/Tokyo' as const };
  const fmt = (d: Date) => {
    const parts = new Intl.DateTimeFormat('en-CA', { ...jstOptions, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    return parts; // YYYY-MM-DD
  };

  const eventDate = new Date(timestamp);
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000);

  const eventStr = fmt(eventDate);
  if (eventStr === fmt(now)) return '今日';
  if (eventStr === fmt(yesterday)) return '昨日';

  const [y, m, d] = eventStr.split('-');
  return `${y}/${Number(m)}/${Number(d)}`;
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

function getActiveFilterLabel(priority: TimelinePriority | null): string {
  return PRIORITY_FILTERS.find((filter) => filter.value === priority)?.label ?? 'すべて';
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
  const activeFilterLabel = getActiveFilterLabel(selectedPriority);
  const visibleCount = events.length;
  const remainingCount = Math.max(total - visibleCount, 0);

  return (
    <AppCard className={`d-flex flex-column dl-dashboard-timeline ${className ?? ''}`}>
      <AppCard.Header className="flex-shrink-0 py-3 px-3 border-0">
        <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-2">
          <div>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <span className="fw-semibold">タイムライン</span>
              <Badge bg="secondary">{visibleCount}件表示</Badge>
            </div>
            <div className="text-muted small mt-1">
              {selectedPriority ? `絞り込み: ${activeFilterLabel}` : '最新イベントを時系列で表示'}
              {total > 0 ? ` ・ 全${total}件` : ''}
            </div>
          </div>
          <div className="d-flex gap-2 align-items-center">
            <Button size="sm" variant="outline-secondary" onClick={onRefresh} disabled={loading}>
              更新
            </Button>
          </div>
        </div>

        <div className="dl-action-row mobile-stack align-items-center">
          {PRIORITY_FILTERS.map(({ label, value }) => (
            <Button
              key={label}
              size="sm"
              variant={selectedPriority === value ? 'primary' : 'outline-secondary'}
              className="rounded-pill px-3"
              onClick={() => onPriorityChange(value)}
              aria-pressed={selectedPriority === value}
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

      <AppCard.Body className="p-0">
        {!loading && events.length === 0 && !error && (
          <div className="text-muted small px-3 py-4 text-center">タイムラインにイベントはありません</div>
        )}

        {events.length > 0 && (
          <ListGroup variant="flush" className="dl-timeline-list">
            {dateGroups.map((group) => (
              <section key={group.label} className="dl-timeline-group">
                <div data-testid="date-header" className="dl-timeline-date-header">
                  <span>{group.label}</span>
                  <span className="text-muted">{group.events.length}件</span>
                </div>
                {group.events.map((event) => (
                  <TimelineEventCard key={event.id} event={event} />
                ))}
              </section>
            ))}
          </ListGroup>
        )}

        {hasMore && (
          <div className="text-center py-2">
            <Button size="sm" variant="outline-secondary" onClick={onLoadMore} disabled={loading} data-testid="load-more-button">
              {remainingCount > 0 ? `さらに${remainingCount}件を見る` : 'もっと見る'}
            </Button>
          </div>
        )}
      </AppCard.Body>
    </AppCard>
  );
}
