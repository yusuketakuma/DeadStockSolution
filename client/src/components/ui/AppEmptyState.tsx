import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import AppCard from './AppCard';
import AppButton from './AppButton';

interface AppEmptyStateProps {
  title: string;
  description?: string;
  actionLabel?: string;
  actionTo?: string;
  action?: ReactNode;
  className?: string;
}

export default function AppEmptyState({
  title,
  description,
  actionLabel,
  actionTo,
  action,
  className,
}: AppEmptyStateProps) {
  return (
    <AppCard className={className}>
      <AppCard.Body className="text-center py-4">
        <h5 className="mb-2">{title}</h5>
        {description ? <p className="text-muted small mb-0">{description}</p> : null}
        {action}
        {actionLabel && actionTo ? (
          <div className="mt-3">
            <Link to={actionTo}>
              <AppButton size="sm" variant="outline-primary">{actionLabel}</AppButton>
            </Link>
          </div>
        ) : null}
      </AppCard.Body>
    </AppCard>
  );
}
