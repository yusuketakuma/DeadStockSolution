import type { ReactNode } from 'react';
import { Badge } from 'react-bootstrap';
import AppButton from '../ui/AppButton';
import BaseBottomSheet from './BaseBottomSheet';

interface MobileFilterSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  activeFilterCount?: number;
  onReset?: () => void;
  onApply?: () => void;
  applyLabel?: string;
  children: ReactNode;
}

export default function MobileFilterSheet({
  isOpen,
  onClose,
  title = 'フィルタ',
  activeFilterCount = 0,
  onReset,
  onApply,
  applyLabel = '適用',
  children,
}: MobileFilterSheetProps) {
  const headerTitle = (
    <>
      {title}
      {activeFilterCount > 0 && (
        <Badge bg="primary" pill className="ms-1">
          {activeFilterCount}
        </Badge>
      )}
    </>
  );

  const footer = (
    <>
      <AppButton
        variant="outline-secondary"
        size="sm"
        onClick={() => {
          onReset?.();
        }}
      >
        リセット
      </AppButton>
      <AppButton
        variant="primary"
        size="sm"
        onClick={() => {
          onApply?.();
          onClose();
        }}
      >
        {applyLabel}
      </AppButton>
    </>
  );

  return (
    <BaseBottomSheet
      isOpen={isOpen}
      onClose={onClose}
      title={headerTitle}
      ariaLabel={title}
      footer={footer}
    >
      {children}
    </BaseBottomSheet>
  );
}
