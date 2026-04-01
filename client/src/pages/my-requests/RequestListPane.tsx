import { Badge } from 'react-bootstrap';
import AppCard from '../../components/ui/AppCard';
import InlineLoader from '../../components/ui/InlineLoader';
import { categoryLabel, priorityBadge, statusBadge, waitingBadge } from './helpers';
import type { RequestItem, RequestQueueFilter, RequestSummary } from './types';
import { formatDateTimeJa } from '../../utils/formatters';

interface RequestListPaneProps {
  loading: boolean;
  requests: RequestItem[];
  displayRequests: RequestItem[];
  selectedRequestId: number | null;
  queueFilter: RequestQueueFilter;
  requestSummary: RequestSummary;
  onSelectRequest: (requestId: number) => void;
  onQueueFilterChange: (filter: RequestQueueFilter) => void;
}

export function RequestListPane({
  loading,
  requests,
  displayRequests,
  selectedRequestId,
  queueFilter,
  requestSummary,
  onSelectRequest,
  onQueueFilterChange,
}: RequestListPaneProps) {
  return (
    <AppCard>
      <AppCard.Header>要望一覧</AppCard.Header>
      <AppCard.Body>
        <div className="text-muted small mb-3">
          更新はリアルタイムで反映されます。OpenClaw の進行状況と管理者返信もここに集約されます。
        </div>
        <div className="d-flex gap-2 flex-wrap mb-3">
          <button type="button" className={`btn btn-sm ${queueFilter === 'all' ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => onQueueFilterChange('all')}>すべて {requests.length}</button>
          <button type="button" className={`btn btn-sm ${queueFilter === 'my_turn' ? 'btn-primary' : 'btn-outline-warning'}`} onClick={() => onQueueFilterChange('my_turn')}>今日返答したい {requestSummary.myTurn}</button>
          <button type="button" className={`btn btn-sm ${queueFilter === 'overdue' ? 'btn-danger' : 'btn-outline-danger'}`} onClick={() => onQueueFilterChange('overdue')}>24時間超 {requestSummary.overdue}</button>
          <button type="button" className={`btn btn-sm ${queueFilter === 'unread' ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => onQueueFilterChange('unread')}>未読あり {requestSummary.unread}</button>
          <button type="button" className={`btn btn-sm ${queueFilter === 'openclaw' ? 'btn-dark' : 'btn-outline-dark'}`} onClick={() => onQueueFilterChange('openclaw')}>OpenClaw {requestSummary.openclaw}</button>
        </div>
        {loading ? (
          <InlineLoader text="読み込み中..." className="text-muted small" />
        ) : displayRequests.length === 0 ? (
          <div className="text-muted small">送信済みの要望はまだありません。</div>
        ) : (
          <div className="d-flex flex-column gap-2">
            {displayRequests.map((item) => {
              const workflowMeta = statusBadge(item.workflowStatus);
              const priorityMeta = priorityBadge(item.priority);
              const waitingMeta = waitingBadge(item);

              return (
                <button
                  key={item.id}
                  type="button"
                  className={`btn text-start border ${selectedRequestId === item.id ? 'border-primary bg-light' : 'border-light-subtle'}`}
                  onClick={() => onSelectRequest(item.id)}
                >
                  <div className="d-flex justify-content-between align-items-start gap-2">
                    <strong>要望 #{item.id}</strong>
                    <Badge bg={workflowMeta.bg} text={workflowMeta.text}>{workflowMeta.label}</Badge>
                  </div>
                  <div className="d-flex flex-wrap gap-1 mt-2">
                    <Badge bg="light" text="dark">{categoryLabel(item.category)}</Badge>
                    <Badge bg={priorityMeta.bg} text={priorityMeta.text}>{priorityMeta.label}</Badge>
                    {item.hasUnread && <Badge bg="danger">未読あり</Badge>}
                    {waitingMeta && <Badge bg={waitingMeta.bg} text={waitingMeta.text}>{waitingMeta.label}</Badge>}
                  </div>
                  <div className="small mt-2">{item.requestText}</div>
                  {(item.latestSummary || item.openclawSummary) && (
                    <div className="text-muted small mt-2">{item.latestSummary ?? item.openclawSummary}</div>
                  )}
                  <div className="text-muted small mt-2">{formatDateTimeJa(item.updatedAt ?? item.createdAt)}</div>
                </button>
              );
            })}
          </div>
        )}
      </AppCard.Body>
    </AppCard>
  );
}
