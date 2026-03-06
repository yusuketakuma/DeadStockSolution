import AppAlert from './AppAlert';
import AppButton from './AppButton';

interface ErrorRetryAlertProps {
  error: string;
  onRetry?: () => void;
}

export default function ErrorRetryAlert({ error, onRetry }: ErrorRetryAlertProps) {
  return (
    <AppAlert variant="danger" className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
      <span>{error}</span>
      {onRetry && (
        <AppButton size="sm" variant="outline-danger" onClick={onRetry}>
          再試行
        </AppButton>
      )}
    </AppAlert>
  );
}
