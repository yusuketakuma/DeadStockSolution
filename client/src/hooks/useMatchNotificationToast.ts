import { useEffect, useRef } from 'react';
import { useToast } from '../contexts/ToastContext';
import { useTimeline } from '../contexts/TimelineContext';

export function useMatchNotificationToast() {
  const { showInfo } = useToast();
  const { events } = useTimeline();
  const prevUnreadMatchIdsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    const unreadMatchIds = new Set(
      events
        .filter((event) => !event.isRead && (event.source === 'match' || event.type === 'match_update'))
        .map((event) => event.id),
    );

    const hasNewUnreadMatch = prevUnreadMatchIdsRef.current !== null
      && Array.from(unreadMatchIds).some((id) => !prevUnreadMatchIdsRef.current?.has(id));

    if (hasNewUnreadMatch) {
      showInfo('新しいマッチング候補が見つかりました');
    }

    prevUnreadMatchIdsRef.current = unreadMatchIds;
  }, [events, showInfo]);
}
