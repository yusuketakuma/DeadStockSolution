import type { ReactNode } from 'react';
import AppAlert from './AppAlert';
import AppButton from './AppButton';
import AppEmptyState from './AppEmptyState';
import AppResponsiveSwitch from './AppResponsiveSwitch';
import InlineLoader from './InlineLoader';

interface AppDataTableProps {
  loading: boolean;
  error?: string;
  onRetry?: () => void;
  loadingText: string;
  isEmpty: boolean;
  emptyTitle: string;
  emptyDescription: string;
  emptyActionLabel?: string;
  emptyActionTo?: string;
  desktop: () => ReactNode;
  mobile: () => ReactNode;
}

export default function AppDataTable({
  loading,
  error,
  onRetry,
  loadingText,
  isEmpty,
  emptyTitle,
  emptyDescription,
  emptyActionLabel,
  emptyActionTo,
  desktop,
  mobile,
}: AppDataTableProps) {
  if (error) {
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

  if (loading) {
    return <InlineLoader text={loadingText} className="text-muted small" />;
  }

  if (isEmpty) {
    return (
      <AppEmptyState
        title={emptyTitle}
        description={emptyDescription}
        actionLabel={emptyActionLabel}
        actionTo={emptyActionTo}
      />
    );
  }

  return <AppResponsiveSwitch desktop={desktop} mobile={mobile} />;
}
