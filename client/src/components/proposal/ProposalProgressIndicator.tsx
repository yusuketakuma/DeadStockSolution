import { memo } from 'react';
import { Badge } from 'react-bootstrap';
import AppDataPanel from '../ui/AppDataPanel';

interface ProposalProgressIndicatorProps {
  isTerminalPhase: boolean;
  isConfirmedPhase: boolean;
  isCompletedPhase: boolean;
  phaseIndex: number;
  statusLabel: string;
}

export const ProposalProgressIndicator = memo(function ProposalProgressIndicator({
  isTerminalPhase,
  isConfirmedPhase,
  isCompletedPhase,
  phaseIndex,
  statusLabel,
}: ProposalProgressIndicatorProps) {
  return (
    <AppDataPanel className="mb-3" bodyClassName="py-2">
      <div className="d-flex align-items-center justify-content-between small">
        {[
          { label: '仮マッチング', phase: 1 },
          { label: '確定', phase: 2 },
          { label: '完了', phase: 3 },
        ].map((step, i) => (
          <div key={step.phase} className="d-flex align-items-center flex-grow-1">
            <div
              className={`rounded-circle d-flex align-items-center justify-content-center ${
                isTerminalPhase ? 'bg-secondary'
                : phaseIndex >= step.phase ? 'bg-success' : 'bg-light border'
              }`}
              style={{ width: 28, height: 28, minWidth: 28, color: isTerminalPhase || phaseIndex >= step.phase ? '#fff' : '#999' }}
            >
              {isTerminalPhase ? '—' : phaseIndex >= step.phase ? '✓' : step.phase}
            </div>
            <span className={`ms-1 ${phaseIndex >= step.phase && !isTerminalPhase ? 'fw-bold' : 'text-muted'}`}>
              {step.label}
            </span>
            {i < 2 && <div className={`flex-grow-1 mx-2 ${phaseIndex > step.phase && !isTerminalPhase ? 'border-success' : ''}`} style={{ borderBottom: '2px solid #dee2e6', borderColor: phaseIndex > step.phase && !isTerminalPhase ? '#198754' : undefined }} />}
          </div>
        ))}
      </div>
      <div className="text-center mt-1 small text-muted">
        現在のステータス: <Badge bg={isTerminalPhase ? 'danger' : isCompletedPhase ? 'secondary' : isConfirmedPhase ? 'success' : 'warning'}>{statusLabel}</Badge>
      </div>
    </AppDataPanel>
  );
});
