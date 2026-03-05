import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAsyncState } from '../hooks/useAsyncState';
import AppButton from '../components/ui/AppButton';
import AppAlert from '../components/ui/AppAlert';
import ErrorRetryAlert from '../components/ui/ErrorRetryAlert';
import { Badge, Row, Col } from 'react-bootstrap';
import { useParams, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';
import ConfirmActionModal from '../components/ConfirmActionModal';
import PageLoader from '../components/ui/PageLoader';
import AppDataPanel from '../components/ui/AppDataPanel';
import AppField from '../components/ui/AppField';
import AppSelect from '../components/ui/AppSelect';
import LoadingButton from '../components/ui/LoadingButton';
import ProposalItemsPanel from '../components/ProposalItemsPanel';
import type { ProposalTimelineEvent } from '../utils/proposal-timeline';
import { toViewerProposalStatusLabel } from '../utils/proposal-status';
import { formatDateTimeJa } from '../utils/formatters';
import ProposalTimeline from '../components/timeline/ProposalTimeline';
import PageShell, { ScrollArea } from '../components/ui/PageShell';

interface PharmacyInfo {
  id: number;
  name: string;
  phone: string;
  fax: string;
  address: string;
  prefecture: string;
}

interface ProposalItem {
  id: number;
  fromPharmacyId: number;
  toPharmacyId: number;
  quantity: number;
  yakkaValue: number;
  drugName: string;
  unit: string | null;
  yakkaUnitPrice: number | null;
}

interface ProposalDetail {
  proposal: {
    id: number;
    pharmacyAId: number;
    pharmacyBId: number;
    status: string;
    totalValueA: number;
    totalValueB: number;
    valueDifference: number;
    proposedAt: string;
  };
  items: ProposalItem[];
  pharmacyA: PharmacyInfo;
  pharmacyB: PharmacyInfo;
  timeline?: ProposalTimelineEvent[];
}

const commentTemplates = [
  '内容確認しました。問題なければこのまま進めます。',
  '数量・期限を再確認したいので、対象明細の最新情報共有をお願いします。',
  'FAX送信済みです。到着確認をお願いします。',
];

interface ProposalComment {
  id: number;
  authorPharmacyId: number;
  authorName: string;
  body: string;
  isDeleted: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export default function ProposalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const location = useLocation();
  const [data, setData] = useState<ProposalDetail | null>(null);
  const { loading, setLoading, error, setError, message, setMessage } = useAsyncState();
  const [pendingAction, setPendingAction] = useState<'accept' | 'reject' | 'complete' | null>(null);
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [comments, setComments] = useState<ProposalComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState<number | null>(null);
  const [editingCommentBody, setEditingCommentBody] = useState('');
  const [commentUpdatingId, setCommentUpdatingId] = useState<number | null>(null);
  const [commentDeletingId, setCommentDeletingId] = useState<number | null>(null);
  const [feedbackRating, setFeedbackRating] = useState('5');
  const [feedbackComment, setFeedbackComment] = useState('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const detail = await api.get<ProposalDetail>(`/exchange/proposals/${id}`);
      setData(detail);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : 'マッチング詳細の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [id, setLoading, setError]);

  const fetchComments = useCallback(async () => {
    if (!id) return;
    setCommentsLoading(true);
    try {
      const result = await api.get<{ data: ProposalComment[] }>(`/exchange/proposals/${id}/comments`);
      setComments(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'コメント一覧の取得に失敗しました');
    } finally {
      setCommentsLoading(false);
    }
  }, [id, setError]);

  useEffect(() => {
    void fetchDetail();
    void fetchComments();
  }, [fetchDetail, fetchComments]);

  useEffect(() => {
    if (!data) return;
    if (location.hash !== '#proposal-timeline' && location.hash !== '#timeline') return;

    const timelineSection = document.getElementById('proposal-timeline');
    if (!timelineSection || typeof timelineSection.scrollIntoView !== 'function') return;
    timelineSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [data, location.hash]);

  const proposalForItems = data?.proposal;
  const items = useMemo(() => data?.items ?? [], [data]);
  const itemsAtoB = useMemo(
    () => (proposalForItems ? items.filter((i) => i.fromPharmacyId === proposalForItems.pharmacyAId) : []),
    [items, proposalForItems],
  );
  const itemsBtoA = useMemo(
    () => (proposalForItems ? items.filter((i) => i.fromPharmacyId === proposalForItems.pharmacyBId) : []),
    [items, proposalForItems],
  );

  if (loading && !data) return <PageLoader />;
  if (!data) {
    return (
      <ErrorRetryAlert error={error || 'マッチング詳細を取得できませんでした。'} onRetry={() => void fetchDetail()} />
    );
  }

  const proposal = data.proposal;
  const { pharmacyA, pharmacyB } = data;
  const isA = proposal.pharmacyAId === user?.id;

  // 3-phase: マッチング前 → 仮マッチング → 確定
  const isTentativePhase = ['proposed', 'accepted_a', 'accepted_b'].includes(proposal.status);
  const isConfirmedPhase = proposal.status === 'confirmed';
  const isCompletedPhase = proposal.status === 'completed';
  const isTerminalPhase = ['rejected', 'cancelled'].includes(proposal.status);

  const phaseIndex = isTerminalPhase ? -1
    : isTentativePhase ? 1
    : isConfirmedPhase ? 2
    : isCompletedPhase ? 3
    : 0;

  const statusLabel = proposal.status === 'proposed' ? '仮マッチング中（双方未承認）'
    : proposal.status === 'accepted_a' ? '仮マッチング中（A側承認済）'
    : proposal.status === 'accepted_b' ? '仮マッチング中（B側承認済）'
    : proposal.status === 'confirmed' ? '確定'
    : proposal.status === 'completed' ? '完了'
    : proposal.status === 'rejected' ? '拒否'
    : proposal.status === 'cancelled' ? 'キャンセル'
    : proposal.status;

  const canAccept = (
    (proposal.status === 'proposed') ||
    (proposal.status === 'accepted_a' && !isA) ||
    (proposal.status === 'accepted_b' && isA)
  );
  const canReject = isTentativePhase;
  const canComplete = isConfirmedPhase;

  const handleAction = async () => {
    if (!pendingAction) return;
    setError('');
    setMessage('');
    setActionSubmitting(true);
    try {
      const result = await api.post<{ message: string }>(`/exchange/proposals/${id}/${pendingAction}`);
      setMessage(result.message);
      setPendingAction(null);
      await Promise.all([fetchDetail(), fetchComments()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作に失敗しました');
    } finally {
      setActionSubmitting(false);
    }
  };

  const handleCreateComment = async () => {
    if (!commentBody.trim()) {
      setError('コメント本文を入力してください');
      return;
    }
    setCommentSubmitting(true);
    setError('');
    try {
      await api.post(`/exchange/proposals/${id}/comments`, { body: commentBody.trim() });
      setCommentBody('');
      setMessage('コメントを投稿しました');
      await fetchComments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'コメント投稿に失敗しました');
    } finally {
      setCommentSubmitting(false);
    }
  };

  const handleStartEditComment = (comment: ProposalComment) => {
    setError('');
    setMessage('');
    setEditingCommentId(comment.id);
    setEditingCommentBody(comment.body);
  };

  const handleCancelEditComment = () => {
    setEditingCommentId(null);
    setEditingCommentBody('');
  };

  const handleUpdateComment = async (commentId: number) => {
    const nextBody = editingCommentBody.trim();
    if (!nextBody) {
      setError('コメント本文を入力してください');
      return;
    }
    setCommentUpdatingId(commentId);
    setError('');
    try {
      await api.patch(`/exchange/proposals/${id}/comments/${commentId}`, { body: nextBody });
      setMessage('コメントを更新しました');
      setEditingCommentId(null);
      setEditingCommentBody('');
      await fetchComments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'コメント更新に失敗しました');
    } finally {
      setCommentUpdatingId(null);
    }
  };

  const handleDeleteComment = async (commentId: number) => {
    if (!window.confirm('このコメントを削除してよろしいですか？')) {
      return;
    }
    setCommentDeletingId(commentId);
    setError('');
    try {
      await api.delete(`/exchange/proposals/${id}/comments/${commentId}`);
      setMessage('コメントを削除しました');
      if (editingCommentId === commentId) {
        setEditingCommentId(null);
        setEditingCommentBody('');
      }
      await fetchComments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'コメント削除に失敗しました');
    } finally {
      setCommentDeletingId(null);
    }
  };

  const handleSubmitFeedback = async () => {
    setFeedbackSubmitting(true);
    setError('');
    try {
      const rating = Number(feedbackRating);
      await api.post(`/exchange/proposals/${id}/feedback`, {
        rating,
        comment: feedbackComment.trim() || null,
      });
      setMessage('取引評価を登録しました');
      setFeedbackComment('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '取引評価の登録に失敗しました');
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  const handleApplyCommentTemplate = (template: string) => {
    const trimmed = commentBody.trim();
    setCommentBody(trimmed ? `${trimmed}
${template}` : template);
  };

  const actionLabelMap: Record<'accept' | 'reject' | 'complete', string> = {
    accept: '承認',
    reject: '拒否',
    complete: '交換完了',
  };

  return (
    <PageShell>
      <div className="d-flex justify-content-between align-items-center mb-3 mobile-card-header">
        <h4 className="page-title mb-0">マッチング #{proposal.id}</h4>
        <Link to={`/proposals/${id}/print`} className="btn btn-outline-secondary btn-sm" target="_blank" rel="noopener noreferrer">
          印刷用ページ
        </Link>
      </div>

      {error && <AppAlert variant="danger">{error}</AppAlert>}
      {message && <AppAlert variant="success">{message}</AppAlert>}

      <ScrollArea>
      {/* 3-phase progress indicator */}
      <AppDataPanel className="mb-3" bodyClassName="py-2">
          <div className="d-flex align-items-center justify-content-between small">
            {[
              { label: '仮マッチング', phase: 1 },
              { label: '確定', phase: 2 },
              { label: '完了', phase: 3 },
            ].map((step, i) => (
              <div key={step.phase} className="d-flex align-items-center flex-grow-1">
                <div
                  className={`rounded-circle d-flex align-items-center justify-content-center ${
                    isTerminalPhase ? 'bg-secondary'
                    : phaseIndex >= step.phase ? 'bg-success' : 'bg-light border'
                  }`}
                  style={{ width: 28, height: 28, minWidth: 28, color: isTerminalPhase || phaseIndex >= step.phase ? '#fff' : '#999' }}
                >
                  {isTerminalPhase ? '—' : phaseIndex >= step.phase ? '✓' : step.phase}
                </div>
                <span className={`ms-1 ${phaseIndex >= step.phase && !isTerminalPhase ? 'fw-bold' : 'text-muted'}`}>
                  {step.label}
                </span>
                {i < 2 && <div className={`flex-grow-1 mx-2 ${phaseIndex > step.phase && !isTerminalPhase ? 'border-success' : ''}`} style={{ borderBottom: '2px solid #dee2e6', borderColor: phaseIndex > step.phase && !isTerminalPhase ? '#198754' : undefined }} />}
              </div>
            ))}
          </div>
          <div className="text-center mt-1 small text-muted">
            現在のステータス: <Badge bg={isTerminalPhase ? 'danger' : isCompletedPhase ? 'secondary' : isConfirmedPhase ? 'success' : 'warning'}>{statusLabel}</Badge>
          </div>
      </AppDataPanel>

      <section id="proposal-timeline" style={{ scrollMarginTop: 96 }}>
        <AppDataPanel title="進行履歴" className="mb-3" bodyClassName="small">
          <ProposalTimeline
            events={data.timeline ?? []}
            statusLabelFormatter={(status) => toViewerProposalStatusLabel(status, isA)}
            emptyMessage="表示できる履歴はありません。"
            filterAriaLabel="進行履歴フィルタ"
          />
        </AppDataPanel>
      </section>

      <Row className="g-3 mb-3">
        <Col md={6}>
          <AppDataPanel title={`${pharmacyA.name} (A)`} bodyClassName="small">
              <p>{pharmacyA.prefecture} {pharmacyA.address}</p>
              <p>TEL: {pharmacyA.phone} / FAX: {pharmacyA.fax}</p>
          </AppDataPanel>
        </Col>
        <Col md={6}>
          <AppDataPanel title={`${pharmacyB.name} (B)`} bodyClassName="small">
              <p>{pharmacyB.prefecture} {pharmacyB.address}</p>
              <p>TEL: {pharmacyB.phone} / FAX: {pharmacyB.fax}</p>
          </AppDataPanel>
        </Col>
      </Row>

      <AppDataPanel title="交換手順（3フェーズ）" className="mb-3" bodyClassName="small">
          <ol className="mb-0">
            <li><strong>仮マッチング:</strong> 印刷用ページから交換様式を印刷し、提案元が署名/押印後に相手先FAXへ送信します。</li>
            <li><strong>双方承認:</strong> 受信側は同意欄を記入してFAX返信し、双方がシステム上で「承認」します。</li>
            <li><strong>確定→完了:</strong> 双方承認で確定となります。受け渡し完了後に「交換完了」を実行します。</li>
          </ol>
      </AppDataPanel>

      <ProposalItemsPanel
        items={itemsAtoB}
        fromName={pharmacyA.name}
        toName={pharmacyB.name}
        totalValue={proposal.totalValueA}
      />

      <ProposalItemsPanel
        items={itemsBtoA}
        fromName={pharmacyB.name}
        toName={pharmacyA.name}
        totalValue={proposal.totalValueB}
      />

      <div className="d-flex gap-2 mobile-stack">
        {canAccept && <AppButton variant="success" onClick={() => setPendingAction('accept')}>仮マッチングを承認</AppButton>}
        {canReject && <AppButton variant="danger" onClick={() => setPendingAction('reject')}>拒否する</AppButton>}
        {canComplete && <AppButton variant="primary" onClick={() => setPendingAction('complete')}>交換完了</AppButton>}
      </div>

      {isCompletedPhase && !user?.isAdmin && (
        <AppDataPanel title="取引評価" className="mt-3">
          <div className="row g-2 align-items-end">
            <div className="col-md-2">
              <AppSelect
                controlId="proposal-feedback-rating"
                value={feedbackRating}
                ariaLabel="評価"
                onChange={setFeedbackRating}
                options={[
                  { value: '5', label: '5' },
                  { value: '4', label: '4' },
                  { value: '3', label: '3' },
                  { value: '2', label: '2' },
                  { value: '1', label: '1' },
                ]}
              />
            </div>
            <div className="col-md-7">
              <AppField
                controlId="proposal-feedback-comment"
                label="コメント（任意）"
                as="textarea"
                rows={2}
                maxLength={300}
                value={feedbackComment}
                onChange={setFeedbackComment}
              />
            </div>
            <div className="col-md-3">
              <LoadingButton
                onClick={handleSubmitFeedback}
                loading={feedbackSubmitting}
                loadingLabel="登録中..."
                className="w-100"
              >
                評価を登録
              </LoadingButton>
            </div>
          </div>
        </AppDataPanel>
      )}

      <AppDataPanel title="交渉メモ / コメント" className="mt-3">
        {commentsLoading ? (
          <div className="small text-muted">コメントを読み込み中...</div>
        ) : comments.length === 0 ? (
          <div className="small text-muted">コメントはまだありません。</div>
        ) : (
          <div className="d-flex flex-column gap-2 mb-3">
            {comments.map((comment) => (
              <div key={comment.id} className="border rounded p-2">
                <div className="small text-muted">
                  {comment.authorName} / {formatDateTimeJa(comment.createdAt)}
                </div>
                {editingCommentId === comment.id ? (
                  <div className="mt-2 d-flex flex-column gap-2">
                    <AppField
                      controlId={`proposal-comment-edit-${comment.id}`}
                      label="コメント編集"
                      as="textarea"
                      rows={3}
                      maxLength={1000}
                      value={editingCommentBody}
                      onChange={setEditingCommentBody}
                    />
                    <div className="d-flex gap-2">
                      <LoadingButton
                        variant="primary"
                        onClick={() => void handleUpdateComment(comment.id)}
                        loading={commentUpdatingId === comment.id}
                        loadingLabel="更新中..."
                        disabled={!editingCommentBody.trim()}
                      >
                        保存
                      </LoadingButton>
                      <AppButton
                        variant="outline-secondary"
                        onClick={handleCancelEditComment}
                        disabled={commentUpdatingId === comment.id}
                      >
                        キャンセル
                      </AppButton>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div>{comment.body}</div>
                    {comment.updatedAt && comment.createdAt && comment.updatedAt !== comment.createdAt && (
                      <div className="small text-muted">編集済み</div>
                    )}
                  </div>
                )}
                {!user?.isAdmin && comment.authorPharmacyId === user?.id && !comment.isDeleted && editingCommentId !== comment.id && (
                  <div className="d-flex gap-2 mt-2">
                    <AppButton
                      size="sm"
                      variant="outline-primary"
                      onClick={() => handleStartEditComment(comment)}
                      disabled={commentDeletingId === comment.id}
                    >
                      編集
                    </AppButton>
                    <LoadingButton
                      size="sm"
                      variant="outline-danger"
                      onClick={() => void handleDeleteComment(comment.id)}
                      loading={commentDeletingId === comment.id}
                      loadingLabel="削除中..."
                    >
                      削除
                    </LoadingButton>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {!user?.isAdmin && (
          <div className="d-flex flex-column gap-2">
            <div className="d-flex gap-2 flex-wrap">
              {commentTemplates.map((template, index) => (
                <AppButton
                  key={template}
                  size="sm"
                  variant="outline-secondary"
                  onClick={() => handleApplyCommentTemplate(template)}
                >
                  定型文{index + 1}
                </AppButton>
              ))}
            </div>
            <AppField
              controlId="proposal-comment-body"
              label="新規コメント"
              as="textarea"
              rows={3}
              maxLength={1000}
              value={commentBody}
              onChange={setCommentBody}
            />
            <LoadingButton
              variant="outline-primary"
              onClick={handleCreateComment}
              loading={commentSubmitting}
              loadingLabel="投稿中..."
              disabled={!commentBody.trim()}
            >
              コメントを投稿
            </LoadingButton>
          </div>
        )}
      </AppDataPanel>

      </ScrollArea>

      <ConfirmActionModal
        show={pendingAction !== null}
        title={`マッチングの${pendingAction ? actionLabelMap[pendingAction] : ''}`}
        body={pendingAction
          ? `このマッチングを${actionLabelMap[pendingAction]}してよろしいですか？`
          : null}
        confirmLabel={pendingAction ? actionLabelMap[pendingAction] : '実行'}
        confirmVariant={pendingAction === 'reject' ? 'danger' : 'primary'}
        onCancel={() => setPendingAction(null)}
        onConfirm={handleAction}
        pending={actionSubmitting}
      />
    </PageShell>
  );
}
