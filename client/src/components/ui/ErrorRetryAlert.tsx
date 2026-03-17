import AppAlert from './AppAlert';
import AppButton from './AppButton';
import { NetworkError, TimeoutError, ServerError } from '../../api/client';

interface ErrorRetryAlertProps {
  error: string | Error;
  onRetry?: () => void;
}

function resolveErrorDisplay(error: string | Error): { icon: string; message: string } {
  if (error instanceof TimeoutError) {
    return { icon: '⏱', message: error.message };
  }
  if (error instanceof NetworkError) {
    return { icon: '📡', message: error.message };
  }
  if (error instanceof ServerError) {
    return { icon: '🖥', message: error.message };
  }
  if (error instanceof Error) {
    return { icon: '⚠', message: error.message };
  }
  return { icon: '⚠', message: error };
}

export default function ErrorRetryAlert({ error, onRetry }: ErrorRetryAlertProps) {
  const { icon, message } = resolveErrorDisplay(error);
  return (
    <AppAlert variant="danger" className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
      <span>
        <span aria-hidden="true">{icon} </span>
        {message}
      </span>
      {onRetry && (
        <AppButton size="sm" variant="outline-danger" onClick={onRetry}>
          再試行
        </AppButton>
      )}
    </AppAlert>
  );
}
