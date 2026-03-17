import { Alert } from 'react-bootstrap';
import type { AlertProps } from 'react-bootstrap';

const VARIANT_ICONS: Record<string, string> = {
  success: '✓',
  warning: '⚠',
  danger: '✕',
  info: 'ℹ',
};

interface AppAlertProps extends AlertProps {
  showIcon?: boolean;
}

export default function AppAlert({
  variant = 'secondary',
  role,
  showIcon = true,
  children,
  ...props
}: AppAlertProps) {
  const isUrgent = variant === 'danger' || variant === 'warning';
  const resolvedRole = role ?? (isUrgent ? 'alert' : 'status');
  const ariaLive = isUrgent ? 'assertive' : 'polite';
  const icon = showIcon && variant ? VARIANT_ICONS[variant] : null;

  return (
    <Alert variant={variant} role={resolvedRole} aria-live={ariaLive} {...props}>
      {icon ? (
        <>
          <span aria-hidden="true">{icon} </span>
          {children}
        </>
      ) : children}
    </Alert>
  );
}
