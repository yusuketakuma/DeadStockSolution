export type MatchingDismissReason = 'distance' | 'expiry' | 'value_gap' | 'item_fit' | 'other';

export interface MatchingDismissStats {
  distance: number;
  expiry: number;
  value_gap: number;
  item_fit: number;
  other: number;
}

const MATCHING_DISMISS_STATS_KEY = 'matching:dismiss-stats';

const EMPTY_STATS: MatchingDismissStats = {
  distance: 0,
  expiry: 0,
  value_gap: 0,
  item_fit: 0,
  other: 0,
};

export const MATCHING_DISMISS_REASON_LABELS: Record<MatchingDismissReason, string> = {
  distance: '距離が遠い',
  expiry: '期限が短い',
  value_gap: '差額が大きい',
  item_fit: '薬剤条件が合わない',
  other: 'その他',
};

export function loadMatchingDismissStats(): MatchingDismissStats {
  if (typeof window === 'undefined') return { ...EMPTY_STATS };
  try {
    const raw = window.localStorage.getItem(MATCHING_DISMISS_STATS_KEY);
    if (!raw) return { ...EMPTY_STATS };
    const parsed = JSON.parse(raw) as Partial<MatchingDismissStats>;
    return {
      distance: Number(parsed.distance ?? 0),
      expiry: Number(parsed.expiry ?? 0),
      value_gap: Number(parsed.value_gap ?? 0),
      item_fit: Number(parsed.item_fit ?? 0),
      other: Number(parsed.other ?? 0),
    };
  } catch {
    return { ...EMPTY_STATS };
  }
}

export function persistMatchingDismissStats(stats: MatchingDismissStats): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(MATCHING_DISMISS_STATS_KEY, JSON.stringify(stats));
}

export function incrementDismissReason(
  stats: MatchingDismissStats,
  reason: MatchingDismissReason,
): MatchingDismissStats {
  return {
    ...stats,
    [reason]: stats[reason] + 1,
  };
}
