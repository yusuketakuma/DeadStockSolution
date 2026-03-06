const PROPOSAL_STATUS_LABEL_MAP: Record<string, string> = {
  proposed: '仮マッチング中',
  accepted_a: 'A側承認済み',
  accepted_b: 'B側承認済み',
  confirmed: '確定',
  rejected: '拒否',
  completed: '交換完了',
  cancelled: 'キャンセル',
};

export function proposalStatusLabel(status: string): string {
  return PROPOSAL_STATUS_LABEL_MAP[status] ?? status;
}

export function toViewerProposalStatusLabel(status: string, isViewerA: boolean): string {
  if (status === 'accepted_a') return isViewerA ? 'あなた承認済み' : '相手承認済み';
  if (status === 'accepted_b') return isViewerA ? '相手承認済み' : 'あなた承認済み';
  return proposalStatusLabel(status);
}

export const PROPOSAL_STATUS_STYLES: Record<string, { label: string; variant: string }> = {
  proposed: { label: '仮マッチング中', variant: 'warning' },
  accepted_a: { label: '仮マッチング中（A承認済）', variant: 'info' },
  accepted_b: { label: '仮マッチング中（B承認済）', variant: 'info' },
  confirmed: { label: '確定', variant: 'success' },
  completed: { label: '完了', variant: 'secondary' },
  rejected: { label: '拒否', variant: 'danger' },
  cancelled: { label: 'キャンセル', variant: 'dark' },
};

export function proposalStatusStyle(status: string): { label: string; variant: string } {
  return PROPOSAL_STATUS_STYLES[status] ?? { label: status, variant: 'secondary' };
}
