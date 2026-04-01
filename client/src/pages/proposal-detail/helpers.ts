import type { ProposalDetail } from './types';

export function resolveProposalStatusMeta(proposal: ProposalDetail['proposal'], currentUserId: number | undefined) {
  const isA = proposal.pharmacyAId === currentUserId;
  const isTentativePhase = ['proposed', 'accepted_a', 'accepted_b'].includes(proposal.status);
  const isConfirmedPhase = proposal.status === 'confirmed';
  const isCompletedPhase = proposal.status === 'completed';
  const isTerminalPhase = ['rejected', 'cancelled'].includes(proposal.status);
  const phaseIndex = isTerminalPhase ? -1
    : isTentativePhase ? 1
    : isConfirmedPhase ? 2
    : isCompletedPhase ? 3
    : 0;

  return {
    isA,
    isTentativePhase,
    isConfirmedPhase,
    isCompletedPhase,
    isTerminalPhase,
    phaseIndex,
    canAccept: (
      (proposal.status === 'proposed') ||
      (proposal.status === 'accepted_a' && !isA) ||
      (proposal.status === 'accepted_b' && isA)
    ),
    canReject: isTentativePhase,
    canComplete: isConfirmedPhase,
  };
}

/** アクションと現在ステータスから楽観的更新後のステータスを算出する。変換不能な場合は null を返す。 */
export function optimisticNextStatus(
  action: 'accept' | 'reject' | 'complete',
  currentStatus: string,
  isA: boolean,
): string | null {
  if (action === 'reject') return 'rejected';
  if (action === 'complete' && currentStatus === 'confirmed') return 'completed';
  if (action === 'accept') {
    if (currentStatus === 'proposed') return isA ? 'accepted_a' : 'accepted_b';
    if (currentStatus === 'accepted_a' && !isA) return 'confirmed';
    if (currentStatus === 'accepted_b' && isA) return 'confirmed';
  }
  return null;
}

export function buildProposalMessageDraft(proposalId: number, otherName: string): string {
  return `提案 #${proposalId} の内容確認ありがとうございます。${otherName}との交換条件についてメッセージで調整したいです。`;
}

export function resolveStatusLabel(status: string): string {
  return status === 'proposed' ? '仮マッチング中（双方未承認）'
    : status === 'accepted_a' ? '仮マッチング中（A側承認済）'
    : status === 'accepted_b' ? '仮マッチング中（B側承認済）'
    : status === 'confirmed' ? '確定'
    : status === 'completed' ? '完了'
    : status === 'rejected' ? '拒否'
    : status === 'cancelled' ? 'キャンセル'
    : status;
}

export const actionLabelMap: Record<'accept' | 'reject' | 'complete', string> = {
  accept: '承認',
  reject: '拒否',
  complete: '交換完了',
};
