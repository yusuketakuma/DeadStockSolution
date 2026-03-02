import { Badge } from 'react-bootstrap';

const LEVEL_BADGE_MAP: Record<string, string> = {
  critical: 'danger',
  error: 'danger',
  warning: 'warning',
  info: 'info',
};

export default function LevelBadge({ level }: { level: string }) {
  const bg = LEVEL_BADGE_MAP[level] ?? 'secondary';
  const textProp = level === 'warning' ? 'dark' : undefined;
  return <Badge bg={bg} text={textProp}>{level}</Badge>;
}
