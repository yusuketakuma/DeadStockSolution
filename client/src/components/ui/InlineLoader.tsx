import { Spinner } from 'react-bootstrap';

interface InlineLoaderProps {
  text?: string;
  size?: 'sm';
  className?: string;
}

export default function InlineLoader({
  text = '読み込み中...',
  size = 'sm',
  className = '',
}: InlineLoaderProps) {
  const classes = ['dl-inline-loader', className].filter(Boolean).join(' ');

  return (
    <span className={classes} role="status" aria-live="polite">
      <Spinner size={size} animation="border" aria-hidden="true" />
      <span>{text}</span>
    </span>
  );
}
