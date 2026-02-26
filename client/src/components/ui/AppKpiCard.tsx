import type { ReactNode } from 'react';
import AppDataPanel from './AppDataPanel';

interface AppKpiCardProps {
  value: ReactNode;
  label: ReactNode;
  subLabel?: ReactNode;
  action?: ReactNode;
  valueClassName?: string;
}

export default function AppKpiCard({
  value,
  label,
  subLabel,
  action,
  valueClassName = 'display-6',
}: AppKpiCardProps) {
  return (
    <AppDataPanel className="text-center h-100">
      <div className={valueClassName}>{value}</div>
      <div>{label}</div>
      {subLabel ? <div className="small text-muted">{subLabel}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </AppDataPanel>
  );
}
