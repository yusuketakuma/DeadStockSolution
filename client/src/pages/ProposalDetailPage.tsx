import { useState, useEffect, useCallback, useMemo } from 'react';
import { Row, Col, Accordion } from 'react-bootstrap';
import { useParams, Link, useLocation } from 'react-router-dom';
import { useAsyncState } from '../hooks/useAsyncState';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../api/client';
import AppAlert from '../components/ui/AppAlert';
import ErrorRetryAlert from '../components/ui/ErrorRetryAlert';
import PageLoader from '../components/ui/PageLoader';
import AppDataPanel from '../components/ui/AppDataPanel';
import ProposalItemsPanel from '../components/ProposalItemsPanel';
import ProposalTimeline from '../components/timeline/ProposalTimeline';
import PageShell, { ScrollArea } from '../components/ui/PageShell';
import AppResponsiveSwitch from '../components/ui/AppResponsiveSwitch';
import ConfirmActionModal from '../components/ConfirmActionModal';
import { ProposalProgressIndicator } from '../components/proposal/ProposalProgressIndicator';
import { ProposalFeedbackSection } from '../components/proposal/ProposalFeedbackSection';
import { ProposalCommentSection, type ProposalComment } from '../components/proposal/ProposalCommentSection';
import { ProposalActionButtons, ProposalMobileStickyActions } from '../components/proposal/ProposalActions';
import type { EnrichedProposalTimelineEvent } from '../types/timeline';

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
  enrichedTimeline?: EnrichedProposalTimelineEvent[];
}

function resolveProposalStatusMeta(proposal: ProposalDetail['proposal'], currentUserId: number | undefined) {
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
  const [mobileTimelineKey, setMobileTimelineKey] = useState<string | null>(null);

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

  const handleApplyCommentTemplate = useCallback((template: string) => {
    const trimmed = commentBody.trim();
    setCommentBody(trimmed ? `${trimmed}\n${template}` : template);
  }, [commentBody]);

  if (loading && !data) return <PageLoader />;
  if (!data) {
    return (
      <ErrorRetryAlert error={error || 'マッチング詳細を取得できませんでした。'} onRetry={() => void fetchDetail()} />
    );
  }

  const proposal = data.proposal;
  const { pharmacyA, pharmacyB } = data;
  const {
    isConfirmedPhase,
    isCompletedPhase,
    isTerminalPhase,
    phaseIndex,
    canAccept,
    canReject,
    canComplete,
  } = resolveProposalStatusMeta(proposal, user?.id);

  const statusLabel = proposal.status === 'proposed' ? '仮マッチング中（双方未承認）'
    : proposal.status === 'accepted_a' ? '仮マッチング中（A側承認済）'
    : proposal.status === 'accepted_b' ? '仮マッチング中（B側承認済）'
    : proposal.status === 'confirmed' ? '確定'
    : proposal.status === 'completed' ? '完了'
    : proposal.status === 'rejected' ? '拒否'
    : proposal.status === 'cancelled' ? 'キャンセル'
    : proposal.status;

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

  const actionLabelMap: Record<'accept' | 'reject' | 'complete', string> = {
    accept: '承認',
    reject: '拒否',
    complete: '交換完了',
  };

  const hasStickyActions = canAccept || canReject || canComplete;

  const TimelineSection = () => (
    <section id="proposal-timeline" style={{ scrollMarginTop: 96 }}>
      <AppDataPanel title="進行履歴" className="mb-3" bodyClassName="small">
        <ProposalTimeline
          events={data.enrichedTimeline ?? []}
          currentPharmacyId={user?.id ?? 0}
        />
      </AppDataPanel>
    </section>
  );

  const MobileTimelineAccordion = () => (
    <Accordion
      activeKey={mobileTimelineKey ?? undefined}
      onSelect={(eventKey) => {
        const nextKey = typeof eventKey === 'string' ? eventKey : null;
        setMobileTimelineKey((current) => (current === nextKey ? null : nextKey));
      }}
      className="mb-3"
    >
      <Accordion.Item eventKey="0">
        <Accordion.Header>進行履歴</Accordion.Header>
        <Accordion.Body className="p-2">
          <ProposalTimeline
            events={data.enrichedTimeline ?? []}
            currentPharmacyId={user?.id ?? 0}
          />
        </Accordion.Body>
      </Accordion.Item>
    </Accordion>
  );

  const PharmacyInfoSection = () => (
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
  );

  const ExchangeInstructions = () => (
    <AppDataPanel title="交換手順（3フェーズ）" className="mb-3" bodyClassName="small">
      <ol className="mb-0">
        <li><strong>仮マッチング:</strong> 印刷用ページから交換様式を印刷し、提案元が署名/押印後に相手先FAXへ送信します。</li>
        <li><strong>双方承認:</strong> 受信側は同意欄を記入してFAX返信し、双方がシステム上で「承認」します。</li>
        <li><strong>確定→完了:</strong> 双方承認で確定となります。受け渡し完了後に「交換完了」を実行します。</li>
      </ol>
    </AppDataPanel>
  );

  const DesktopLayout = () => (
    <ScrollArea>
      <ProposalProgressIndicator
        isTerminalPhase={isTerminalPhase}
        isConfirmedPhase={isConfirmedPhase}
        isCompletedPhase={isCompletedPhase}
        phaseIndex={phaseIndex}
        statusLabel={statusLabel}
      />
      {TimelineSection()}
      {PharmacyInfoSection()}
      {ExchangeInstructions()}
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
      <ProposalActionButtons
        canAccept={canAccept}
        canReject={canReject}
        canComplete={canComplete}
        onAccept={() => setPendingAction('accept')}
        onReject={() => setPendingAction('reject')}
        onComplete={() => setPendingAction('complete')}
      />
      <ProposalFeedbackSection
        isCompletedPhase={isCompletedPhase}
        isAdmin={user?.isAdmin ?? false}
        feedbackRating={feedbackRating}
        feedbackComment={feedbackComment}
        feedbackSubmitting={feedbackSubmitting}
        onRatingChange={setFeedbackRating}
        onCommentChange={setFeedbackComment}
        onSubmit={handleSubmitFeedback}
      />
      <ProposalCommentSection
        comments={comments}
        commentsLoading={commentsLoading}
        currentUserId={user?.id}
        isAdmin={user?.isAdmin ?? false}
        commentBody={commentBody}
        commentSubmitting={commentSubmitting}
        editingCommentId={editingCommentId}
        editingCommentBody={editingCommentBody}
        commentUpdatingId={commentUpdatingId}
        commentDeletingId={commentDeletingId}
        hasStickyActions={hasStickyActions}
        onStartEdit={handleStartEditComment}
        onCancelEdit={handleCancelEditComment}
        onUpdateComment={handleUpdateComment}
        onDeleteComment={handleDeleteComment}
        onEditingCommentBodyChange={setEditingCommentBody}
        onCommentBodyChange={setCommentBody}
        onSubmit={handleCreateComment}
        onApplyTemplate={handleApplyCommentTemplate}
      />
    </ScrollArea>
  );

  const MobileLayout = () => (
    <>
      <ScrollArea>
        <ProposalProgressIndicator
          isTerminalPhase={isTerminalPhase}
          isConfirmedPhase={isConfirmedPhase}
          isCompletedPhase={isCompletedPhase}
          phaseIndex={phaseIndex}
          statusLabel={statusLabel}
        />
        {MobileTimelineAccordion()}
        {PharmacyInfoSection()}
        {ExchangeInstructions()}
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
        <ProposalFeedbackSection
          isCompletedPhase={isCompletedPhase}
          isAdmin={user?.isAdmin ?? false}
          feedbackRating={feedbackRating}
          feedbackComment={feedbackComment}
          feedbackSubmitting={feedbackSubmitting}
          onRatingChange={setFeedbackRating}
          onCommentChange={setFeedbackComment}
          onSubmit={handleSubmitFeedback}
        />
        <ProposalCommentSection
          comments={comments}
          commentsLoading={commentsLoading}
          currentUserId={user?.id}
          isAdmin={user?.isAdmin ?? false}
          commentBody={commentBody}
          commentSubmitting={commentSubmitting}
          editingCommentId={editingCommentId}
          editingCommentBody={editingCommentBody}
          commentUpdatingId={commentUpdatingId}
          commentDeletingId={commentDeletingId}
          includeComposer={false}
          hasStickyActions={hasStickyActions}
          onStartEdit={handleStartEditComment}
          onCancelEdit={handleCancelEditComment}
          onUpdateComment={handleUpdateComment}
          onDeleteComment={handleDeleteComment}
          onEditingCommentBodyChange={setEditingCommentBody}
          onCommentBodyChange={setCommentBody}
          onSubmit={handleCreateComment}
          onApplyTemplate={handleApplyCommentTemplate}
        />
        {!user?.isAdmin ? (
          <ProposalCommentSection
            comments={comments}
            commentsLoading={commentsLoading}
            currentUserId={user?.id}
            isAdmin={user?.isAdmin ?? false}
            commentBody={commentBody}
            commentSubmitting={commentSubmitting}
            editingCommentId={editingCommentId}
            editingCommentBody={editingCommentBody}
            commentUpdatingId={commentUpdatingId}
            commentDeletingId={commentDeletingId}
            sticky
            hasStickyActions={hasStickyActions}
            onStartEdit={handleStartEditComment}
            onCancelEdit={handleCancelEditComment}
            onUpdateComment={handleUpdateComment}
            onDeleteComment={handleDeleteComment}
            onEditingCommentBodyChange={setEditingCommentBody}
            onCommentBodyChange={setCommentBody}
            onSubmit={handleCreateComment}
            onApplyTemplate={handleApplyCommentTemplate}
          />
        ) : null}
        {(hasStickyActions || !user?.isAdmin) && <div className="sticky-footer-gap" />}
      </ScrollArea>
      <ProposalMobileStickyActions
        hasStickyActions={hasStickyActions}
        canAccept={canAccept}
        canReject={canReject}
        canComplete={canComplete}
        onAccept={() => setPendingAction('accept')}
        onReject={() => setPendingAction('reject')}
        onComplete={() => setPendingAction('complete')}
      />
    </>
  );

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

      <AppResponsiveSwitch
        desktop={DesktopLayout}
        mobile={MobileLayout}
      />

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
