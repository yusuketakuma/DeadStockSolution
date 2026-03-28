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

export type ProposalPhase = 'negotiating' | 'confirmed' | 'completed' | 'closed';

export interface ProposalPhaseInfo {
  phase: ProposalPhase;
  phaseLabel: string;
  variant: string;
  yourStatus: string;
  theirStatus: string;
}

export interface ProposalWaitingInfo {
  waitingForPharmacy: 'a' | 'b';
  waitingForYou: boolean;
  label: string;
  viewerLabel: string;
}

/**
 * 閲覧者が A 側か B 側かに応じて「あなたの状態」「相手の状態」を返す。
 * @param status  提案のステータス値
 * @param isA     閲覧者が pharmacyIdA 側かどうか
 */
export function getProposalPhaseInfo(status: string, isA: boolean): ProposalPhaseInfo {
  switch (status) {
    case 'proposed':
      return {
        phase: 'negotiating',
        phaseLabel: '交渉中',
        variant: 'warning',
        yourStatus: '承認待ち',
        theirStatus: '承認待ち',
      };
    case 'accepted_a':
      return {
        phase: 'negotiating',
        phaseLabel: '交渉中',
        variant: 'warning',
        yourStatus: isA ? '承認済み' : '承認待ち',
        theirStatus: isA ? '承認待ち' : '承認済み',
      };
    case 'accepted_b':
      return {
        phase: 'negotiating',
        phaseLabel: '交渉中',
        variant: 'warning',
        yourStatus: isA ? '承認待ち' : '承認済み',
        theirStatus: isA ? '承認済み' : '承認待ち',
      };
    case 'confirmed':
      return {
        phase: 'confirmed',
        phaseLabel: '確定',
        variant: 'info',
        yourStatus: '確定済み',
        theirStatus: '確定済み',
      };
    case 'completed':
      return {
        phase: 'completed',
        phaseLabel: '完了',
        variant: 'success',
        yourStatus: '完了',
        theirStatus: '完了',
      };
    case 'rejected':
      return {
        phase: 'closed',
        phaseLabel: '終了',
        variant: 'secondary',
        yourStatus: '辞退',
        theirStatus: '辞退',
      };
    case 'cancelled':
      return {
        phase: 'closed',
        phaseLabel: '終了',
        variant: 'secondary',
        yourStatus: 'キャンセル',
        theirStatus: 'キャンセル',
      };
    default:
      return {
        phase: 'negotiating',
        phaseLabel: status,
        variant: 'secondary',
        yourStatus: '-',
        theirStatus: '-',
      };
  }
}

export function getProposalWaitingInfo(
  status: string,
  isA: boolean,
  pharmacyAName = 'A側薬局',
  pharmacyBName = 'B側薬局',
): ProposalWaitingInfo | null {
  if (status === 'proposed') {
    const waitingForPharmacy: ProposalWaitingInfo['waitingForPharmacy'] = 'b';
    const waitingForYou = !isA;
    return {
      waitingForPharmacy,
      waitingForYou,
      label: `${pharmacyBName}の確認待ち`,
      viewerLabel: waitingForYou ? 'あなたの確認待ち' : '相手薬局の確認待ち',
    };
  }

  if (status === 'accepted_a') {
    const waitingForPharmacy: ProposalWaitingInfo['waitingForPharmacy'] = 'b';
    const waitingForYou = !isA;
    return {
      waitingForPharmacy,
      waitingForYou,
      label: `${pharmacyBName}の承認待ち`,
      viewerLabel: waitingForYou ? 'あなたの承認待ち' : '相手薬局の承認待ち',
    };
  }

  if (status === 'accepted_b') {
    const waitingForPharmacy: ProposalWaitingInfo['waitingForPharmacy'] = 'a';
    const waitingForYou = isA;
    return {
      waitingForPharmacy,
      waitingForYou,
      label: `${pharmacyAName}の承認待ち`,
      viewerLabel: waitingForYou ? 'あなたの承認待ち' : '相手薬局の承認待ち',
    };
  }

  return null;
}
