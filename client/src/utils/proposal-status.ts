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
