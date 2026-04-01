import { memo } from 'react';
import { ProgressBar } from 'react-bootstrap';

interface ProposalMiniProgressProps {
  phaseIndex: number;
  isTerminalPhase: boolean;
  actionRequired: boolean;
}

const PHASE_PERCENT: Record<number, number> = {
  1: 33,
  2: 66,
  3: 100,
};

const CONTAINER_STYLE = { width: 90 } as const;
const BAR_STYLE = { height: 6, width: '100%', minWidth: 60 } as const;

export const ProposalMiniProgress = memo(function ProposalMiniProgress({
  phaseIndex,
  isTerminalPhase,
  actionRequired,
}: ProposalMiniProgressProps) {
  const percent = PHASE_PERCENT[phaseIndex] ?? 0;
  const variant = isTerminalPhase ? 'secondary' : phaseIndex >= 3 ? 'success' : 'info';

  return (
    <div className="d-inline-flex align-items-center gap-1" style={CONTAINER_STYLE}>
      <ProgressBar
        now={percent}
        variant={variant}
        style={BAR_STYLE}
        aria-label={`進捗: ${percent}%`}
      />
      {actionRequired && (
        <span
          className="rounded-circle bg-warning d-inline-block flex-shrink-0"
          style={{ width: 8, height: 8 }}
          title="あなたのアクションが必要です"
          aria-label="アクション必要"
        />
      )}
    </div>
  );
});
