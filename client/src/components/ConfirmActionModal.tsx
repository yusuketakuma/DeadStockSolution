import type { ReactNode } from 'react';
import { Button, Modal } from 'react-bootstrap';

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
  return (
    <Modal show={show} onHide={pending ? undefined : onCancel} centered>
      <Modal.Header closeButton={!pending}>
        <Modal.Title>{title}</Modal.Title>
      </Modal.Header>
      <Modal.Body>{body}</Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onCancel} disabled={pending}>
          {cancelLabel}
        </Button>
        <Button variant={confirmVariant} onClick={onConfirm} disabled={pending || confirmDisabled}>
          {pending ? '処理中...' : confirmLabel}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
