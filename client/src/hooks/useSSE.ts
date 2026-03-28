import { useRef } from 'react';
import { useSseRefresh } from './useSseRefresh';

interface UseSSEOptions {
  onNotification: (data: unknown) => void;
  enabled?: boolean;
}

/**
 * Legacy compatibility wrapper.
 *
 * New code should use useSseRefresh() directly with /realtime/stream topics.
 * This hook stays as a thin adapter so any older callsite still rides the
 * primary realtime path instead of the deprecated /api/sse/events endpoint.
 */
export function useSSE({ onNotification, enabled = true }: UseSSEOptions): void {
  const onNotificationRef = useRef(onNotification);
  onNotificationRef.current = onNotification;

  useSseRefresh({
    enabled,
    streamPath: '/realtime/stream?topics=timeline',
    events: ['timeline.refresh'],
    onRefresh: async () => {
      onNotificationRef.current({ type: 'timeline.refresh' });
    },
    fallbackIntervalMs: 60_000,
    minFetchIntervalMs: 5_000,
  });
}
