import type { ReactNode } from 'react';
import AppButton from './ui/AppButton';
import AppModalShell from './ui/AppModalShell';
import LoadingButton from './ui/LoadingButton';

interface ConfirmActionModalProps {
  show: boolean;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  confirmVariant?: 'primary' | 'danger' | 'warning' | 'success' | 'secondary' | 'outline-secondary' | 'outline-danger';
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  pending?: boolean;
  confirmDisabled?: boolean;
}

export default function ConfirmActionModal({
  show,
  title,
  body,
  confirmLabel,
  confirmVariant = 'primary',
  cancelLabel = 'キャンセル',
  onConfirm,
  onCancel,
  pending = false,
  confirmDisabled = false,
}: ConfirmActionModalProps) {
  const footer = (
    <>
      <AppButton variant="outline-secondary" onClick={onCancel} disabled={pending}>
        {cancelLabel}
      </AppButton>
      <LoadingButton
        variant={confirmVariant}
        onClick={onConfirm}
        loading={pending}
        loadingLabel="処理中..."
        disabled={confirmDisabled}
      >
        {confirmLabel}
      </LoadingButton>
    </>
  );

  return (
    <AppModalShell
      show={show}
      title={title}
      onHide={pending ? undefined : onCancel}
      closeButton={!pending}
      footer={footer}
    >
      {body}
    </AppModalShell>
  );
}
