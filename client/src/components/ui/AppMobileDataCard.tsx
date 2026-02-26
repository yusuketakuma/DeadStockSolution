import type { ReactNode } from 'react';
import AppCard from './AppCard';

interface AppMobileDataField {
  label: string;
  value: ReactNode;
}

interface AppMobileDataCardProps {
  title: ReactNode;
  subtitle?: ReactNode;
  badges?: ReactNode;
  fields: AppMobileDataField[];
  actions?: ReactNode;
  className?: string;
}

export default function AppMobileDataCard({
  title,
  subtitle,
  badges,
  fields,
  actions,
  className,
}: AppMobileDataCardProps) {
  return (
    <AppCard className={className ? `dl-mobile-data-card ${className}` : 'dl-mobile-data-card'}>
      <AppCard.Body>
        <div className="dl-mobile-data-head">
          <div className="dl-mobile-data-title-wrap">
            <h5 className="dl-mobile-data-title">{title}</h5>
            {subtitle ? <div className="dl-mobile-data-subtitle">{subtitle}</div> : null}
          </div>
          {badges ? <div className="dl-mobile-data-badges">{badges}</div> : null}
        </div>

        <dl className="dl-mobile-data-grid">
          {fields.map((field, index) => (
            <div key={`${field.label}-${index}`} className="dl-mobile-data-row">
              <dt>{field.label}</dt>
              <dd>{field.value ?? '-'}</dd>
            </div>
          ))}
        </dl>

        {actions ? <div className="dl-mobile-data-actions">{actions}</div> : null}
      </AppCard.Body>
    </AppCard>
  );
}
