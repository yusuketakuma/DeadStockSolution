import { useEffect, useRef, useState } from 'react';
import { buildApiUrl } from '../api/client';
import { usePolledFetch } from './usePolledFetch';

interface UseSseRefreshOptions {
  enabled: boolean;
  streamPath: string;
  events: string[];
  onRefresh: () => Promise<void> | void;
  fallbackIntervalMs?: number;
  minFetchIntervalMs?: number;
}

export function useSseRefresh(options: UseSseRefreshOptions): { connected: boolean } {
  const {
    enabled,
    streamPath,
    events,
    onRefresh,
    fallbackIntervalMs = 60_000,
    minFetchIntervalMs = 5_000,
  } = options;

  const [connected, setConnected] = useState(false);
  const onRefreshRef = useRef(onRefresh);
  const eventsRef = useRef(events);
  onRefreshRef.current = onRefresh;
  eventsRef.current = events;
  const eventsKey = events.join('|');

  useEffect(() => {
    if (!enabled) {
      setConnected(false);
      return;
    }

    if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
      setConnected(false);
      return;
    }

    const source = new EventSource(buildApiUrl(streamPath), { withCredentials: true });

    source.onopen = () => {
      setConnected(true);
    };

    source.onerror = () => {
      setConnected(false);
    };

    const listeners = eventsRef.current.map((eventName) => {
      const handler = () => {
        void onRefreshRef.current();
      };
      source.addEventListener(eventName, handler);
      return { eventName, handler };
    });

    return () => {
      for (const listener of listeners) {
        source.removeEventListener(listener.eventName, listener.handler);
      }
      source.close();
    };
  }, [enabled, eventsKey, streamPath]);

  usePolledFetch(async () => {
    await onRefreshRef.current();
  }, {
    enabled: enabled && !connected,
    intervalMs: fallbackIntervalMs,
    minFetchIntervalMs,
  });

  return { connected };
}
