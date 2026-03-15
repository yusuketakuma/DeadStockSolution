import { memo } from 'react';
import AppButton from '../ui/AppButton';

interface ProposalActionsProps {
  canAccept: boolean;
  canReject: boolean;
  canComplete: boolean;
  onAccept: () => void;
  onReject: () => void;
  onComplete: () => void;
}

export const ProposalActionButtons = memo(function ProposalActionButtons({
  canAccept,
  canReject,
  canComplete,
  onAccept,
  onReject,
  onComplete,
}: ProposalActionsProps) {
  return (
    <div className="d-flex gap-2 mobile-stack">
      {canAccept && <AppButton variant="success" onClick={onAccept}>仮マッチングを承認</AppButton>}
      {canReject && <AppButton variant="danger" onClick={onReject}>拒否する</AppButton>}
      {canComplete && <AppButton variant="primary" onClick={onComplete}>交換完了</AppButton>}
    </div>
  );
});

interface ProposalMobileStickyActionsProps {
  hasStickyActions: boolean;
  canAccept: boolean;
  canReject: boolean;
  canComplete: boolean;
  onAccept: () => void;
  onReject: () => void;
  onComplete: () => void;
}

export const ProposalMobileStickyActions = memo(function ProposalMobileStickyActions({
  hasStickyActions,
  canAccept,
  canReject,
  canComplete,
  onAccept,
  onReject,
  onComplete,
}: ProposalMobileStickyActionsProps) {
  if (!hasStickyActions) return null;

  return (
    <div
      data-testid="proposal-mobile-sticky-actions"
      className="position-sticky bottom-0 bg-body p-2 border-top d-flex gap-2"
      style={{ zIndex: 1000, paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom, 0px))' }}
    >
      {canAccept && <AppButton variant="success" className="flex-grow-1" onClick={onAccept}>承認</AppButton>}
      {canReject && <AppButton variant="danger" className="flex-grow-1" onClick={onReject}>拒否</AppButton>}
      {canComplete && <AppButton variant="primary" className="flex-grow-1" onClick={onComplete}>交換完了</AppButton>}
    </div>
  );
});
