import AppDataPanel from '../../components/ui/AppDataPanel';
import { formatDateTimeJa } from '../../utils/formatters';
import {
  getProposalDeadlineMeta,
  resolveProposalDeadline,
} from '../../utils/proposal-expiry';
import { getProposalWaitingInfo } from '../../utils/proposal-status';
import type { ProposalDetail } from './types';

interface ProposalDeadlinePanelProps {
  proposal: ProposalDetail['proposal'];
  isA: boolean;
  pharmacyAName: string;
  pharmacyBName: string;
}

export function ProposalDeadlinePanel({ proposal, isA, pharmacyAName, pharmacyBName }: ProposalDeadlinePanelProps) {
  const proposalDeadline = resolveProposalDeadline({
    proposedAt: proposal.proposedAt,
    expiresAt: proposal.expiresAt,
    status: proposal.status,
  });
  const proposalDeadlineMeta = getProposalDeadlineMeta(proposalDeadline);
  const deadlineDescription = proposalDeadline
    ? '提案期限までに承認または拒否を行ってください。期限を過ぎると自動で失効します。'
    : 'このステータスでは提案期限のカウントダウン対象外です。';
  const reminderDescription = proposal.expiryReminderSentAt
    ? `24時間前リマインド送信済み: ${formatDateTimeJa(proposal.expiryReminderSentAt)}`
    : null;
  const waitingInfo = getProposalWaitingInfo(
    proposal.status,
    isA,
    pharmacyAName,
    pharmacyBName,
  );

  return (
    <AppDataPanel title="提案期限" className="mb-3" bodyClassName="small">
      <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap">
        <div>
          <div className="fw-semibold">{formatDateTimeJa(proposalDeadline)}</div>
          <div className="text-muted">
            {deadlineDescription}
          </div>
          {waitingInfo ? (
            <div className="mt-1">
              <span className={`badge ${waitingInfo.waitingForYou ? 'bg-warning text-dark' : 'bg-info text-dark'}`}>
                現在: {waitingInfo.viewerLabel}
              </span>
            </div>
          ) : null}
          {reminderDescription ? (
            <div className="text-warning-emphasis mt-1">{reminderDescription}</div>
          ) : null}
        </div>
        <div>
          <div className="d-flex flex-wrap gap-1 justify-content-end">
            {proposalDeadlineMeta.urgencyLabel ? (
              <span className={`badge ${proposalDeadlineMeta.isExpired ? 'bg-danger' : 'bg-warning text-dark'}`}>
                {proposalDeadlineMeta.urgencyLabel}
              </span>
            ) : null}
            {proposalDeadlineMeta.isExpired ? (
              <span className="badge bg-danger">{proposalDeadlineMeta.remainingLabel}</span>
            ) : proposalDeadlineMeta.isDueSoon ? (
              <span className="badge bg-warning text-dark">{proposalDeadlineMeta.remainingLabel}</span>
            ) : (
              <span className="badge bg-secondary">{proposalDeadlineMeta.remainingLabel}</span>
            )}
          </div>
        </div>
      </div>
    </AppDataPanel>
  );
}
