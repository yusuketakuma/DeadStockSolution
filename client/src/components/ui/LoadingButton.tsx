import { Button } from 'react-bootstrap';
import type { ButtonProps } from 'react-bootstrap';
import InlineLoader from './InlineLoader';

interface LoadingButtonProps extends Omit<ButtonProps, 'children'> {
  loading: boolean;
  loadingLabel: string;
  children: React.ReactNode;
}

export default function LoadingButton({
  loading,
  loadingLabel,
  children,
  disabled,
  ...buttonProps
}: LoadingButtonProps) {
  return (
    <Button {...buttonProps} disabled={disabled || loading}>
      {loading ? <InlineLoader text={loadingLabel} className="dl-inline-loader-btn" /> : children}
    </Button>
  );
}
