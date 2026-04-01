import { Link } from 'react-router-dom';
import AppDataPanel from '../../components/ui/AppDataPanel';
import { buildMessagesPath } from '../../utils/message-links';
import { buildProposalMessageDraft } from './helpers';
import type { PharmacyInfo } from './types';

interface ProposalContactPanelProps {
  proposalId: number;
  otherPharmacy: PharmacyInfo;
  /** モバイル用の場合は内部レイアウトを少し変える */
  mobile?: boolean;
}

export function ProposalContactPanel({ proposalId, otherPharmacy, mobile }: ProposalContactPanelProps) {
  const linkContent = (
    <>
      <div>
        <div className="fw-semibold">{otherPharmacy.name}</div>
        <div className="text-muted">提案内容のすり合わせやFAX送信前の確認に使えます。</div>
      </div>
      <Link
        to={buildMessagesPath({
          pharmacyId: otherPharmacy.id,
          pharmacyName: otherPharmacy.name,
          draft: buildProposalMessageDraft(proposalId, otherPharmacy.name),
          context: 'proposal',
          contextId: proposalId,
        })}
        className="btn btn-outline-primary btn-sm"
      >
        メッセージを開く
      </Link>
    </>
  );

  if (mobile) {
    return (
      <AppDataPanel title="相手薬局との連絡" className="mb-3" bodyClassName="small">
        <div className="d-flex justify-content-between align-items-center gap-3 flex-wrap">
          {linkContent}
        </div>
      </AppDataPanel>
    );
  }

  return (
    <AppDataPanel title="相手薬局との連絡" className="mb-3" bodyClassName="small d-flex justify-content-between align-items-center gap-3 flex-wrap">
      {linkContent}
    </AppDataPanel>
  );
}
