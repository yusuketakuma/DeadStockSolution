import { memo } from 'react';
import AppButton from '../ui/AppButton';
import AppDropdownMenu from '../ui/AppDropdownMenu';

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
  const actions = [
    canAccept ? { key: 'accept', label: '仮マッチングを承認', onClick: onAccept, variant: 'success' as const } : null,
    canComplete ? { key: 'complete', label: '交換完了', onClick: onComplete, variant: 'primary' as const } : null,
    canReject ? { key: 'reject', label: '拒否する', onClick: onReject, variant: 'danger' as const } : null,
  ].filter((item): item is { key: string; label: string; onClick: () => void; variant: 'success' | 'primary' | 'danger' } => item !== null);

  const [primaryAction, ...secondaryActions] = actions;

  return (
    <div className="d-flex gap-2 mobile-stack">
      {primaryAction && (
        <AppButton variant={primaryAction.variant} onClick={primaryAction.onClick}>
          {primaryAction.label}
        </AppButton>
      )}
      {secondaryActions.length > 0 && (
        <AppDropdownMenu
          label="その他"
          variant="outline-secondary"
          items={secondaryActions.map((action) => ({
            key: action.key,
            label: action.label,
            onClick: action.onClick,
            danger: action.key === 'reject',
          }))}
        />
      )}
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

  const actions = [
    canAccept ? { key: 'accept', label: '承認', onClick: onAccept, variant: 'success' as const } : null,
    canComplete ? { key: 'complete', label: '交換完了', onClick: onComplete, variant: 'primary' as const } : null,
    canReject ? { key: 'reject', label: '拒否', onClick: onReject, variant: 'danger' as const } : null,
  ].filter((item): item is { key: string; label: string; onClick: () => void; variant: 'success' | 'primary' | 'danger' } => item !== null);

  const [primaryAction, ...secondaryActions] = actions;

  return (
    <div
      data-testid="proposal-mobile-sticky-actions"
      className="position-sticky bottom-0 bg-body p-2 border-top d-flex gap-2"
      style={{ zIndex: 1000, paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom, 0px))' }}
    >
      {primaryAction && (
        <AppButton variant={primaryAction.variant} className="flex-grow-1" onClick={primaryAction.onClick}>
          {primaryAction.label}
        </AppButton>
      )}
      {secondaryActions.length > 0 && (
        <AppDropdownMenu
          label="その他"
          variant="outline-secondary"
          items={secondaryActions.map((action) => ({
            key: action.key,
            label: action.label,
            onClick: action.onClick,
            danger: action.key === 'reject',
          }))}
        />
      )}
    </div>
  );
});
