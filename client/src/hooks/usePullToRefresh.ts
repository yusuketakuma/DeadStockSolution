import { useCallback, useEffect, useRef, useState } from 'react';

type PullState = 'idle' | 'pulling' | 'refreshing' | 'complete';

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void>;
  threshold?: number;
  disabled?: boolean;
}

interface UsePullToRefreshReturn {
  containerRef: React.RefObject<HTMLDivElement | null>;
  pullDistance: number;
  state: PullState;
}

const MAX_PULL = 150;
const COMPLETE_DELAY = 500;

function isMobileViewport(): boolean {
  return typeof window !== 'undefined' &&
    window.matchMedia('(max-width: 991.98px)').matches;
}

export function usePullToRefresh(
  options: UsePullToRefreshOptions,
): UsePullToRefreshReturn {
  const { onRefresh, threshold = 80, disabled = false } = options;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [state, setState] = useState<PullState>('idle');
  const mountedRef = useRef(true);

  const startYRef = useRef(0);
  const stateRef = useRef<PullState>('idle');
  const pullRef = useRef(0);
  const rafIdRef = useRef(0);

  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  stateRef.current = state;

  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const thresholdRef = useRef(threshold);
  thresholdRef.current = threshold;

  const handleTouchStart = useCallback((e: Event) => {
    if (disabledRef.current || !isMobileViewport()) return;
    if (stateRef.current === 'refreshing' || stateRef.current === 'complete') return;

    const el = containerRef.current;
    if (!el || el.scrollTop > 0) return;

    const touch = (e as TouchEvent).changedTouches?.[0] ?? (e as TouchEvent).touches?.[0];
    if (!touch) return;

    startYRef.current = touch.clientY;
  }, []);

  const handleTouchMove = useCallback((e: Event) => {
    if (disabledRef.current || !isMobileViewport()) return;
    if (stateRef.current === 'refreshing' || stateRef.current === 'complete') return;
    if (startYRef.current === 0) return;

    const el = containerRef.current;
    if (!el) return;
    if (el.scrollTop > 0) {
      startYRef.current = 0;
      if (stateRef.current === 'pulling') {
        setState('idle');
        setPullDistance(0);
        pullRef.current = 0;
      }
      return;
    }

    const touch = (e as TouchEvent).touches?.[0];
    if (!touch) return;

    const delta = touch.clientY - startYRef.current;
    if (delta <= 0) return;

    e.preventDefault();

    cancelAnimationFrame(rafIdRef.current);
    rafIdRef.current = requestAnimationFrame(() => {
      const clamped = Math.min(delta, MAX_PULL);
      pullRef.current = clamped;
      setPullDistance(clamped);
      if (stateRef.current === 'idle') {
        setState('pulling');
      }
    });
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (disabledRef.current || !isMobileViewport()) return;
    if (stateRef.current === 'refreshing' || stateRef.current === 'complete') return;

    const distance = pullRef.current;
    startYRef.current = 0;

    if (stateRef.current !== 'pulling') return;

    if (distance >= thresholdRef.current) {
      setState('refreshing');
      stateRef.current = 'refreshing';

      onRefreshRef.current().then(() => {
        if (!mountedRef.current) return;
        setState('complete');
        stateRef.current = 'complete';
        setPullDistance(0);
        pullRef.current = 0;

        setTimeout(() => {
          if (!mountedRef.current) return;
          setState('idle');
          stateRef.current = 'idle';
        }, COMPLETE_DELAY);
      }).catch(() => {
        if (!mountedRef.current) return;
        setState('idle');
        stateRef.current = 'idle';
        setPullDistance(0);
        pullRef.current = 0;
      });
    } else {
      setState('idle');
      setPullDistance(0);
      pullRef.current = 0;
    }
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const origOverscroll = el.style.overscrollBehaviorY;
    el.style.overscrollBehaviorY = 'contain';

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      mountedRef.current = false;
      el.style.overscrollBehaviorY = origOverscroll;
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  return { containerRef, pullDistance, state };
}
