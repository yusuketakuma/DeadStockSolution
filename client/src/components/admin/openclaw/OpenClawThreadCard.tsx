import { Badge } from 'react-bootstrap';
import AppCard from '../../ui/AppCard';
import InlineLoader from '../../ui/InlineLoader';
import { formatDateTimeJa } from '../../../utils/formatters';
import type { RequestThreadResponse } from './types';
import { openclawStatusMeta, workflowStatusMeta } from './types';

interface OpenClawThreadCardProps {
  selectedRequestId: number | null;
  threadLoading: boolean;
  thread: RequestThreadResponse | null;
}

/** DSS会話履歴表示カード */
export default function OpenClawThreadCard({
  selectedRequestId,
  threadLoading,
  thread,
}: OpenClawThreadCardProps) {
  return (
    <AppCard className="mt-3">
      <AppCard.Header>DSS会話履歴</AppCard.Header>
      <AppCard.Body>
        {!selectedRequestId ? (
          <div className="text-muted small">要望を選択すると詳細が表示されます。</div>
        ) : threadLoading ? (
          <InlineLoader text="会話履歴を読み込み中..." className="text-muted small" />
        ) : !thread ? (
          <div className="text-muted small">会話履歴を取得できませんでした。</div>
        ) : (
          <div className="d-flex flex-column gap-3">
            <div className="dl-badge-row">
              <Badge bg={openclawStatusMeta(thread.request.openclawStatus).bg}>
                {openclawStatusMeta(thread.request.openclawStatus).label}
              </Badge>
              <Badge bg={workflowStatusMeta(thread.request.workflowStatus).bg}>
                {workflowStatusMeta(thread.request.workflowStatus).label}
              </Badge>
              {thread.request.prUrl && (
                <a href={thread.request.prUrl} target="_blank" rel="noreferrer" className="small">
                  PR #{thread.request.prNumber ?? '-'} を開く
                </a>
              )}
              {thread.request.branchName && <span className="text-muted small text-wrap-anywhere">branch: {thread.request.branchName}</span>}
            </div>

            <div className="small text-muted">
              {thread.request.pharmacyName} / 要望 #{thread.request.id}
            </div>

            <div className="d-flex flex-column gap-2">
              {thread.messages.map((entry) => (
                <div key={entry.id} className={`border rounded p-3 ${entry.authorType === 'user' ? 'bg-light' : 'bg-white'}`}>
                  <div className="d-flex justify-content-between align-items-center mb-1">
                    <strong className="small">
                      {entry.authorType === 'user'
                        ? 'ユーザー'
                        : entry.authorType === 'openclaw_agent'
                          ? 'DSS Manager'
                          : entry.authorType === 'admin'
                            ? 'Admin'
                            : 'System'}
                    </strong>
                    <span className="text-muted small">{formatDateTimeJa(entry.createdAt)}</span>
                  </div>
                  <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{entry.body}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </AppCard.Body>
    </AppCard>
  );
}
