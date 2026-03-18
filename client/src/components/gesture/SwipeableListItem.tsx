import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useSwipeAction } from '../../hooks/useSwipeAction';

interface SwipeableListItemProps {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  leftContent?: ReactNode;   // Background shown on left swipe (appears on right side)
  rightContent?: ReactNode;  // Background shown on right swipe (appears on left side)
  threshold?: number;
  undoDuration?: number;      // ms, default 5000. 0 to disable undo
  children: ReactNode;
}

const DEFAULT_UNDO_DURATION = 5000;

// Check prefers-reduced-motion
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function SwipeableListItem({
  onSwipeLeft,
  onSwipeRight,
  leftContent,
  rightContent,
  threshold,
  undoDuration = DEFAULT_UNDO_DURATION,
  children,
}: SwipeableListItemProps) {
  const [pendingAction, setPendingAction] = useState<'left' | 'right' | null>(null);
  const [toastVisible, setToastVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSwipeLeftRef = useRef(onSwipeLeft);
  onSwipeLeftRef.current = onSwipeLeft;
  const onSwipeRightRef = useRef(onSwipeRight);
  onSwipeRightRef.current = onSwipeRight;

  const commitAction = useCallback((dir: 'left' | 'right') => {
    if (dir === 'left') {
      onSwipeLeftRef.current?.();
    } else {
      onSwipeRightRef.current?.();
    }
  }, []);

  const handleSwipeLeft = useCallback(() => {
    if (undoDuration > 0) {
      setPendingAction('left');
      setToastVisible(true);
    } else {
      onSwipeLeftRef.current?.();
    }
  }, [undoDuration]);

  const handleSwipeRight = useCallback(() => {
    if (undoDuration > 0) {
      setPendingAction('right');
      setToastVisible(true);
    } else {
      onSwipeRightRef.current?.();
    }
  }, [undoDuration]);

  const { ref, offset, isSwiping, direction } = useSwipeAction({
    onSwipeLeft: onSwipeLeft ? handleSwipeLeft : undefined,
    onSwipeRight: onSwipeRight ? handleSwipeRight : undefined,
    threshold,
    disabled: pendingAction !== null,
  });

  // Start undo timer when pending action is set
  useEffect(() => {
    if (pendingAction === null) return;

    timerRef.current = setTimeout(() => {
      commitAction(pendingAction);
      setPendingAction(null);
      setToastVisible(false);
      timerRef.current = null;
    }, undoDuration);

    return () => {
      // If unmounting (e.g. navigation) while pending, commit immediately
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        commitAction(pendingAction);
      }
    };
     
  }, [pendingAction, undoDuration, commitAction]);

  const handleUndo = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setPendingAction(null);
    setToastVisible(false);
  }, []);

  const reduced = prefersReducedMotion();
  const transitionStyle = isSwiping || reduced
    ? 'none'
    : 'transform var(--dl-duration-normal, 300ms) var(--dl-ease-standard, cubic-bezier(0.4, 0, 0.2, 1))';

  // Determine which background to show
  const showLeftBg = direction === 'left' && offset < 0;
  const showRightBg = direction === 'right' && offset > 0;

  // Peek affordance colors
  const leftPeekColor = leftContent ? '#dc2626' : undefined;
  const rightPeekColor = rightContent ? '#16a34a' : undefined;

  return (
    <div style={{ position: 'relative' }}>
      {/* Swipeable foreground + background container */}
      <div
        style={{ position: 'relative', overflow: 'hidden' }}
        data-swipe-active={isSwiping ? '' : undefined}
      >
        {/* Background layer */}
        {showLeftBg && leftContent && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              width: Math.abs(offset),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 600,
              fontSize: '0.875rem',
              minHeight: 48,
              overflow: 'hidden',
            }}
            aria-hidden="true"
          >
            {leftContent}
          </div>
        )}
        {showRightBg && rightContent && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              bottom: 0,
              width: Math.abs(offset),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 600,
              fontSize: '0.875rem',
              minHeight: 48,
              overflow: 'hidden',
            }}
            aria-hidden="true"
          >
            {rightContent}
          </div>
        )}

        {/* Foreground layer */}
        <div
          ref={ref}
          style={{
            transform: `translateX(${offset}px)`,
            transition: transitionStyle,
            position: 'relative',
            zIndex: 1,
            // Peek affordance: subtle color hints on edges
            boxShadow: !isSwiping
              ? [
                  leftPeekColor ? `inset -3px 0 0 0 ${leftPeekColor}33` : '',
                  rightPeekColor ? `inset 3px 0 0 0 ${rightPeekColor}33` : '',
                ]
                  .filter(Boolean)
                  .join(', ') || undefined
              : undefined,
          }}
        >
          {pendingAction !== null ? (
            <div style={{ opacity: 0.4, pointerEvents: 'none' }}>
              {children}
            </div>
          ) : (
            children
          )}
        </div>
      </div>

      {/* Undo Toast */}
      {toastVisible && (
        <div
          role="alert"
          aria-live="assertive"
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1060,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: '#333',
            color: '#fff',
            padding: '10px 20px',
            borderRadius: 8,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            fontSize: '0.875rem',
            maxWidth: 'calc(100vw - 32px)',
          }}
        >
          <span>
            {pendingAction === 'left' ? '左スワイプ操作' : '右スワイプ操作'}を実行中...
          </span>
          <button
            type="button"
            onClick={handleUndo}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.5)',
              color: '#fff',
              padding: '4px 12px',
              borderRadius: 4,
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.8125rem',
              whiteSpace: 'nowrap',
            }}
          >
            取り消し
          </button>
        </div>
      )}
    </div>
  );
}
