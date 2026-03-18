import { useCallback, useEffect, useRef, useState } from 'react';

interface UseSwipeActionOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  threshold?: number; // default: 20% of element width (min 60px, max 100px)
  disabled?: boolean;
}

interface UseSwipeActionReturn {
  ref: React.RefObject<HTMLDivElement | null>;
  offset: number; // current translateX offset in px
  isSwiping: boolean; // true during active swipe gesture
  direction: 'left' | 'right' | null;
}

const MIN_THRESHOLD = 60;
const MAX_THRESHOLD = 100;
const DEFAULT_WIDTH_RATIO = 0.2;

// Velocity thresholds (px/ms)
const FAST_FLICK_VELOCITY = 0.5;
const SLOW_SWIPE_VELOCITY = 0.3;

// Angle threshold in radians (30 degrees)
const MAX_ANGLE_RAD = (30 * Math.PI) / 180;

export function useSwipeAction(options: UseSwipeActionOptions = {}): UseSwipeActionReturn {
  const { onSwipeLeft, onSwipeRight, threshold, disabled = false } = options;

  const elRef = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [direction, setDirection] = useState<'left' | 'right' | null>(null);

  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const startTimeRef = useRef(0);
  const activeRef = useRef(false); // swipe gesture recognised
  const lockedOutRef = useRef(false); // vertical scroll detected, ignore rest of gesture
  const rafIdRef = useRef(0);
  const offsetRef = useRef(0);

  // Keep callback refs stable
  const onSwipeLeftRef = useRef(onSwipeLeft);
  onSwipeLeftRef.current = onSwipeLeft;
  const onSwipeRightRef = useRef(onSwipeRight);
  onSwipeRightRef.current = onSwipeRight;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const thresholdRef = useRef(threshold);
  thresholdRef.current = threshold;

  function computeThreshold(elWidth: number): number {
    if (thresholdRef.current != null) return thresholdRef.current;
    const t = elWidth * DEFAULT_WIDTH_RATIO;
    return Math.max(MIN_THRESHOLD, Math.min(t, MAX_THRESHOLD));
  }

  function velocityAdjustedThreshold(baseThreshold: number, elWidth: number, velocity: number): number {
    if (velocity >= FAST_FLICK_VELOCITY) {
      // fast flick: 15% of width
      return Math.max(MIN_THRESHOLD, Math.min(elWidth * 0.15, MAX_THRESHOLD));
    }
    if (velocity < SLOW_SWIPE_VELOCITY) {
      // slow swipe: 25% of width
      return Math.max(MIN_THRESHOLD, Math.min(elWidth * 0.25, MAX_THRESHOLD));
    }
    return baseThreshold;
  }

  const handleTouchStart = useCallback((e: Event) => {
    if (disabledRef.current) return;

    const touch = (e as TouchEvent).touches?.[0];
    if (!touch) return;

    startXRef.current = touch.clientX;
    startYRef.current = touch.clientY;
    startTimeRef.current = Date.now();
    activeRef.current = false;
    lockedOutRef.current = false;

    // will-change: transform for GPU compositing
    const el = elRef.current;
    if (el) {
      el.style.willChange = 'transform';
    }
  }, []);

  const handleTouchMove = useCallback((e: Event) => {
    if (disabledRef.current || lockedOutRef.current) return;
    if (startXRef.current === 0 && startYRef.current === 0) return;

    const touch = (e as TouchEvent).touches?.[0];
    if (!touch) return;

    const dx = touch.clientX - startXRef.current;
    const dy = touch.clientY - startYRef.current;

    // First significant move: check angle
    if (!activeRef.current) {
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      // Wait for a minimum movement before deciding
      if (absDx < 5 && absDy < 5) return;

      const angle = Math.atan2(absDy, absDx);
      if (angle > MAX_ANGLE_RAD) {
        // Vertical scroll — ignore this gesture entirely
        lockedOutRef.current = true;
        return;
      }
      activeRef.current = true;
    }

    cancelAnimationFrame(rafIdRef.current);
    rafIdRef.current = requestAnimationFrame(() => {
      offsetRef.current = dx;
      setOffset(dx);
      setIsSwiping(true);
      setDirection(dx < 0 ? 'left' : dx > 0 ? 'right' : null);
    });
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (disabledRef.current) return;

    const el = elRef.current;

    // Clean up will-change
    if (el) {
      el.style.willChange = '';
    }

    if (!activeRef.current) {
      // Reset start refs
      startXRef.current = 0;
      startYRef.current = 0;
      return;
    }

    const dx = offsetRef.current;
    const absDx = Math.abs(dx);
    const elapsed = Date.now() - startTimeRef.current;
    const velocity = elapsed > 0 ? absDx / elapsed : 0;

    const elWidth = el?.offsetWidth ?? 300;
    const baseThreshold = computeThreshold(elWidth);
    const effectiveThreshold = thresholdRef.current != null
      ? thresholdRef.current
      : velocityAdjustedThreshold(baseThreshold, elWidth, velocity);

    if (absDx >= effectiveThreshold) {
      if (dx < 0 && onSwipeLeftRef.current) {
        onSwipeLeftRef.current();
      } else if (dx > 0 && onSwipeRightRef.current) {
        onSwipeRightRef.current();
      }
    }

    // Snap back
    offsetRef.current = 0;
    setOffset(0);
    setIsSwiping(false);
    setDirection(null);

    activeRef.current = false;
    startXRef.current = 0;
    startYRef.current = 0;
  }, []);

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    // Set touch-action for vertical scrolling passthrough
    const origTouchAction = el.style.touchAction;
    el.style.touchAction = 'pan-y';

    el.addEventListener('touchstart', handleTouchStart, { passive: true });
    el.addEventListener('touchmove', handleTouchMove, { passive: false });
    el.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      el.style.touchAction = origTouchAction;
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      cancelAnimationFrame(rafIdRef.current);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  return { ref: elRef, offset, isSwiping, direction };
}
