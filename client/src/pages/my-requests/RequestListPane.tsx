import { Badge, Form } from 'react-bootstrap';
import AppCard from '../../components/ui/AppCard';
import InlineLoader from '../../components/ui/InlineLoader';
import { categoryLabel, priorityBadge, statusBadge, waitingBadge } from './helpers';
import type { RequestItem, RequestQueueFilter, RequestSummary } from './types';
import { formatDateTimeJa } from '../../utils/formatters';
import { getRequestSlaSummary } from '../../utils/request-sla';

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
  const emptyStateMessage = requests.length === 0
    ? '送信済みの要望はまだありません。'
    : '現在の絞り込み条件に一致する要望はありません。';
  const queueFilterOptions: Array<{ value: RequestQueueFilter; label: string }> = [
    { value: 'all', label: `すべて ${requests.length}` },
    { value: 'my_turn', label: `今日返答したい ${requestSummary.myTurn}` },
    { value: 'overdue', label: `24時間超 ${requestSummary.overdue}` },
    { value: 'unread', label: `未読あり ${requestSummary.unread}` },
    { value: 'openclaw', label: `OpenClaw ${requestSummary.openclaw}` },
  ];

  return (
    <AppCard>
      <AppCard.Header>要望一覧</AppCard.Header>
      <AppCard.Body>
        <div className="text-muted small mb-3">
          更新はリアルタイムで反映されます。OpenClaw の進行状況と管理者返信もここに集約されます。
        </div>
        <div className="mb-3 form-max-360">
          <Form.Label htmlFor="request-queue-filter" className="small text-muted">表示する要望</Form.Label>
          <Form.Select
            id="request-queue-filter"
            size="sm"
            value={queueFilter}
            onChange={(event) => onQueueFilterChange(event.target.value as RequestQueueFilter)}
          >
            {queueFilterOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Form.Select>
        </div>
        {loading ? (
          <InlineLoader text="読み込み中..." className="text-muted small" />
        ) : displayRequests.length === 0 ? (
          <div className="text-muted small">{emptyStateMessage}</div>
        ) : (
          <div className="d-flex flex-column gap-2">
            {displayRequests.map((item) => {
              const workflowMeta = statusBadge(item.workflowStatus);
              const priorityMeta = priorityBadge(item.priority);
              const waitingMeta = waitingBadge(item);
              const slaSummary = getRequestSlaSummary(item);

              return (
                <button
                  key={item.id}
                  type="button"
                  className={`btn text-start text-wrap border w-100 ${
                    selectedRequestId === item.id
                      ? 'border-primary bg-light'
                      : item.isOverdue
                        ? 'border-danger bg-danger bg-opacity-10'
                        : 'border-light-subtle'
                  }`}
                  style={{ display: 'block', whiteSpace: 'normal' }}
                  onClick={() => onSelectRequest(item.id)}
                >
                  <div className="d-flex justify-content-between align-items-start gap-2">
                    <strong className="text-wrap-anywhere flex-grow-1" style={{ minWidth: 0 }}>要望 #{item.id}</strong>
                    <Badge bg={workflowMeta.bg} text={workflowMeta.text}>{workflowMeta.label}</Badge>
                  </div>
                  <div className="d-flex flex-wrap gap-1 mt-2">
                    <Badge bg="light" text="dark">{categoryLabel(item.category)}</Badge>
                    <Badge bg={priorityMeta.bg} text={priorityMeta.text}>{priorityMeta.label}</Badge>
                    {item.hasUnread && <Badge bg="danger">未読あり</Badge>}
                    {waitingMeta && <Badge bg={waitingMeta.bg} text={waitingMeta.text}>{waitingMeta.label}</Badge>}
                  </div>
                  <div className="small mt-2 text-wrap-anywhere">{item.requestText}</div>
                  {(item.latestSummary || item.openclawSummary) && (
                    <div className="text-muted small mt-2 text-wrap-anywhere">{item.latestSummary ?? item.openclawSummary}</div>
                  )}
                  <div className="small mt-2">
                    <span className={`badge bg-${slaSummary.tone} ${slaSummary.tone === 'warning' ? 'text-dark' : ''}`}>
                      {slaSummary.nextActionLabel}
                    </span>
                    <span className="text-muted ms-2">
                      {slaSummary.dueLabel} / {slaSummary.elapsedLabel}
                    </span>
                  </div>
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
