import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { useAsyncState } from '../../hooks/useAsyncState';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { api, isConflictError } from '../../api/client';
import type { ProposalComment } from '../../components/proposal/ProposalCommentSection';
import {
  compareProposalTemplates,
  createProposalTemplate,
  deleteProposalTemplate,
  listProposalTemplates,
  markProposalTemplateUsed,
  type ProposalTemplate,
} from '../../api/proposal-templates';
import { formatDateTimeJa } from '../../utils/formatters';
import type { ProposalDetail } from './types';
import { resolveProposalStatusMeta, optimisticNextStatus, resolveStatusLabel } from './helpers';

export function useProposalDetail() {
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
      setTemplates((prev) => [created, ...prev.filter((t) => t.id !== created.id)].sort(compareProposalTemplates));
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
      setTemplates((prev) => prev.filter((t) => t.id !== templateId));
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
      .catch(() => {});
  }, [setMessage]);

  // --- Derived state (only valid when data is loaded) ---

  const proposal = data?.proposal;
  const statusMeta = proposal ? resolveProposalStatusMeta(proposal, user?.id) : null;
  const isA = proposal ? proposal.pharmacyAId === user?.id : false;
  const statusLabel = proposal ? resolveStatusLabel(proposal.status) : '';
  const otherPharmacy = data && proposal
    ? (proposal.pharmacyAId === user?.id ? data.pharmacyB : data.pharmacyA)
    : null;
  const hasStickyActions = statusMeta ? (statusMeta.canAccept || statusMeta.canReject || statusMeta.canComplete) : false;
  const canSaveTemplate = !user?.isAdmin && proposal?.status === 'completed';

  // --- Action handlers ---

  const handleAction = async () => {
    if (!pendingAction || !data) return;
    setError('');
    setMessage('');
    setActionSubmitting(true);

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
    if (!commentBody.trim()) { setError('コメント本文を入力してください'); return; }
    setCommentSubmitting(true);
    setError('');
    try {
      await api.post(`/exchange/proposals/${id}/comments`, { body: commentBody.trim() });
      setCommentBody('');
      setMessage('コメントを投稿しました');
      await fetchComments();
    } catch (err) { setError(err instanceof Error ? err.message : 'コメント投稿に失敗しました'); }
    finally { setCommentSubmitting(false); }
  };

  const handleStartEditComment = (comment: ProposalComment) => {
    setError(''); setMessage(''); setEditingCommentId(comment.id); setEditingCommentBody(comment.body);
  };
  const handleCancelEditComment = () => { setEditingCommentId(null); setEditingCommentBody(''); };

  const handleUpdateComment = async (commentId: number) => {
    const nextBody = editingCommentBody.trim();
    if (!nextBody) { setError('コメント本文を入力してください'); return; }
    setCommentUpdatingId(commentId);
    setError('');
    try {
      await api.patch(`/exchange/proposals/${id}/comments/${commentId}`, { body: nextBody });
      setMessage('コメントを更新しました');
      setEditingCommentId(null); setEditingCommentBody('');
      await fetchComments();
    } catch (err) { setError(err instanceof Error ? err.message : 'コメント更新に失敗しました'); }
    finally { setCommentUpdatingId(null); }
  };

  const handleDeleteComment = async (commentId: number) => {
    if (!window.confirm('このコメントを削除してよろしいですか？')) return;
    setCommentDeletingId(commentId);
    setError('');
    try {
      await api.delete(`/exchange/proposals/${id}/comments/${commentId}`);
      setMessage('コメントを削除しました');
      if (editingCommentId === commentId) { setEditingCommentId(null); setEditingCommentBody(''); }
      await fetchComments();
    } catch (err) { setError(err instanceof Error ? err.message : 'コメント削除に失敗しました'); }
    finally { setCommentDeletingId(null); }
  };

  const handleSubmitFeedback = async () => {
    setFeedbackSubmitting(true);
    setError('');
    try {
      await api.post(`/exchange/proposals/${id}/feedback`, { rating: Number(feedbackRating), comment: feedbackComment.trim() || null });
      setMessage('取引評価を登録しました');
      setFeedbackComment('');
    } catch (err) { setError(err instanceof Error ? err.message : '取引評価の登録に失敗しました'); }
    finally { setFeedbackSubmitting(false); }
  };

  return {
    id,
    user,
    data,
    loading,
    error,
    message,
    fetchDetail,

    // Proposal derived state
    proposal: data?.proposal ?? null,
    pharmacyA: data?.pharmacyA ?? null,
    pharmacyB: data?.pharmacyB ?? null,
    otherPharmacy,
    statusMeta,
    statusLabel,
    isA,
    hasStickyActions,
    canSaveTemplate,
    itemsAtoB,
    itemsBtoA,

    // Action modal
    pendingAction,
    setPendingAction,
    actionSubmitting,
    handleAction,

    // Comments
    comments,
    commentsLoading,
    commentBody,
    setCommentBody,
    commentSubmitting,
    editingCommentId,
    editingCommentBody,
    setEditingCommentBody,
    commentUpdatingId,
    commentDeletingId,
    handleCreateComment,
    handleStartEditComment,
    handleCancelEditComment,
    handleUpdateComment,
    handleDeleteComment,
    handleApplyCommentTemplate,

    // Feedback
    feedbackRating,
    setFeedbackRating,
    feedbackComment,
    setFeedbackComment,
    feedbackSubmitting,
    handleSubmitFeedback,

    // Templates
    templates,
    templatesLoading,
    templateError,
    deletingTemplateId,
    templateName,
    setTemplateName,
    templateSaving,
    handleCreateTemplate,
    handleDeleteTemplate,
    handleUseTemplate,
    buildTemplateMatchingPath,

    // Mobile timeline
    mobileTimelineKey,
    setMobileTimelineKey,
  };
}
