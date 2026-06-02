import { Badge } from 'react-bootstrap';
import AppCard from '../ui/AppCard';
import { Link } from 'react-router-dom';
import { NextAction } from './types';
import { sanitizeInternalPath } from '../../utils/navigation';
import AppDropdownMenu from '../ui/AppDropdownMenu';

interface Props {
  nextAction: NextAction;
}

export default function DashboardNextAction({ nextAction }: Props) {
  const primaryPath = sanitizeInternalPath(nextAction.primaryPath, '/');
  const secondaryPath = sanitizeInternalPath(nextAction.secondaryPath, '/');

  return (
    <AppCard className="mb-3">
      <AppCard.Body>
        <div className="dl-action-row mobile-stack justify-content-between align-items-start">
          <div>
            <div className="mb-2">
              <Badge bg={nextAction.badge}>次にやること</Badge>
            </div>
            <h5 className="mb-1">{nextAction.title}</h5>
            <div className="text-muted small">{nextAction.description}</div>
          </div>
          <div className="dl-action-row mobile-stack">
            <Link to={primaryPath} className="btn btn-primary btn-sm">
              {nextAction.primaryLabel}
            </Link>
            <AppDropdownMenu
              label="関連"
              size="sm"
              variant="outline-secondary"
              items={[
                { key: 'secondary', to: secondaryPath, label: nextAction.secondaryLabel },
              ]}
            />
          </div>
        </div>
      </AppCard.Body>
    </AppCard>
  );
}
