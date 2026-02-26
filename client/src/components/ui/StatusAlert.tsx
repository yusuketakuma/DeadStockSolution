import { Alert } from 'react-bootstrap';

interface StatusAlertProps {
  variant: 'danger' | 'success' | 'warning' | 'info';
  message: string;
}

export default function StatusAlert({ variant, message }: StatusAlertProps) {
  return (
    <Alert className="dl-status-alert" variant={variant} role="alert">
      {message}
    </Alert>
  );
}
