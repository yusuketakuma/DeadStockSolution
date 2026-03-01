import type { ReactNode } from 'react';

interface AppActionBarProps {
  leading?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}

export default function AppActionBar({
  leading,
  trailing,
  className,
}: AppActionBarProps) {
  return (
    <div className={`d-flex justify-content-between align-items-start gap-2 flex-wrap ${className ?? ''}`}>
      <div className="d-flex align-items-center gap-2 flex-wrap">
        {leading}
      </div>
      <div className="d-flex align-items-center gap-2 flex-wrap">
        {trailing}
      </div>
    </div>
  );
}
