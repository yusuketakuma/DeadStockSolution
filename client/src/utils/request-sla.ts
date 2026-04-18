export interface RequestSlaInput {
  waitingOn: 'user' | 'admin' | 'openclaw' | null;
  isOverdue: boolean;
  latestUserMessageAt: string | null;
  latestStaffMessageAt: string | null;
  updatedAt: string | null;
  createdAt: string | null;
}

export interface RequestSlaSummary {
  nextActionLabel: string;
  referenceAt: string | null;
  dueAt: string | null;
  dueLabel: string;
  elapsedLabel: string;
  overdue: boolean;
  tone: 'secondary' | 'info' | 'warning' | 'danger';
}

const REQUEST_SLA_WINDOW_MS = 24 * 60 * 60 * 1000;

function parseTime(value: string | null): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    if (hours > 0) return `${days}日${hours}時間`;
    return `${days}日`;
  }

  if (hours > 0) {
    if (minutes > 0 && hours < 6) return `${hours}時間${minutes}分`;
    return `${hours}時間`;
  }

  return `${Math.max(1, minutes)}分`;
}

function resolveReferenceAt(input: RequestSlaInput): string | null {
  if (input.waitingOn === 'user') {
    return input.latestStaffMessageAt ?? input.updatedAt ?? input.createdAt;
  }
  if (input.waitingOn === 'admin') {
    return input.latestUserMessageAt ?? input.updatedAt ?? input.createdAt;
  }
  if (input.waitingOn === 'openclaw') {
    return input.updatedAt ?? input.latestUserMessageAt ?? input.latestStaffMessageAt ?? input.createdAt;
  }
  return input.updatedAt ?? input.createdAt ?? input.latestUserMessageAt ?? input.latestStaffMessageAt;
}

function resolveNextActionLabel(waitingOn: RequestSlaInput['waitingOn']): string {
  if (waitingOn === 'user') return '次にやること: 返信する';
  if (waitingOn === 'admin') return '次の更新: 管理者の返答待ち';
  if (waitingOn === 'openclaw') return '次の更新: OpenClaw 処理待ち';
  return '次の更新: 最新状況を確認';
}

export function getRequestSlaSummary(
  input: RequestSlaInput,
  nowMs = Date.now(),
): RequestSlaSummary {
  const referenceAt = resolveReferenceAt(input);
  const referenceMs = parseTime(referenceAt);
  const nextActionLabel = resolveNextActionLabel(input.waitingOn);

  if (referenceMs === null) {
    return {
      nextActionLabel,
      referenceAt: null,
      dueAt: null,
      dueLabel: '目安なし',
      elapsedLabel: '起点時刻なし',
      overdue: input.isOverdue,
      tone: input.isOverdue ? 'danger' : 'secondary',
    };
  }

  const dueMs = referenceMs + REQUEST_SLA_WINDOW_MS;
  const remainingMs = dueMs - nowMs;
  const overdue = input.isOverdue || remainingMs < 0;
  const dueLabel = overdue
    ? `${formatDuration(Math.abs(remainingMs))}超過`
    : `残り${formatDuration(remainingMs)}`;
  const elapsedLabel = `${formatDuration(Math.max(0, nowMs - referenceMs))}経過`;
  const tone = overdue
    ? 'danger'
    : remainingMs <= 2 * 60 * 60 * 1000
      ? 'warning'
      : input.waitingOn === 'openclaw'
        ? 'secondary'
        : 'info';

  return {
    nextActionLabel,
    referenceAt,
    dueAt: new Date(dueMs).toISOString(),
    dueLabel,
    elapsedLabel,
    overdue,
    tone,
  };
}
