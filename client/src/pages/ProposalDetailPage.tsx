import { useState, useEffect, useCallback, useMemo } from 'react';
import { Row, Col, Accordion } from 'react-bootstrap';
import { useParams, Link, useLocation } from 'react-router-dom';
import { useAsyncState } from '../hooks/useAsyncState';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { api, isConflictError } from '../api/client';
import AppAlert from '../components/ui/AppAlert';
import ErrorRetryAlert from '../components/ui/ErrorRetryAlert';
import PageLoader from '../components/ui/PageLoader';
import AppDataPanel from '../components/ui/AppDataPanel';
import LoadingButton from '../components/ui/LoadingButton';
import ProposalItemsPanel from '../components/ProposalItemsPanel';
import ProposalTimeline from '../components/timeline/ProposalTimeline';
import PageShell, { ScrollArea } from '../components/ui/PageShell';
import AppResponsiveSwitch from '../components/ui/AppResponsiveSwitch';
import ConfirmActionModal from '../components/ConfirmActionModal';
import { ProposalProgressIndicator } from '../components/proposal/ProposalProgressIndicator';
import { ProposalFeedbackSection } from '../components/proposal/ProposalFeedbackSection';
import { ProposalCommentSection, type ProposalComment } from '../components/proposal/ProposalCommentSection';
import { ProposalActionButtons, ProposalMobileStickyActions } from '../components/proposal/ProposalActions';
import ProposalTemplatePanel from '../components/proposal/ProposalTemplatePanel';
import {
  compareProposalTemplates,
  createProposalTemplate,
  deleteProposalTemplate,
  listProposalTemplates,
  markProposalTemplateUsed,
  type ProposalTemplate,
} from '../api/proposal-templates';
import type { EnrichedProposalTimelineEvent } from '../types/timeline';
import { formatDateTimeJa } from '../utils/formatters';
import {
  getProposalDeadlineMeta,
  resolveProposalDeadline,
} from '../utils/proposal-expiry';
import { getProposalWaitingInfo } from '../utils/proposal-status';
import { buildMessagesPath } from '../utils/message-links';

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
    expiresAt?: string | null;
    expiryReminderSentAt?: string | null;
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

/** アクションと現在ステータスから楽観的更新後のステータスを算出する。変換不能な場合は null を返す。 */
function optimisticNextStatus(
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

function buildProposalMessageDraft(proposalId: number, otherName: string): string {
  return `提案 #${proposalId} の内容確認ありがとうございます。${otherName}との交換条件についてメッセージで調整したいです。`;
}

export default function ProposalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { showError: showToastError } = useToast();
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
  const [templates, setTemplates] = useState<ProposalTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateError, setTemplateError] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [templateSaving, setTemplateSaving] = useState(false);
  const [deletingTemplateId, setDeletingTemplateId] = useState<number | null>(null);

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

  const fetchTemplates = useCallback(async () => {
    if (user?.isAdmin) {
      setTemplates([]);
      return;
    }

    setTemplatesLoading(true);
    setTemplateError('');
    try {
      const nextTemplates = await listProposalTemplates();
      setTemplates(nextTemplates.sort(compareProposalTemplates));
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : 'テンプレート一覧の取得に失敗しました');
    } finally {
      setTemplatesLoading(false);
    }
  }, [user?.isAdmin]);

  useEffect(() => {
    void fetchDetail();
    void fetchComments();
    void fetchTemplates();
  }, [fetchComments, fetchDetail, fetchTemplates]);

  useEffect(() => {
    if (!data) return;
    if (location.hash !== '#proposal-timeline' && location.hash !== '#timeline') return;

    const timelineSection = document.getElementById('proposal-timeline');
    if (!timelineSection || typeof timelineSection.scrollIntoView !== 'function') return;
    timelineSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [data, location.hash]);

  useEffect(() => {
    if (!data || user?.isAdmin) return;
    const otherName = data.proposal.pharmacyAId === user?.id ? data.pharmacyB.name : data.pharmacyA.name;
    const proposedDate = data.proposal.proposedAt ? formatDateTimeJa(data.proposal.proposedAt, '') : '';
    const nextName = proposedDate
      ? `${otherName}向け提案 ${proposedDate}`
      : `${otherName}向け提案`;
    setTemplateName((current) => (current.trim().length > 0 ? current : nextName));
  }, [data, user?.id, user?.isAdmin]);

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

  const buildTemplateMatchingPath = useCallback((template: ProposalTemplate) => {
    const params = new URLSearchParams();
    params.set('targetPharmacyId', String(template.targetPharmacyId));
    const itemTerms = template.items
      .map((item) => item.drugName.trim())
      .filter(Boolean)
      .slice(0, 5);
    if (itemTerms.length > 0) {
      params.set('inventorySearchDrugs', itemTerms.join('/'));
    }
    return `/matching?${params.toString()}`;
  }, []);

  const handleCreateTemplate = useCallback(async () => {
    if (!id) return;
    const normalizedName = templateName.trim();
    if (!normalizedName) {
      setTemplateError('テンプレート名を入力してください');
      return;
    }

    setTemplateSaving(true);
    setTemplateError('');
    try {
      const created = await createProposalTemplate(Number(id), normalizedName);
      setTemplates((prev) => [created, ...prev.filter((template) => template.id !== created.id)].sort(compareProposalTemplates));
      setMessage('提案テンプレートを保存しました');
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : 'テンプレートの保存に失敗しました');
    } finally {
      setTemplateSaving(false);
    }
  }, [id, templateName, setMessage]);

  const handleDeleteTemplate = useCallback(async (templateId: number) => {
    setDeletingTemplateId(templateId);
    setTemplateError('');
    try {
      await deleteProposalTemplate(templateId);
      setTemplates((prev) => prev.filter((template) => template.id !== templateId));
    } catch (err) {
      setTemplateError(err instanceof Error ? err.message : 'テンプレートの削除に失敗しました');
    } finally {
      setDeletingTemplateId(null);
    }
  }, []);

  const handleUseTemplate = useCallback((template: ProposalTemplate) => {
    setMessage(`テンプレート「${template.name}」の条件で候補を確認します。`);
    void markProposalTemplateUsed(template.id)
      .then((updatedTemplate) => {
        setTemplates((prev) => prev
          .map((current) => (current.id === updatedTemplate.id ? updatedTemplate : current))
          .sort(compareProposalTemplates));
      })
      .catch(() => {
        // Do not block navigation when usage counter bookkeeping fails.
      });
  }, [setMessage]);

  if (loading && !data) return <PageLoader />;
  if (!data) {
    return (
      <PageShell>
        <div className="dl-page-header">
          <div className="dl-page-header-copy">
            <h4 className="page-title mb-0">提案詳細</h4>
            <div className="text-muted small">提案詳細を開けない場合でも、一覧や履歴から近い流れへ戻れます。</div>
          </div>
          <div className="dl-page-header-actions d-flex gap-2 flex-wrap">
            <Link to="/proposals" className="btn btn-outline-secondary btn-sm">マッチング一覧</Link>
            <Link to="/exchange-history" className="btn btn-outline-secondary btn-sm">交換履歴</Link>
          </div>
        </div>
        <ErrorRetryAlert error={error || 'マッチング詳細を取得できませんでした。'} onRetry={() => void fetchDetail()} />
      </PageShell>
    );
  }

  const proposal = data.proposal;
  const { pharmacyA, pharmacyB } = data;
  const otherPharmacy = proposal.pharmacyAId === user?.id ? pharmacyB : pharmacyA;
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
    if (!pendingAction || !data) return;
    setError('');
    setMessage('');
    setActionSubmitting(true);

    // 楽観的更新: API コール前にステータスを即座に反映する
    const previousStatus = data.proposal.status;
    const isA = data.proposal.pharmacyAId === user?.id;
    const nextStatus = optimisticNextStatus(pendingAction, previousStatus, isA);
    if (nextStatus !== null) {
      setData((prev) => prev ? { ...prev, proposal: { ...prev.proposal, status: nextStatus } } : prev);
    }
    setPendingAction(null);

    try {
      const result = await api.post<{ message: string }>(`/exchange/proposals/${id}/${pendingAction}`);
      setMessage(result.message);
      await Promise.all([fetchDetail(), fetchComments()]);
    } catch (err) {
      // rollback: 楽観的更新を元のステータスに戻す
      setData((prev) => prev ? { ...prev, proposal: { ...prev.proposal, status: previousStatus } } : prev);
      if (isConflictError(err)) {
        showToastError('他のユーザーが先に操作しました。画面を更新します');
        void fetchDetail();
      } else {
        const errorMessage = err instanceof Error ? err.message : '操作に失敗しました';
        showToastError(errorMessage);
        setError(errorMessage);
      }
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
  const proposalDeadline = resolveProposalDeadline({
    proposedAt: proposal.proposedAt,
    expiresAt: proposal.expiresAt,
    status: proposal.status,
  });
  const proposalDeadlineMeta = getProposalDeadlineMeta(proposalDeadline);
  const canSaveTemplate = !user?.isAdmin && proposal.status === 'completed';
  const deadlineDescription = proposalDeadline
    ? '提案期限までに承認または拒否を行ってください。期限を過ぎると自動で失効します。'
    : 'このステータスでは提案期限のカウントダウン対象外です。';
  const reminderDescription = proposal.expiryReminderSentAt
    ? `24時間前リマインド送信済み: ${formatDateTimeJa(proposal.expiryReminderSentAt)}`
    : null;
  const waitingInfo = getProposalWaitingInfo(
    proposal.status,
    proposal.pharmacyAId === user?.id,
    pharmacyA.name,
    pharmacyB.name,
  );

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

  const ProposalDeadlineSection = () => (
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

  const ProposalWorkflowSection = () => (
    <AppDataPanel title="印刷と次の操作" className="mb-3" bodyClassName="small">
      <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap">
        <div>
          <div className="fw-semibold">FAX 確認と承認状況の往復をここから進めます。</div>
          <div className="text-muted">
            印刷用ページで様式を開き、送付後はメッセージ確認か進行履歴の確認へ戻ってください。
          </div>
        </div>
        <div className="d-flex gap-2 flex-wrap">
          <Link to={`/proposals/${id}/print`} className="btn btn-outline-secondary btn-sm" target="_blank" rel="noopener noreferrer">
            印刷用ページを開く
          </Link>
          <a href="#proposal-timeline" className="btn btn-outline-secondary btn-sm">
            進行履歴へ
          </a>
        </div>
      </div>
    </AppDataPanel>
  );

  const ProposalTemplatesSection = () => (
    <ProposalTemplatePanel
      title="提案テンプレート"
      templates={templates}
      loading={templatesLoading}
      error={templateError}
      deletingTemplateId={deletingTemplateId}
      onDelete={handleDeleteTemplate}
      buildUseTo={buildTemplateMatchingPath}
      onUse={handleUseTemplate}
      actions={canSaveTemplate ? (
        <div className="d-flex gap-2 flex-wrap">
          <input
            value={templateName}
            onChange={(event) => setTemplateName(event.target.value)}
            className="form-control form-control-sm"
            style={{ minWidth: 220 }}
            placeholder="テンプレート名"
            maxLength={100}
          />
          <LoadingButton
            type="button"
            size="sm"
            variant="primary"
            loading={templateSaving}
            loadingLabel="保存中..."
            onClick={handleCreateTemplate}
          >
            この提案を保存
          </LoadingButton>
        </div>
      ) : null}
      emptyMessage={canSaveTemplate
        ? '完了済み提案をテンプレートとして保存すると、次回の候補検索に再利用できます。'
        : '保存済みテンプレートはありません。完了済み提案から保存できます。'}
    />
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
      {ProposalDeadlineSection()}
      {ProposalWorkflowSection()}
      {!user?.isAdmin ? (
        <AppDataPanel title="相手薬局との連絡" className="mb-3" bodyClassName="small d-flex justify-content-between align-items-center gap-3 flex-wrap">
          <div>
            <div className="fw-semibold">{otherPharmacy.name}</div>
            <div className="text-muted">提案内容のすり合わせやFAX送信前の確認に使えます。</div>
          </div>
          <Link
            to={buildMessagesPath({
              pharmacyId: otherPharmacy.id,
              pharmacyName: otherPharmacy.name,
              draft: buildProposalMessageDraft(proposal.id, otherPharmacy.name),
              context: 'proposal',
              contextId: proposal.id,
            })}
            className="btn btn-outline-primary btn-sm"
          >
            メッセージを開く
          </Link>
        </AppDataPanel>
      ) : null}
      {!user?.isAdmin && ProposalTemplatesSection()}
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
        {ProposalDeadlineSection()}
        {ProposalWorkflowSection()}
        {!user?.isAdmin ? (
          <AppDataPanel title="相手薬局との連絡" className="mb-3" bodyClassName="small">
            <div className="d-flex justify-content-between align-items-center gap-3 flex-wrap">
              <div>
                <div className="fw-semibold">{otherPharmacy.name}</div>
                <div className="text-muted">提案内容のすり合わせやFAX送信前の確認に使えます。</div>
              </div>
              <Link
                to={buildMessagesPath({
                  pharmacyId: otherPharmacy.id,
                  pharmacyName: otherPharmacy.name,
                  draft: buildProposalMessageDraft(proposal.id, otherPharmacy.name),
                  context: 'proposal',
                  contextId: proposal.id,
                })}
                className="btn btn-outline-primary btn-sm"
              >
                メッセージを開く
              </Link>
            </div>
          </AppDataPanel>
        ) : null}
        {!user?.isAdmin && ProposalTemplatesSection()}
        {MobileTimelineAccordion()}

        {/* 概要 — デフォルト展開 */}
        <Accordion defaultActiveKey="summary" className="mb-3">
          <Accordion.Item eventKey="summary">
            <Accordion.Header>概要（薬局情報・ステータス・総額）</Accordion.Header>
            <Accordion.Body className="p-2">
              {PharmacyInfoSection()}
              {ExchangeInstructions()}
              <div className="small text-muted mt-2">
                <span className="me-3">A→B 合計: ¥{proposal.totalValueA.toLocaleString()}</span>
                <span>B→A 合計: ¥{proposal.totalValueB.toLocaleString()}</span>
              </div>
            </Accordion.Body>
          </Accordion.Item>
        </Accordion>

        {/* アイテム — デフォルト閉じ */}
        <Accordion className="mb-3">
          <Accordion.Item eventKey="items">
            <Accordion.Header>アイテム（{pharmacyA.name} ↔ {pharmacyB.name}）</Accordion.Header>
            <Accordion.Body className="p-2">
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
            </Accordion.Body>
          </Accordion.Item>
        </Accordion>

        {/* コメント・フィードバック — デフォルト閉じ */}
        <Accordion className="mb-3">
          <Accordion.Item eventKey="comments">
            <Accordion.Header>コメント・フィードバック</Accordion.Header>
            <Accordion.Body className="p-2">
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
            </Accordion.Body>
          </Accordion.Item>
        </Accordion>

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
        <div style={{ paddingBottom: '80px' }} />
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
      <div className="dl-page-header">
        <div className="dl-page-header-copy">
          <h4 className="page-title mb-0">マッチング #{proposal.id}</h4>
          <div className="text-muted small">提案詳細、タイムライン、コメント、相手薬局との連絡をここで確認します。</div>
        </div>
        <div className="dl-page-header-actions d-flex gap-2 flex-wrap">
          <Link
            to={buildMessagesPath({
              pharmacyId: otherPharmacy.id,
              pharmacyName: otherPharmacy.name,
              context: 'proposal',
              contextId: proposal.id,
            })}
            className="btn btn-outline-primary btn-sm"
          >
            相手にメッセージ
          </Link>
          <Link to="/proposals" className="btn btn-outline-secondary btn-sm">マッチング一覧</Link>
          <Link to="/exchange-history" className="btn btn-outline-secondary btn-sm">交換履歴</Link>
          <Link to={`/proposals/${id}/print`} className="btn btn-outline-secondary btn-sm" target="_blank" rel="noopener noreferrer">
            印刷用ページ
          </Link>
        </div>
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
