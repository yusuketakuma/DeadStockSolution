import { Modal } from 'react-bootstrap';

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
  return (
    <Modal show={show} onHide={onHide} centered={centered} size={size} backdrop={backdrop} keyboard={keyboard}>
      <Modal.Header closeButton={closeButton}>
        <Modal.Title>{title}</Modal.Title>
      </Modal.Header>
      <Modal.Body>{children}</Modal.Body>
      {footer ? <Modal.Footer>{footer}</Modal.Footer> : null}
    </Modal>
  );
}
