import type { ReactNode } from 'react';
import { Modal } from 'react-bootstrap';

interface AppModalShellProps {
  show: boolean;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onHide?: () => void;
  closeButton?: boolean;
  centered?: boolean;
  size?: 'sm' | 'lg' | 'xl';
}

export default function AppModalShell({
  show,
  title,
  children,
  footer,
  onHide,
  closeButton = true,
  centered = true,
  size,
}: AppModalShellProps) {
  return (
    <Modal show={show} onHide={onHide} centered={centered} size={size}>
      <Modal.Header closeButton={closeButton}>
        <Modal.Title>{title}</Modal.Title>
      </Modal.Header>
      <Modal.Body>{children}</Modal.Body>
      {footer ? <Modal.Footer>{footer}</Modal.Footer> : null}
    </Modal>
  );
}
