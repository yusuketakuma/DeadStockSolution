import { Modal } from 'react-bootstrap';
import { useId } from 'react';

interface AppModalShellProps {
  show: boolean;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onHide?: () => void;
  closeButton?: boolean;
  centered?: boolean;
  size?: 'sm' | 'lg' | 'xl';
  backdrop?: boolean | 'static';
  keyboard?: boolean;
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
  backdrop,
  keyboard,
}: AppModalShellProps) {
  const titleId = useId();

  return (
    <Modal
      show={show}
      onHide={onHide}
      centered={centered}
      size={size}
      backdrop={backdrop}
      keyboard={keyboard}
      aria-labelledby={titleId}
    >
      <Modal.Header closeButton={closeButton}>
        <Modal.Title id={titleId}>{title}</Modal.Title>
      </Modal.Header>
      <Modal.Body>{children}</Modal.Body>
      {footer ? <Modal.Footer>{footer}</Modal.Footer> : null}
    </Modal>
  );
}
