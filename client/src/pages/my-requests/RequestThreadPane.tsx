import { useEffect, useState, type ChangeEvent } from 'react';
import { Badge, Form } from 'react-bootstrap';
import AttachmentPreviewList from '../../components/ui/AttachmentPreviewList';
import AppCard from '../../components/ui/AppCard';
import AppControl from '../../components/ui/AppControl';
import InlineLoader from '../../components/ui/InlineLoader';
import LoadingButton from '../../components/ui/LoadingButton';
import { formatDateTimeJa } from '../../utils/formatters';
import {
  attachmentUrl,
  authorLabel,
  categoryLabel,
  closeReasonLabel,
  priorityBadge,
  statusBadge,
  waitingBadge,
} from './helpers';
import { REQUEST_TEMPLATES, type RequestThreadResponse } from './types';
import { getRequestSlaSummary } from '../../utils/request-sla';

interface RequestThreadPaneProps {
  selectedRequestId: number | null;
  threadLoading: boolean;
  thread: RequestThreadResponse | null;
  replyText: string;
  replyFiles: File[];
  sending: boolean;
  reminding: boolean;
  onBack: () => void;
  onReplyTextChange: (value: string) => void;
  onReplyFilesChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onReplyTemplateSelect: (template: string) => void;
  onSendReply: () => void;
  onRemind: () => void;
}

export function RequestThreadPane({
  selectedRequestId,
  threadLoading,
  thread,
  replyText,
  replyFiles,
  sending,
  reminding,
  onBack,
  onReplyTextChange,
  onReplyFilesChange,
  onReplyTemplateSelect,
  onSendReply,
  onRemind,
}: RequestThreadPaneProps) {
  const workflowMeta = thread ? statusBadge(thread.request.workflowStatus) : null;
  const priorityMeta = thread ? priorityBadge(thread.request.priority) : null;
  const waitingMeta = thread ? waitingBadge(thread.request) : null;
  const slaSummary = thread ? getRequestSlaSummary(thread.request) : null;
  const [nowMs, setNowMs] = useState(() => Date.now());
  const latestReminderAt = thread
    ? [...thread.messages]
      .reverse()
      .find((entry) => entry.authorType === 'user' && entry.metadata?.kind === 'user_reminder')
      ?.createdAt ?? null
    : null;
  const nextReminderAt = latestReminderAt ? new Date(new Date(latestReminderAt).getTime() + 6 * 60 * 60 * 1000).toISOString() : null;
  const reminderCooldownActive = nextReminderAt ? nowMs < Date.parse(nextReminderAt) : false;

  useEffect(() => {
    setNowMs(Date.now());
  }, [latestReminderAt]);

  return (
    <>
      <button
        type="button"
        className="btn btn-outline-secondary btn-sm d-xl-none mb-2"
        onClick={onBack}
      >
        ← 一覧に戻る
      </button>
      <AppCard>
        <AppCard.Header>会話履歴</AppCard.Header>
        <AppCard.Body>
          {!selectedRequestId ? (
            <div className="text-muted small">表示する要望を選択してください。</div>
          ) : threadLoading ? (
            <InlineLoader text="会話履歴を読み込み中..." className="text-muted small" />
          ) : !thread ? (
            <div className="text-muted small">会話履歴を取得できませんでした。</div>
          ) : (
            <div className="d-flex flex-column gap-3">
              <div className="border rounded p-3 bg-light">
                <div className="d-flex flex-wrap gap-2 align-items-center">
                  <Badge bg={workflowMeta?.bg} text={workflowMeta?.text}>{workflowMeta?.label}</Badge>
                  <Badge bg="light" text="dark">{categoryLabel(thread.request.category)}</Badge>
                  <Badge bg={priorityMeta?.bg} text={priorityMeta?.text}>{priorityMeta?.label}</Badge>
                  {thread.request.closeReason && (
                    <Badge bg="secondary">クローズ: {closeReasonLabel(thread.request.closeReason)}</Badge>
                  )}
                  {thread.request.assignedAdminName && (
                    <Badge bg="dark">担当: {thread.request.assignedAdminName}</Badge>
                  )}
                  {waitingMeta && <Badge bg={waitingMeta.bg} text={waitingMeta.text}>{waitingMeta.label}</Badge>}
                </div>
                <div className="small text-muted mt-2">元の要望: {thread.request.requestText}</div>
                {(thread.request.latestSummary || thread.request.openclawSummary) && (
                  <div className="small mt-2">{thread.request.latestSummary ?? thread.request.openclawSummary}</div>
                )}
                {slaSummary && (
                  <div className="d-flex flex-wrap gap-2 align-items-center mt-2">
                    <Badge bg={slaSummary.tone} text={slaSummary.tone === 'warning' ? 'dark' : undefined}>
                      {slaSummary.nextActionLabel}
                    </Badge>
                    <span className="small text-muted">
                      {slaSummary.dueLabel} / {slaSummary.elapsedLabel}
                    </span>
                    {slaSummary.dueAt && (
                      <span className="small text-muted">
                        目安: {formatDateTimeJa(slaSummary.dueAt)}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {(thread.request.branchName || thread.request.prUrl || thread.request.lastQuestion || thread.request.lastError) && (
                <div className="border rounded p-3">
                  <div className="fw-semibold mb-2">実装・対応状況</div>
                  {thread.request.prUrl && (
                    <div className="small">
                      PR: <a href={thread.request.prUrl} target="_blank" rel="noreferrer">#{thread.request.prNumber ?? '-'}</a>
                    </div>
                  )}
                  {thread.request.branchName && (
                    <div className="small text-muted">branch: {thread.request.branchName}</div>
                  )}
                  {thread.request.lastQuestion && (
                    <div className="small mt-2">確認事項: {thread.request.lastQuestion}</div>
                  )}
                  {thread.request.lastError && (
                    <div className="small text-danger mt-2">最新エラー: {thread.request.lastError}</div>
                  )}
                </div>
              )}

              <div className="d-flex flex-column gap-2">
                {thread.messages.map((entry) => {
                  const attachments = entry.attachments ?? [];

                  return (
                    <div key={entry.id} className={`border rounded p-3 ${entry.authorType === 'user' ? 'bg-light' : 'bg-white'}`}>
                      <div className="d-flex justify-content-between align-items-center mb-1">
                        <strong className="small">{authorLabel(entry.authorType)}</strong>
                        <span className="text-muted small">{formatDateTimeJa(entry.createdAt)}</span>
                      </div>
                      {entry.body ? (
                        <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{entry.body}</div>
                      ) : (
                        <div className="small text-muted">添付ファイル</div>
                      )}
                      <AttachmentPreviewList
                        attachments={attachments}
                        getDownloadUrl={attachmentUrl}
                      />
                    </div>
                  );
                })}
              </div>

              <div className="border-top pt-3">
                <div className="d-flex flex-wrap gap-2 mb-2">
                  {REQUEST_TEMPLATES.map((template) => (
                    <button
                      key={template}
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      onClick={() => onReplyTemplateSelect(template)}
                    >
                      {template}
                    </button>
                  ))}
                </div>
                <AppControl
                  as="textarea"
                  rows={4}
                  value={replyText}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onReplyTextChange(event.target.value)}
                  placeholder="必要な追加情報や回答を入力"
                />
                <div className="d-flex flex-column flex-md-row justify-content-between gap-2 mt-2">
                  <div className="d-flex flex-column gap-1">
                    <Form.Label htmlFor="request-reply-files" className="small mb-0">返信添付ファイル</Form.Label>
                    <Form.Control
                      id="request-reply-files"
                      aria-label="返信添付ファイル"
                      type="file"
                      multiple
                      onChange={onReplyFilesChange}
                    />
                    {replyFiles.length > 0 && (
                      <div className="text-muted small">{replyFiles.map((file) => file.name).join(', ')}</div>
                    )}
                  </div>
                  <LoadingButton
                    variant="primary"
                    onClick={onSendReply}
                    loading={sending}
                    loadingLabel="送信中..."
                    disabled={thread.request.workflowStatus === 'completed'}
                  >
                    追加情報を送信
                  </LoadingButton>
                </div>
                {(thread.request.waitingOn === 'admin' || thread.request.waitingOn === 'openclaw') && thread.request.workflowStatus !== 'completed' && (
                  <div className="mt-2 d-flex gap-2 flex-wrap align-items-center">
                    <LoadingButton
                      variant="outline-warning"
                      onClick={onRemind}
                      loading={reminding}
                      loadingLabel="送信中..."
                      disabled={reminderCooldownActive}
                    >
                      再催促する
                    </LoadingButton>
                    <span className="small text-muted">
                      {reminderCooldownActive && nextReminderAt
                        ? `前回の再催促から6時間経過後に再送できます（次回: ${formatDateTimeJa(nextReminderAt)}）`
                        : '返信がなく滞留している場合、状況確認の再催促を送れます。'}
                    </span>
                  </div>
                )}
                {thread.request.workflowStatus === 'completed' && (
                  <div className="text-muted small mt-2">完了済み要望のため返信はできません。</div>
                )}
              </div>
            </div>
          )}
        </AppCard.Body>
      </AppCard>
    </>
  );
}
