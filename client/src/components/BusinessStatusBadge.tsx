import { Badge } from 'react-bootstrap';

interface BusinessHoursStatus {
  isOpen: boolean;
  closingSoon: boolean;
  is24Hours: boolean;
  todayHours: { openTime: string; closeTime: string } | null;
  isConfigured?: boolean;
}

interface Props {
  status?: BusinessHoursStatus;
  showHours?: boolean;
  fallback?: 'dash' | 'none';
}

export default function BusinessStatusBadge({ status, showHours = false, fallback = 'none' }: Props) {
  if (!status) {
    return fallback === 'dash' ? <span className="text-muted small">-</span> : null;
  }

  if (status.isConfigured === false) {
    return <Badge bg="secondary">未設定</Badge>;
  }

  if (status.isOpen && status.closingSoon) {
    return <Badge bg="warning" text="dark">まもなく営業終了</Badge>;
  }
  if (!status.isOpen) {
    return <Badge bg="secondary">営業時間外</Badge>;
  }
  if (status.is24Hours) {
    return <Badge bg="success">24時間営業</Badge>;
  }
  if (status.todayHours) {
    if (showHours) {
      return <Badge bg="success">営業中 {status.todayHours.openTime}〜{status.todayHours.closeTime}</Badge>;
    }
    return <Badge bg="success">営業中</Badge>;
  }
  return fallback === 'dash' ? <span className="text-muted small">-</span> : null;
}

export type { BusinessHoursStatus };
