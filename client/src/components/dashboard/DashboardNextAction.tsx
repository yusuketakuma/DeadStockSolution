import { Badge } from 'react-bootstrap';
import AppCard from '../ui/AppCard';
import { Link } from 'react-router-dom';
import { NextAction } from './types';
import { sanitizeInternalPath } from '../../utils/navigation';

interface Props {
  nextAction: NextAction;
}

export default function DashboardNextAction({ nextAction }: Props) {
  const primaryPath = sanitizeInternalPath(nextAction.primaryPath, '/');
  const secondaryPath = sanitizeInternalPath(nextAction.secondaryPath, '/');

  return (
    <AppCard className="mb-3">
      <AppCard.Body>
        <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap">
          <div>
            <div className="mb-2">
              <Badge bg={nextAction.badge}>次にやること</Badge>
            </div>
            <h5 className="mb-1">{nextAction.title}</h5>
            <div className="text-muted small">{nextAction.description}</div>
          </div>
          <div className="d-flex gap-2 mobile-stack">
            <Link to={primaryPath} className="btn btn-primary btn-sm">
              {nextAction.primaryLabel}
            </Link>
            <Link to={secondaryPath} className="btn btn-outline-secondary btn-sm">
              {nextAction.secondaryLabel}
            </Link>
          </div>
        </div>
      </AppCard.Body>
    </AppCard>
  );
}
