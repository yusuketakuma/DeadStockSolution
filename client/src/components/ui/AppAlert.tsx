import { Alert } from 'react-bootstrap';
import type { AlertProps } from 'react-bootstrap';

export default function AppAlert({
  variant = 'secondary',
  role,
  ...props
}: AlertProps) {
  const isUrgent = variant === 'danger' || variant === 'warning';
  const resolvedRole = role ?? (isUrgent ? 'alert' : 'status');
  const ariaLive = isUrgent ? 'assertive' : 'polite';
  return <Alert variant={variant} role={resolvedRole} aria-live={ariaLive} {...props} />;
}
