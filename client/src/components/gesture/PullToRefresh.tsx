import type { ReactNode } from 'react';
import { usePullToRefresh } from '../../hooks/usePullToRefresh';

interface PullToRefreshProps {
  onRefresh: () => Promise<void>;
  disabled?: boolean;
  children: ReactNode;
}

const THRESHOLD = 80;
const MAX_INDICATOR_HEIGHT = 48;

export default function PullToRefresh({ onRefresh, disabled = false, children }: PullToRefreshProps) {
  const { containerRef, pullDistance, state } = usePullToRefresh({
    onRefresh,
    threshold: THRESHOLD,
    disabled,
  });

  const indicatorHeight = state === 'pulling'
    ? Math.min(pullDistance, MAX_INDICATOR_HEIGHT)
    : undefined;

  const arrowRotation = Math.min((pullDistance / THRESHOLD) * 180, 180);

  return (
    <div ref={containerRef}>
      <div
        className={`ptr-indicator ${state}`}
        style={state === 'pulling' ? { height: indicatorHeight } : undefined}
      >
        {state === 'pulling' && (
          <span
            className="ptr-arrow"
            style={{ transform: `rotate(${arrowRotation}deg)`, display: 'inline-block' }}
            aria-hidden="true"
          >
            &#8595;
          </span>
        )}
        {state === 'refreshing' && (
          <span className="d-flex align-items-center gap-2">
            <span className="ptr-spinner" aria-hidden="true" />
            <span className="small text-muted">更新中...</span>
          </span>
        )}
        {state === 'complete' && (
          <span className="ptr-check" aria-hidden="true">&#10003;</span>
        )}
      </div>
      <div
        aria-live="polite"
        className="visually-hidden"
      >
        {state === 'complete' ? 'リスト更新完了' : ''}
      </div>
      {children}
    </div>
  );
}
