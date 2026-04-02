import { useEffect, useRef } from 'react';
import { useToast } from '../contexts/ToastContext';
import { useTimeline } from '../contexts/TimelineContext';

interface LatestUnreadMatchState {
  timestamp: number;
  idsAtTimestamp: Set<string>;
}

function resolveLatestUnreadMatchState(events: ReturnType<typeof useTimeline>['events']): LatestUnreadMatchState | null {
  let latestTimestamp = Number.NEGATIVE_INFINITY;
  const idsAtTimestamp = new Set<string>();

  for (const event of events) {
    if (event.isRead || event.source !== 'match' || event.type !== 'match_update') {
      continue;
    }

    const timestamp = Date.parse(event.timestamp);
    if (!Number.isFinite(timestamp)) {
      continue;
    }

    if (timestamp > latestTimestamp) {
      latestTimestamp = timestamp;
      idsAtTimestamp.clear();
      idsAtTimestamp.add(event.id);
      continue;
    }

    if (timestamp === latestTimestamp) {
      idsAtTimestamp.add(event.id);
    }
  }

  if (!Number.isFinite(latestTimestamp)) {
    return null;
  }

  return { timestamp: latestTimestamp, idsAtTimestamp };
}

export function useMatchNotificationToast() {
  const { showInfo } = useToast();
  const { events } = useTimeline();
  const prevLatestUnreadMatchRef = useRef<LatestUnreadMatchState | null>(null);
  const hasHydratedRef = useRef(false);

  useEffect(() => {
    const latestUnreadMatch = resolveLatestUnreadMatchState(events);
    const previousLatestUnreadMatch = prevLatestUnreadMatchRef.current;
    const hasNewUnreadMatch = hasHydratedRef.current
      && latestUnreadMatch !== null
      && (
        previousLatestUnreadMatch === null
        || (
          latestUnreadMatch.timestamp > previousLatestUnreadMatch.timestamp
          || (
            latestUnreadMatch.timestamp === previousLatestUnreadMatch.timestamp
            && Array.from(latestUnreadMatch.idsAtTimestamp).some((id) => !previousLatestUnreadMatch.idsAtTimestamp.has(id))
          )
        )
      );

    if (hasNewUnreadMatch) {
      showInfo('新しいマッチング候補が見つかりました');
    }

    hasHydratedRef.current = true;
    prevLatestUnreadMatchRef.current = latestUnreadMatch;
  }, [events, showInfo]);
}
