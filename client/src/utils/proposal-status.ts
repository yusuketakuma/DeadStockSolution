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
