import type { ReactNode } from 'react';
import { Card } from 'react-bootstrap';

interface AppDataPanelProps {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export default function AppDataPanel({
  title,
  actions,
  children,
  className,
  bodyClassName,
}: AppDataPanelProps) {
  return (
    <Card className={className}>
      {(title || actions) && (
        <Card.Header className="d-flex justify-content-between align-items-center gap-2">
          <div>{title}</div>
          {actions ? <div className="d-flex align-items-center gap-2">{actions}</div> : null}
        </Card.Header>
      )}
      <Card.Body className={bodyClassName}>{children}</Card.Body>
    </Card>
  );
}
