import { Badge } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import AppCard from './AppCard';

interface WorkContextBadge {
  label: string;
  bg?: string;
  text?: string;
}

interface WorkContextAction {
  to: string;
  label: string;
  variant?: string;
}

interface WorkContextBarProps {
  title: string;
  description?: string;
  currentLabel?: string;
  backTo?: string | null;
  backLabel?: string;
  badges?: Array<WorkContextBadge | null | false | undefined>;
  nextActions?: WorkContextAction[];
}

export default function WorkContextBar({
  title,
  description,
  currentLabel,
  backTo,
  backLabel = '一覧へ戻る',
  badges = [],
  nextActions = [],
}: WorkContextBarProps) {
  const visibleBadges = badges.filter((badge): badge is WorkContextBadge => Boolean(badge));

  return (
    <AppCard className="mb-3">
      <AppCard.Body className="d-flex flex-column gap-3">
        <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap">
          <div className="d-flex flex-column gap-1">
            <div className="small text-muted">作業コンテキスト</div>
            <div className="fw-semibold">{title}</div>
            {currentLabel ? <div className="small text-muted">{currentLabel}</div> : null}
            {description ? <div className="small text-muted">{description}</div> : null}
          </div>
          <div className="d-flex gap-2 flex-wrap">
            {backTo ? (
              <Link to={backTo} className="btn btn-outline-secondary btn-sm">
                {backLabel}
              </Link>
            ) : null}
          </div>
        </div>
        {(visibleBadges.length > 0 || nextActions.length > 0) && (
          <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap">
            {visibleBadges.length > 0 ? (
              <div className="d-flex gap-2 flex-wrap">
                {visibleBadges.map((badge) => (
                  <Badge key={`${badge.label}-${badge.bg ?? 'secondary'}`} bg={badge.bg ?? 'secondary'} text={badge.text}>
                    {badge.label}
                  </Badge>
                ))}
              </div>
            ) : <div />}
            {nextActions.length > 0 ? (
              <div className="d-flex gap-2 flex-wrap">
                {nextActions.map((action) => (
                  <Link key={`${action.to}-${action.label}`} to={action.to} className={`btn btn-sm btn-${action.variant ?? 'outline-primary'}`}>
                    {action.label}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </AppCard.Body>
    </AppCard>
  );
}
