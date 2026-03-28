const PENDING_PROPOSAL_STATUSES = new Set(['proposed', 'accepted_a', 'accepted_b']);
const DEFAULT_PROPOSAL_EXPIRY_HOURS = 72;

function parseIso(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function resolveProposalDeadline(params: {
  proposedAt: string | null | undefined;
  expiresAt?: string | null | undefined;
  status: string | null | undefined;
}): string | null {
  const explicitExpiry = parseIso(params.expiresAt);
  if (explicitExpiry) {
    return explicitExpiry.toISOString();
  }

  if (!params.status || !PENDING_PROPOSAL_STATUSES.has(params.status)) {
    return null;
  }

  const proposedAt = parseIso(params.proposedAt);
  if (!proposedAt) {
    return null;
  }

  return new Date(
    proposedAt.getTime() + DEFAULT_PROPOSAL_EXPIRY_HOURS * 60 * 60 * 1000,
  ).toISOString();
}

export function getProposalDeadlineMeta(deadlineAt: string | null | undefined): {
  isExpired: boolean;
  isDueSoon: boolean;
  remainingLabel: string;
} {
  const deadline = parseIso(deadlineAt);
  if (!deadline) {
    return {
      isExpired: false,
      isDueSoon: false,
      remainingLabel: '期限設定なし',
    };
  }

  const diffMs = deadline.getTime() - Date.now();
  if (diffMs <= 0) {
    return {
      isExpired: true,
      isDueSoon: false,
      remainingLabel: '期限切れ',
    };
  }

  const diffMinutes = Math.ceil(diffMs / 60000);
  const diffHours = Math.ceil(diffMs / 3600000);
  const diffDays = Math.ceil(diffMs / 86400000);

  if (diffMinutes < 60) {
    return {
      isExpired: false,
      isDueSoon: true,
      remainingLabel: `残り${diffMinutes}分`,
    };
  }

  if (diffHours < 24) {
    return {
      isExpired: false,
      isDueSoon: true,
      remainingLabel: `残り${diffHours}時間`,
    };
  }

  return {
    isExpired: false,
    isDueSoon: diffDays <= 2,
    remainingLabel: `残り${diffDays}日`,
  };
}
