import { Toast, ToastContainer } from 'react-bootstrap';
import { useToastData } from '../../contexts/ToastContext';

export default function AppToastContainer() {
  const { toasts, removeToast } = useToastData();

  if (toasts.length === 0) return null;

  return (
    <ToastContainer position="top-end" className="p-3" style={{ zIndex: 1080 }}>
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          bg={toast.variant}
          autohide={toast.autoDismissMs !== null}
          delay={toast.autoDismissMs ?? undefined}
          onClose={() => removeToast(toast.id)}
          aria-live={toast.variant === 'danger' || toast.variant === 'warning' ? 'assertive' : 'polite'}
        >
          <Toast.Header>
            <strong className="me-auto">
              {toast.variant === 'success' && '完了'}
              {toast.variant === 'danger' && 'エラー'}
              {toast.variant === 'warning' && '警告'}
              {toast.variant === 'info' && '通知'}
            </strong>
          </Toast.Header>
          <Toast.Body className={toast.variant === 'danger' || toast.variant === 'success' ? 'text-white' : ''}>
            {toast.message}
          </Toast.Body>
        </Toast>
      ))}
    </ToastContainer>
  );
}
