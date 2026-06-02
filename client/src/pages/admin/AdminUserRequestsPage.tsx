import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Badge, Form } from 'react-bootstrap';
import { api, buildApiUrl } from '../../api/client';
import Pagination from '../../components/Pagination';
import AppAlert from '../../components/ui/AppAlert';
import AttachmentPreviewList from '../../components/ui/AttachmentPreviewList';
import AppCard from '../../components/ui/AppCard';
import AppDropdownMenu from '../../components/ui/AppDropdownMenu';
import AppEmptyState from '../../components/ui/AppEmptyState';
import ErrorRetryAlert from '../../components/ui/ErrorRetryAlert';
import InlineLoader from '../../components/ui/InlineLoader';
import LoadingButton from '../../components/ui/LoadingButton';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';
import SavedViewsPanel from '../../components/ui/SavedViewsPanel';
import WorkContextBar from '../../components/ui/WorkContextBar';
import { useListDetailRouteState } from '../../hooks/useListDetailRouteState';
import { useKeyboardListNavigation } from '../../hooks/useKeyboardListNavigation';
import { useSavedViews } from '../../hooks/useSavedViews';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { useSseRefresh } from '../../hooks/useSseRefresh';
import { useTrackRecentWork } from '../../hooks/useRecentWork';
import { useToast } from '../../contexts/ToastContext';
import { formatDateTimeJa } from '../../utils/formatters';
import { Link, useSearchParams } from 'react-router-dom';
import AdminNavigationLinks, { type AdminNavigationLinkGroup } from './components/AdminNavigationLinks';
import { type AdminQueueFilter, useAdminUserRequestsQueue } from './useAdminUserRequestsQueue';
import { getRequestSlaSummary } from '../../utils/request-sla';
import { addStoredTemplate, loadStoredTemplates, persistStoredTemplates, removeStoredTemplate } from '../../utils/text-template-store';

const LIVE_REFRESH_INTERVAL_MS = 60_000;
const ADMIN_REQUESTS_SAVED_VIEWS_KEY = 'admin-user-requests:saved-views';
const ADMIN_REQUESTS_REPLY_TEMPLATES_KEY = 'admin-user-requests:reply-templates';

const REPLY_TEMPLATES = [
  '追加情報ありがとうございます。内容を確認して進めます。',
  '再現条件を確認したいので、もう少し詳しい状況を教えてください。',
  '対応方針が固まり次第、こちらに進捗を追記します。',
] as const;

interface AdminUserRequestItem {
  id: number;
  pharmacyId: number;
  pharmacyName: string | null;
  requestText: string;
  category: string;
  priority: string;
  closeReason: string | null;
  openclawStatus: string;
  openclawThreadId: string | null;
  openclawSummary: string | null;
  workflowStatus: string | null;
  latestSummary: string | null;
  branchName: string | null;
  prUrl: string | null;
  prNumber: number | null;
  assignedAdminId: number | null;
  assignedAdminName: string | null;
  requesterLastViewedAt: string | null;
  adminLastViewedAt: string | null;
  latestUserMessageAt: string | null;
  latestStaffMessageAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  hasUnread: boolean;
  waitingOn: 'user' | 'admin' | 'openclaw' | null;
  isOverdue: boolean;
  latestEscalatedAt: string | null;
}

interface AdminUserRequestsResponse {
  data: AdminUserRequestItem[];
  pagination: { page: number; totalPages: number; total: number };
}

interface AdminUserRequestDetailResponse {
  request: AdminUserRequestItem & {
    lastQuestion?: string | null;
    lastError?: string | null;
  };
  messages: Array<{
    id: number;
    authorType: 'user' | 'openclaw_agent' | 'system' | 'admin';
    messageType: string;
    body: string;
    createdAt: string | null;
    attachments: Array<{
      id: number;
      fileName: string;
      mimeType: string;
      fileSize: number;
    }>;
  }>;
  notes: Array<{
    id: number;
    body: string;
    createdAt: string | null;
    authorAdminName: string | null;
  }>;
  events: Array<{
    id: number;
    eventType: string;
    createdAt: string | null;
    summary: string | null;
    note: string | null;
  }>;
}

function categoryLabel(category: string): string {
  switch (category) {
    case 'bug_report':
      return '不具合';
    case 'question':
      return '質問';
    case 'master_update':
      return 'マスター更新';
    case 'integration_issue':
      return '連携不具合';
    case 'improvement':
    default:
      return '改善要望';
  }
}

function priorityBadge(priority: string) {
  if (priority === 'urgent') {
    return <Badge bg="danger">緊急</Badge>;
  }
  if (priority === 'low') {
    return <Badge bg="secondary">低</Badge>;
  }
  return <Badge bg="info">通常</Badge>;
}

function workflowBadge(status: string | null) {
  switch (status) {
    case 'awaiting_user':
      return <Badge bg="primary">回答待ち</Badge>;
    case 'implementing':
      return <Badge bg="warning" text="dark">実装中</Badge>;
    case 'pr_opened':
      return <Badge bg="warning" text="dark">PR作成済み</Badge>;
    case 'completed':
      return <Badge bg="success">完了</Badge>;
    case 'failed':
      return <Badge bg="danger">失敗</Badge>;
    case 'analyzing':
      return <Badge bg="secondary">解析中</Badge>;
    case 'queued':
    default:
      return <Badge bg="secondary">受付済み</Badge>;
  }
}

function closeReasonLabel(reason: string | null): string | null {
  switch (reason) {
    case 'completed':
      return '完了';
    case 'duplicate':
      return '重複';
    case 'rejected':
      return '却下';
    case 'cannot_reproduce':
      return '再現不可';
    case 'on_hold':
      return '保留';
    default:
      return null;
  }
}

function waitingBadge(item: Pick<AdminUserRequestItem, 'waitingOn' | 'isOverdue'>) {
  if (item.isOverdue) {
    return <Badge bg="warning" text="dark">24時間超</Badge>;
  }
  if (item.waitingOn === 'user') {
    return <Badge bg="primary">ユーザー待ち</Badge>;
  }
  if (item.waitingOn === 'admin') {
    return <Badge bg="danger">管理者待ち</Badge>;
  }
  if (item.waitingOn === 'openclaw') {
    return <Badge bg="dark">OpenClaw処理中</Badge>;
  }
  return null;
}

function authorLabel(authorType: string): string {
  if (authorType === 'openclaw_agent') return 'DSS Manager';
  if (authorType === 'admin') return 'Admin';
  if (authorType === 'system') return 'System';
  return 'ユーザー';
}

const USER_REQUEST_LINK_GROUPS: readonly AdminNavigationLinkGroup[] = [
  {
    title: '連携・実装',
    description: 'OpenClaw と内部運用を行き来する近接導線です。',
    links: [
      { to: '/admin/openclaw', label: 'OpenClaw連携' },
      { to: '/admin/openclaw-commands', label: 'コマンド管理' },
      { to: '/admin/log-center', label: 'ログセンター' },
    ],
  },
  {
    title: '周辺運用',
    description: '通知異常や薬局運用の確認へ移れます。',
    links: [
      { to: '/admin/notifications', label: '通知・配信状況' },
      { to: '/admin/pharmacies', label: '薬局管理' },
      { to: '/admin/audit', label: '監査ログ' },
    ],
  },
] as const;

interface AdminUserRequestSavedFilters {
  search: string;
  statusFilter: string;
  categoryFilter: string;
  priorityFilter: string;
  waitingOnFilter: string;
  onlyUnread: boolean;
  queueFilter: string;
}

export default function AdminUserRequestsPage() {
  const { showSuccess } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    requestedSelectedValue: requestedRequestValue,
    requestedPage,
  } = useListDetailRouteState(searchParams, setSearchParams, { selectedParam: 'requestId' });
  const requestedSearch = searchParams.get('search') ?? '';
  const requestedStatusFilter = searchParams.get('status') ?? '';
  const requestedCategoryFilter = searchParams.get('category') ?? '';
  const requestedPriorityFilter = searchParams.get('priority') ?? '';
  const requestedWaitingOnFilter = searchParams.get('waitingOn') ?? '';
  const requestedOnlyUnread = searchParams.get('onlyUnread') === '1';
  const requestedQueueFilter = (searchParams.get('queue') as AdminQueueFilter | null) ?? 'all';
  const requestedRequestId = Number(requestedRequestValue ?? '');
  const [searchInput, setSearchInput] = useState(requestedSearch);
  const [search, setSearch] = useState(requestedSearch.trim());
  const [statusFilter, setStatusFilter] = useState(requestedStatusFilter);
  const [categoryFilter, setCategoryFilter] = useState(requestedCategoryFilter);
  const [priorityFilter, setPriorityFilter] = useState(requestedPriorityFilter);
  const [waitingOnFilter, setWaitingOnFilter] = useState(requestedWaitingOnFilter);
  const [onlyUnread, setOnlyUnread] = useState(requestedOnlyUnread);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(
    Number.isInteger(requestedRequestId) && requestedRequestId > 0 ? requestedRequestId : null,
  );
  const [assignees, setAssignees] = useState<Array<{ id: number; name: string }>>([]);
  const [detail, setDetail] = useState<AdminUserRequestDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');
  const [bulkPreview, setBulkPreview] = useState<null | {
    count: number;
    updates: string[];
    sample: Array<{ id: number; pharmacyName: string | null; requestText: string }>;
    diffs: Array<{
      id: number;
      category: { from: string | null; to: string | null };
      priority: { from: string | null; to: string | null };
      assignedAdminId: { from: number | null; to: number | null };
      closeReason: { from: string | null; to: string | null };
    }>;
  }>(null);
  const [savingMeta, setSavingMeta] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const [noteText, setNoteText] = useState('');
  const [meta, setMeta] = useState({
    category: 'improvement',
    priority: 'normal',
    assignedAdminId: '',
    closeReason: '',
  });
  const {
    savedViews,
    createSavedView,
    deleteSavedView,
  } = useSavedViews<AdminUserRequestSavedFilters>(ADMIN_REQUESTS_SAVED_VIEWS_KEY);
  const [savedReplyTemplates, setSavedReplyTemplates] = useState<string[]>(() =>
    loadStoredTemplates(ADMIN_REQUESTS_REPLY_TEMPLATES_KEY));
  const filtersInitializedRef = useRef(false);

  const fetchUserRequestsPage = useCallback((targetPage: number, signal?: AbortSignal) => {
    const params = new URLSearchParams({
      page: String(targetPage),
      limit: '20',
    });
    if (search) params.set('search', search);
    if (statusFilter) params.set('status', statusFilter);
    if (categoryFilter) params.set('category', categoryFilter);
    if (priorityFilter) params.set('priority', priorityFilter);
    if (waitingOnFilter) params.set('waitingOn', waitingOnFilter);
    if (onlyUnread) params.set('onlyUnread', 'true');
    return api.get<AdminUserRequestsResponse>(`/admin/user-requests?${params}`, { signal });
  }, [categoryFilter, onlyUnread, priorityFilter, search, statusFilter, waitingOnFilter]);

  const {
    items,
    page,
    setPage,
    totalPages,
    loading,
    error,
    retry,
    fetchPage,
  } = usePaginatedList<AdminUserRequestItem, AdminUserRequestsResponse>(
    fetchUserRequestsPage,
    { errorMessage: 'ユーザーリクエストの取得に失敗しました', initialPage: requestedPage },
  );
  const {
    queueFilter,
    setQueueFilter,
    itemSummary,
    displayItems,
  } = useAdminUserRequestsQueue(items, requestedQueueFilter);
  const escalatedItems = items.filter((item) => item.latestEscalatedAt).slice(0, 5);

  useEffect(() => {
    persistStoredTemplates(ADMIN_REQUESTS_REPLY_TEMPLATES_KEY, savedReplyTemplates);
  }, [savedReplyTemplates]);

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams);
    if (search.trim()) nextParams.set('search', search.trim());
    else nextParams.delete('search');
    if (statusFilter) nextParams.set('status', statusFilter);
    else nextParams.delete('status');
    if (categoryFilter) nextParams.set('category', categoryFilter);
    else nextParams.delete('category');
    if (priorityFilter) nextParams.set('priority', priorityFilter);
    else nextParams.delete('priority');
    if (waitingOnFilter) nextParams.set('waitingOn', waitingOnFilter);
    else nextParams.delete('waitingOn');
    if (onlyUnread) nextParams.set('onlyUnread', '1');
    else nextParams.delete('onlyUnread');
    if (queueFilter !== 'all') nextParams.set('queue', queueFilter);
    else nextParams.delete('queue');
    if (selectedRequestId) nextParams.set('requestId', String(selectedRequestId));
    else nextParams.delete('requestId');
    if (page > 1) nextParams.set('page', String(page));
    else nextParams.delete('page');
    if (nextParams.toString() !== searchParams.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [
    categoryFilter,
    onlyUnread,
    page,
    priorityFilter,
    queueFilter,
    search,
    searchParams,
    selectedRequestId,
    setSearchParams,
    statusFilter,
    waitingOnFilter,
  ]);

  const loadRequestDetail = useCallback(async (
    requestId: number,
    options: { background?: boolean; signal?: AbortSignal } = {},
  ) => {
    const background = options.background ?? false;
    if (!background) {
      setDetailLoading(true);
      setDetailError('');
    }

    try {
      const response = await api.get<AdminUserRequestDetailResponse>(`/admin/user-requests/${requestId}`, { signal: options.signal });
      setDetailError('');
      setDetail(response);
      setMeta({
        category: response.request.category ?? 'improvement',
        priority: response.request.priority ?? 'normal',
        assignedAdminId: response.request.assignedAdminId ? String(response.request.assignedAdminId) : '',
        closeReason: response.request.closeReason ?? '',
      });
    } catch (err) {
      if (options.signal?.aborted) {
        return;
      }
      if (!background) {
        setDetailError(err instanceof Error ? err.message : '要望詳細の取得に失敗しました');
      }
    } finally {
      if (!options.signal?.aborted && !background) {
        setDetailLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void api.get<{ data: Array<{ id: number; name: string }> }>('/admin/user-requests/assignees')
      .then((response) => setAssignees(response.data))
      .catch(() => setAssignees([]));
  }, []);

  useEffect(() => {
    if (displayItems.length === 0) {
      setSelectedRequestId(null);
      setDetail(null);
      return;
    }
    if (selectedRequestId && displayItems.some((item) => item.id === selectedRequestId)) {
      return;
    }
    setSelectedRequestId(displayItems[0].id);
  }, [displayItems, selectedRequestId]);

  useEffect(() => {
    if (!selectedRequestId) {
      setDetail(null);
      return;
    }

    const controller = new AbortController();
    void loadRequestDetail(selectedRequestId, { signal: controller.signal });

    return () => controller.abort();
  }, [loadRequestDetail, selectedRequestId]);

  useEffect(() => {
    if (!filtersInitializedRef.current) {
      filtersInitializedRef.current = true;
      return;
    }

    if (page === 1) {
      void fetchPage(1, { force: true });
      return;
    }

    setPage(1);
  }, [categoryFilter, fetchPage, onlyUnread, page, priorityFilter, setPage, statusFilter, waitingOnFilter]);

  useEffect(() => {
    setBulkPreview(null);
  }, [meta, selectedIds]);

  const refreshListAndDetail = async (options: { background?: boolean } = {}) => {
    await fetchPage(page, { force: true });
    if (selectedRequestId) {
      await loadRequestDetail(selectedRequestId, { background: options.background });
    }
  };

  const { connected: realtimeConnected } = useSseRefresh({
    enabled: true,
    streamPath: '/realtime/stream?topics=admin_requests',
    events: ['admin_requests.refresh'],
    onRefresh: async () => {
      await refreshListAndDetail({ background: true });
    },
    fallbackIntervalMs: LIVE_REFRESH_INTERVAL_MS,
    minFetchIntervalMs: 4_000,
  });

  const handleSaveMeta = async () => {
    if (!selectedRequestId) return;
    const previousMeta = detail ? {
      category: detail.request.category,
      priority: detail.request.priority,
      assignedAdminId: detail.request.assignedAdminId,
      closeReason: detail.request.closeReason,
    } : null;
    setSavingMeta(true);
    setActionError('');
    setActionMessage('');
    try {
      await api.patch(`/admin/user-requests/${selectedRequestId}`, {
        category: meta.category,
        priority: meta.priority,
        assignedAdminId: meta.assignedAdminId ? Number(meta.assignedAdminId) : null,
        closeReason: meta.closeReason || null,
      });
      setActionMessage('要望の管理情報を更新しました');
      if (previousMeta) {
        showSuccess('要望の管理情報を更新しました', {
          actionLabel: '元に戻す',
          onAction: async () => {
            await api.patch(`/admin/user-requests/${selectedRequestId}`, previousMeta);
            await refreshListAndDetail();
          },
          autoDismissMs: 5000,
        });
      }
      await refreshListAndDetail();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '要望の更新に失敗しました');
    } finally {
      setSavingMeta(false);
    }
  };

  const handleBulkSaveMeta = async () => {
    if (selectedIds.length === 0) return;
    setSavingMeta(true);
    setActionError('');
    setActionMessage('');
    try {
      const result = await api.post<{ message: string }>('/admin/user-requests/bulk-update', {
        ids: selectedIds,
        category: meta.category,
        priority: meta.priority,
        assignedAdminId: meta.assignedAdminId ? Number(meta.assignedAdminId) : null,
        closeReason: meta.closeReason || null,
      });
      setActionMessage(result.message);
      setSelectedIds([]);
      await refreshListAndDetail();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '要望の一括更新に失敗しました');
    } finally {
      setSavingMeta(false);
    }
  };

  const handlePreviewBulkSaveMeta = async () => {
    if (selectedIds.length === 0) return;
    setActionError('');
    try {
      const preview = await api.post<{
        count: number;
        updates: string[];
        sample: Array<{ id: number; pharmacyName: string | null; requestText: string }>;
        diffs: Array<{
          id: number;
          category: { from: string | null; to: string | null };
          priority: { from: string | null; to: string | null };
          assignedAdminId: { from: number | null; to: number | null };
          closeReason: { from: string | null; to: string | null };
        }>;
      }>('/admin/user-requests/bulk-preview', {
        ids: selectedIds,
        category: meta.category,
        priority: meta.priority,
        assignedAdminId: meta.assignedAdminId ? Number(meta.assignedAdminId) : null,
        closeReason: meta.closeReason || null,
      });
      setBulkPreview(preview);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '要望の一括更新プレビューに失敗しました');
    }
  };

  const handleReply = async () => {
    if (!selectedRequestId) return;
    const trimmed = replyText.trim();
    if (!trimmed && replyFiles.length === 0) {
      setActionError('返信内容を入力してください');
      return;
    }
    setSendingReply(true);
    setActionError('');
    setActionMessage('');
    try {
      if (replyFiles.length > 0) {
        const formData = new FormData();
        formData.set('message', trimmed);
        replyFiles.forEach((file) => formData.append('files', file));
        await api.upload(`/admin/user-requests/${selectedRequestId}/messages`, formData);
      } else {
        await api.post(`/admin/user-requests/${selectedRequestId}/messages`, { message: trimmed });
      }
      setReplyText('');
      setReplyFiles([]);
      setActionMessage('管理者返信を送信しました');
      await refreshListAndDetail();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '管理者返信の送信に失敗しました');
    } finally {
      setSendingReply(false);
    }
  };

  const handleSaveNote = async () => {
    if (!selectedRequestId) return;
    const trimmed = noteText.trim();
    if (!trimmed) {
      setActionError('内部メモを入力してください');
      return;
    }
    setSavingNote(true);
    setActionError('');
    setActionMessage('');
    try {
      await api.post(`/admin/user-requests/${selectedRequestId}/internal-notes`, { body: trimmed });
      setNoteText('');
      setActionMessage('内部メモを保存しました');
      await refreshListAndDetail();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '内部メモの保存に失敗しました');
    } finally {
      setSavingNote(false);
    }
  };

  const attachmentUrl = (attachmentId: number) =>
    buildApiUrl(`/admin/user-requests/attachments/${attachmentId}`);

  const handleApplyFilters = () => {
    const nextSearch = searchInput.trim();
    if (search === nextSearch && page === 1) {
      void fetchPage(1, { force: true });
      return;
    }
    setSearch(nextSearch);
    setPage(1);
  };

  const handleReplyFilesChange = (event: ChangeEvent<HTMLInputElement>) => {
    setReplyFiles(Array.from(event.currentTarget.files ?? []));
  };

  const toggleSelectedId = (requestId: number) => {
    setSelectedIds((prev) => (prev.includes(requestId) ? prev.filter((id) => id !== requestId) : [...prev, requestId]));
  };

  const applyMetaPreset = (preset: 'urgent_bug' | 'duplicate' | 'on_hold') => {
    if (preset === 'urgent_bug') {
      setMeta((prev) => ({ ...prev, category: 'bug_report', priority: 'urgent', closeReason: '' }));
      return;
    }
    if (preset === 'duplicate') {
      setMeta((prev) => ({ ...prev, closeReason: 'duplicate' }));
      return;
    }
    setMeta((prev) => ({ ...prev, closeReason: 'on_hold' }));
  };

  const saveCurrentView = () => {
    const name = window.prompt('保存ビュー名を入力してください');
    if (!name) return;
    createSavedView(name, {
      search: searchInput,
      statusFilter,
      categoryFilter,
      priorityFilter,
      waitingOnFilter,
      onlyUnread,
      queueFilter,
    });
  };

  const applySavedView = (filters: AdminUserRequestSavedFilters) => {
    setSearchInput(filters.search);
    setSearch(filters.search.trim());
    setStatusFilter(filters.statusFilter);
    setCategoryFilter(filters.categoryFilter);
    setPriorityFilter(filters.priorityFilter);
    setWaitingOnFilter(filters.waitingOnFilter);
    setOnlyUnread(filters.onlyUnread);
    setQueueFilter((filters.queueFilter as typeof queueFilter) ?? 'all');
    setPage(1);
  };

  const saveCurrentReplyTemplate = () => {
    if (!replyText.trim()) return;
    setSavedReplyTemplates((prev) => addStoredTemplate(prev, replyText));
  };

  const replyTemplateMenuItems = useMemo(() => [
    ...REPLY_TEMPLATES.map((template, index) => ({
      key: `default-reply-${index}`,
      label: template,
      onClick: () => setReplyText(template),
    })),
    ...savedReplyTemplates.map((template, index) => ({
      key: `saved-reply-${index}`,
      label: `${template.slice(0, 28)}${template.length > 28 ? '…' : ''}`,
      onClick: () => setReplyText(template),
    })),
  ], [savedReplyTemplates]);

  const recentRequestWork = useMemo(() => {
    if (!detail?.request) return null;
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (statusFilter) params.set('status', statusFilter);
    if (categoryFilter) params.set('category', categoryFilter);
    if (priorityFilter) params.set('priority', priorityFilter);
    if (waitingOnFilter) params.set('waitingOn', waitingOnFilter);
    if (onlyUnread) params.set('onlyUnread', '1');
    if (queueFilter !== 'all') params.set('queue', queueFilter);
    params.set('requestId', String(detail.request.id));
    if (page > 1) params.set('page', String(page));
    return {
      id: `admin-request-${detail.request.id}`,
      label: `要望 #${detail.request.id}`,
      to: `/admin/user-requests?${params.toString()}`,
      section: 'ユーザーリクエスト',
      subtitle: detail.request.pharmacyName ?? detail.request.requestText,
    };
  }, [categoryFilter, detail, onlyUnread, page, priorityFilter, queueFilter, search, statusFilter, waitingOnFilter]);
  const queueFilterOptions: Array<{ value: AdminQueueFilter; label: string }> = [
    { value: 'all', label: `すべて ${items.length}` },
    { value: 'my_turn', label: `本日返答 ${itemSummary.myTurn}` },
    { value: 'overdue', label: `24時間超 ${itemSummary.overdue}` },
    { value: 'unread', label: `未読 ${itemSummary.unread}` },
    { value: 'openclaw', label: `OpenClaw ${itemSummary.openclaw}` },
    { value: 'escalated', label: `再催促 ${itemSummary.escalated ?? 0}` },
  ];

  useTrackRecentWork(recentRequestWork);
  useKeyboardListNavigation({
    ids: displayItems.map((item) => item.id),
    selectedId: selectedRequestId,
    setSelectedId: (id) => setSelectedRequestId(id),
    onEnter: (id) => setSelectedRequestId(id),
    searchTargetId: 'admin-user-requests-search',
  });

  return (
    <PageShell>
      <div className="dl-page-header">
        <div className="dl-page-header-copy">
          <h4 className="page-title mb-0">ユーザーリクエスト管理</h4>
          <div className="text-muted small">一覧・担当・内部メモ・返信を 1 画面で追える運用レイアウトです。</div>
        </div>
        <Badge bg={realtimeConnected ? 'success' : 'secondary'}>
          自動更新: {realtimeConnected ? '接続中' : 'ポーリング'}
        </Badge>
      </div>
      <WorkContextBar
        title={detail?.request ? `要望 #${detail.request.id} を処理中` : 'ユーザーリクエスト運用キュー'}
        currentLabel={detail?.request ? (detail.request.pharmacyName ?? `薬局ID:${detail.request.pharmacyId}`) : '一覧から対象を選ぶと詳細を右ペインで処理できます'}
        description="filter、queue、選択中案件を URL に保持するので、戻っても同じ状態から再開できます。"
        backTo="/admin"
        backLabel="管理ダッシュボードへ"
        badges={[
          { label: realtimeConnected ? '自動更新中' : 'ポーリング', bg: realtimeConnected ? 'success' : 'secondary' },
          { label: `queue: ${queueFilter}`, bg: queueFilter === 'escalated' ? 'warning' : 'secondary', text: queueFilter === 'escalated' ? 'dark' : undefined },
          selectedIds.length > 0 ? { label: `一括対象 ${selectedIds.length} 件`, bg: 'info', text: 'dark' } : null,
        ]}
        nextActions={[
          { to: '/admin/openclaw', label: 'OpenClaw 連携', variant: 'outline-secondary' },
          { to: '/admin/notifications', label: '通知・配信', variant: 'outline-secondary' },
          { to: '/admin/log-center', label: 'ログセンター', variant: 'outline-secondary' },
        ]}
      />
      {actionMessage && <AppAlert variant="success" dismissible onClose={() => setActionMessage('')}>{actionMessage}</AppAlert>}
      {actionError && <AppAlert variant="danger" dismissible onClose={() => setActionError('')}>{actionError}</AppAlert>}

      <AppCard className="mb-3">
        <AppCard.Header>絞り込み</AppCard.Header>
        <AppCard.Body>
          <SavedViewsPanel
            description="現在の絞り込みを保存ビューとして再利用できます。"
            savedViews={savedViews}
            presets={[
              {
                key: 'request-my-turn',
                name: '本日返答',
                description: '管理者待ちの要望に絞ります。',
                filters: {
                  search: '',
                  statusFilter: '',
                  categoryFilter: '',
                  priorityFilter: '',
                  waitingOnFilter: '',
                  onlyUnread: false,
                  queueFilter: 'my_turn',
                },
              },
              {
                key: 'request-escalated',
                name: '再催促対応',
                description: '再催促キューに絞ります。',
                filters: {
                  search: '',
                  statusFilter: '',
                  categoryFilter: '',
                  priorityFilter: '',
                  waitingOnFilter: '',
                  onlyUnread: false,
                  queueFilter: 'escalated',
                },
              },
              {
                key: 'request-openclaw',
                name: 'OpenClaw処理中',
                description: 'OpenClaw 待ち案件に絞ります。',
                filters: {
                  search: '',
                  statusFilter: '',
                  categoryFilter: '',
                  priorityFilter: '',
                  waitingOnFilter: '',
                  onlyUnread: false,
                  queueFilter: 'openclaw',
                },
              },
            ]}
            onSave={saveCurrentView}
            onApply={applySavedView}
            onDelete={deleteSavedView}
          />
          <div className="row g-2">
            <div className="col-12 col-md-4">
              <Form.Control
                id="admin-user-requests-search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="要望本文で検索"
              />
            </div>
            <div className="col-6 col-md-2">
              <Form.Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="">全ステータス</option>
                <option value="pending_handoff">連携待ち</option>
                <option value="in_dialogue">対話中</option>
                <option value="implementing">実装中</option>
                <option value="completed">完了</option>
              </Form.Select>
            </div>
            <div className="col-6 col-md-2">
              <Form.Select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                <option value="">全カテゴリ</option>
                <option value="improvement">改善要望</option>
                <option value="bug_report">不具合</option>
                <option value="question">質問</option>
                <option value="master_update">マスター更新</option>
                <option value="integration_issue">連携不具合</option>
              </Form.Select>
            </div>
            <div className="col-6 col-md-2">
              <Form.Select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
                <option value="">全優先度</option>
                <option value="urgent">緊急</option>
                <option value="normal">通常</option>
                <option value="low">低</option>
              </Form.Select>
            </div>
            <div className="col-6 col-md-2">
              <Form.Select value={waitingOnFilter} onChange={(event) => setWaitingOnFilter(event.target.value)}>
                <option value="">全待機先</option>
                <option value="user">ユーザー待ち</option>
                <option value="admin">管理者待ち</option>
                <option value="openclaw">OpenClaw処理中</option>
              </Form.Select>
            </div>
            <div className="col-12 dl-action-row mobile-stack">
              <Form.Check
                type="checkbox"
                id="admin-user-requests-only-unread"
                label="未読のみ"
                checked={onlyUnread}
                onChange={(event) => setOnlyUnread(event.target.checked)}
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleApplyFilters}
              >
                絞り込む
              </button>
            </div>
            <div className="col-12 col-md-4">
              <Form.Label htmlFor="admin-user-request-queue-filter" className="small text-muted">対応キュー</Form.Label>
              <Form.Select
                id="admin-user-request-queue-filter"
                value={queueFilter}
                onChange={(event) => setQueueFilter(event.target.value as AdminQueueFilter)}
              >
                {queueFilterOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Form.Select>
            </div>
          </div>
        </AppCard.Body>
      </AppCard>

      {error && <ErrorRetryAlert error={error} onRetry={() => void retry()} />}
      {selectedIds.length > 0 && (
        <AppAlert variant="warning">
          <div className="d-flex justify-content-between align-items-center gap-2 flex-wrap">
            <span>{selectedIds.length} 件を選択中です。現在の管理メタデータをまとめて適用できます。</span>
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setSelectedIds([])}>
              選択をクリア
            </button>
          </div>
        </AppAlert>
      )}
      {bulkPreview && (
        <AppCard className="mb-3">
          <AppCard.Header>一括更新プレビュー</AppCard.Header>
          <AppCard.Body>
            <div className="small text-muted mb-2">対象 {bulkPreview.count} 件 / 適用内容: {bulkPreview.updates.join(' / ') || '変更なし'}</div>
            <div className="d-flex flex-column gap-2">
              {bulkPreview.sample.map((item) => (
                <div key={`bulk-preview-${item.id}`} className="border rounded p-2 small text-wrap-anywhere">
                  <div className="fw-semibold">#{item.id} {item.pharmacyName ?? '薬局名不明'}</div>
                  <div className="text-muted dl-line-clamp-2 mt-1">{item.requestText}</div>
                </div>
              ))}
              {bulkPreview.diffs.map((diff) => (
                <div key={`bulk-diff-${diff.id}`} className="border rounded p-2 small text-muted">
                  #{diff.id}
                  {' '}category {diff.category.from ?? '-'} {'->'} {diff.category.to ?? '-'}
                  {' / '}priority {diff.priority.from ?? '-'} {'->'} {diff.priority.to ?? '-'}
                  {' / '}assignee {diff.assignedAdminId.from ?? '-'} {'->'} {diff.assignedAdminId.to ?? '-'}
                  {' / '}close {diff.closeReason.from ?? '-'} {'->'} {diff.closeReason.to ?? '-'}
                </div>
              ))}
            </div>
          </AppCard.Body>
        </AppCard>
      )}
      {itemSummary.escalated > 0 && queueFilter !== 'escalated' && (
        <AppCard className="mb-3">
          <AppCard.Header>Escalation Queue</AppCard.Header>
          <AppCard.Body className="d-flex flex-column gap-2">
            {escalatedItems.map((item) => (
              <button
                key={`escalated-${item.id}`}
                type="button"
                className="btn text-start border border-warning bg-warning bg-opacity-10 w-100"
                onClick={() => {
                  setQueueFilter('escalated');
                  setSelectedRequestId(item.id);
                }}
              >
                <div className="fw-semibold text-wrap-anywhere">#{item.id} {item.pharmacyName ?? `薬局ID:${item.pharmacyId}`}</div>
                <div className="small text-muted mt-1 dl-line-clamp-2">{item.requestText}</div>
                <div className="small text-warning-emphasis mt-1">再催促: {formatDateTimeJa(item.latestEscalatedAt)}</div>
              </button>
            ))}
          </AppCard.Body>
        </AppCard>
      )}

      <ScrollArea>
        <AdminNavigationLinks groups={USER_REQUEST_LINK_GROUPS} />
        <div className={`dl-two-pane-grid${selectedRequestId ? ' dl-pane-detail-active' : ''}`}>
          <div className="dl-stack-gap-md">
            <AppCard className="h-100">
              <AppCard.Header>要望一覧</AppCard.Header>
              <AppCard.Body>
                {loading ? (
                  <InlineLoader text="ユーザーリクエストを読み込み中..." className="text-muted small" />
                ) : displayItems.length === 0 ? (
                  <AppEmptyState
                    title="対象の要望がありません"
                    description="条件に一致する要望がありません。OpenClaw 連携や通知・ログ側の運用へ戻れます。"
                    action={(
                      <div className="mt-3 dl-action-row mobile-stack justify-content-center">
                        <Link to="/admin/openclaw" className="btn btn-outline-secondary btn-sm">OpenClaw連携</Link>
                        <AppDropdownMenu
                          label="関連"
                          variant="outline-secondary"
                          items={[
                            { key: 'notifications', to: '/admin/notifications', label: '通知・配信状況' },
                            { key: 'log-center', to: '/admin/log-center', label: 'ログセンター' },
                          ]}
                        />
                      </div>
                    )}
                  />
                ) : (
                  <div className="d-flex flex-column gap-2">
                    {displayItems.map((item) => {
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
                          onClick={() => setSelectedRequestId(item.id)}
                        >
                          <div className="d-flex justify-content-end mb-2">
                            <Form.Check
                              type="checkbox"
                              id={`admin-request-select-${item.id}`}
                              label=""
                              checked={selectedIds.includes(item.id)}
                              onChange={(event) => {
                                event.stopPropagation();
                                toggleSelectedId(item.id);
                              }}
                              onClick={(event) => event.stopPropagation()}
                            />
                          </div>
                          <div className="d-flex justify-content-between align-items-start gap-2">
                            <strong className="text-wrap-anywhere flex-grow-1" style={{ minWidth: 0 }}>#{item.id} {item.pharmacyName ?? `薬局ID:${item.pharmacyId}`}</strong>
                            <span className="flex-shrink-0">{workflowBadge(item.workflowStatus)}</span>
                          </div>
                          <div className="d-flex flex-wrap gap-1 mt-2">
                            <Badge bg="light" text="dark">{categoryLabel(item.category)}</Badge>
                            {priorityBadge(item.priority)}
                            {item.hasUnread && <Badge bg="danger">未読</Badge>}
                            {waitingBadge(item)}
                            {item.latestEscalatedAt && <Badge bg="warning" text="dark">再催促あり</Badge>}
                          </div>
                          <div className="small mt-2 text-wrap-anywhere dl-line-clamp-3">{item.requestText}</div>
                          {(item.latestSummary || item.openclawSummary) && (
                            <div className="small text-muted mt-2 text-wrap-anywhere dl-line-clamp-2">{item.latestSummary ?? item.openclawSummary}</div>
                          )}
                          <div className="small mt-2">
                            <span className={`badge bg-${slaSummary.tone} ${slaSummary.tone === 'warning' ? 'text-dark' : ''}`}>
                              {slaSummary.nextActionLabel}
                            </span>
                            <span className="text-muted ms-2">
                              {slaSummary.dueLabel} / {slaSummary.elapsedLabel}
                            </span>
                          </div>
                          <div className="small text-muted mt-2">{formatDateTimeJa(item.updatedAt ?? item.createdAt)}</div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </AppCard.Body>
            </AppCard>
            <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
          </div>

          <div className="dl-stack-gap-md">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm d-xl-none mb-2"
              onClick={() => setSelectedRequestId(null)}
            >
              ← 一覧に戻る
            </button>
            <AppCard className="h-100">
              <AppCard.Header>要望詳細</AppCard.Header>
              <AppCard.Body>
                {!selectedRequestId ? (
                  <AppEmptyState
                    title="要望を選択してください"
                    description="左の一覧から対象要望を選ぶと詳細を表示します。OpenClaw の会話や運用ログに切り替えることもできます。"
                    action={(
                      <div className="mt-3 dl-action-row mobile-stack justify-content-center">
                        <Link to="/admin/openclaw" className="btn btn-outline-secondary btn-sm">OpenClaw連携</Link>
                        <AppDropdownMenu
                          label="関連"
                          variant="outline-secondary"
                          items={[
                            { key: 'log-center', to: '/admin/log-center', label: 'ログセンター' },
                          ]}
                        />
                      </div>
                    )}
                  />
                ) : detailLoading ? (
                  <InlineLoader text="要望詳細を読み込み中..." className="text-muted small" />
                ) : detailError ? (
                  <ErrorRetryAlert error={detailError} onRetry={() => void refreshListAndDetail()} />
                ) : !detail ? (
                  <AppEmptyState
                    title="詳細を表示できません"
                    description="対象要望の取得に失敗しました。連携状態やログを確認してから再試行してください。"
                    action={(
                      <div className="mt-3 dl-action-row mobile-stack justify-content-center">
                        <Link to="/admin/openclaw" className="btn btn-outline-secondary btn-sm">OpenClaw連携</Link>
                        <AppDropdownMenu
                          label="関連"
                          variant="outline-secondary"
                          items={[
                            { key: 'log-center', to: '/admin/log-center', label: 'ログセンター' },
                          ]}
                        />
                      </div>
                    )}
                  />
                ) : (
                  <div className="d-flex flex-column gap-3">
                    {(() => {
                      const slaSummary = getRequestSlaSummary(detail.request);
                      return (
                        <div className="border rounded p-3">
                          <div className="fw-semibold mb-2">SLA / 次アクション</div>
                          <div className="dl-badge-row">
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
                        </div>
                      );
                    })()}

                    <div className="border rounded p-3 bg-light">
                      <div className="dl-badge-row">
                        {workflowBadge(detail.request.workflowStatus)}
                        <Badge bg="light" text="dark">{categoryLabel(detail.request.category)}</Badge>
                        {priorityBadge(detail.request.priority)}
                        {detail.request.closeReason && (
                          <Badge bg="secondary">クローズ: {closeReasonLabel(detail.request.closeReason) ?? detail.request.closeReason}</Badge>
                        )}
                        {detail.request.hasUnread && <Badge bg="danger">管理者未読あり</Badge>}
                        {waitingBadge(detail.request)}
                      </div>
                      <div className="fw-semibold mt-2 text-wrap-anywhere">{detail.request.pharmacyName ?? `薬局ID:${detail.request.pharmacyId}`}</div>
                      <div className="small mt-2 text-wrap-anywhere" style={{ whiteSpace: 'pre-wrap' }}>{detail.request.requestText}</div>
                      {(detail.request.latestSummary || detail.request.openclawSummary) && (
                        <div className="small text-muted mt-2 text-wrap-anywhere" style={{ whiteSpace: 'pre-wrap' }}>{detail.request.latestSummary ?? detail.request.openclawSummary}</div>
                      )}
                      {detail.request.latestEscalatedAt && (
                        <div className="small text-warning-emphasis mt-2">直近再催促: {formatDateTimeJa(detail.request.latestEscalatedAt)}</div>
                      )}
                    </div>

                    <div className="border rounded p-3">
                      <div className="fw-semibold mb-2">トリアージ補助</div>
                      <div className="dl-action-row mobile-stack">
                        <button
                          type="button"
                          className="btn btn-sm btn-primary"
                          onClick={() => setReplyText(REPLY_TEMPLATES[1])}
                        >
                          確認依頼文を入れる
                        </button>
                        <AppDropdownMenu
                          label="その他"
                          variant="outline-secondary"
                          items={[
                            { key: 'urgent-bug', label: '緊急不具合に寄せる', onClick: () => applyMetaPreset('urgent_bug'), danger: true },
                            { key: 'duplicate', label: '重複候補にする', onClick: () => applyMetaPreset('duplicate') },
                            { key: 'on-hold', label: '保留にする', onClick: () => applyMetaPreset('on_hold') },
                          ]}
                        />
                      </div>
                    </div>

                    <div className="border rounded p-3">
                      <div className="fw-semibold mb-2">管理メタデータ</div>
                      <div className="row g-2">
                        <div className="col-12 col-md-3">
                          <Form.Select value={meta.category} onChange={(event) => setMeta((prev) => ({ ...prev, category: event.target.value }))}>
                            <option value="improvement">改善要望</option>
                            <option value="bug_report">不具合</option>
                            <option value="question">質問</option>
                            <option value="master_update">マスター更新</option>
                            <option value="integration_issue">連携不具合</option>
                          </Form.Select>
                        </div>
                        <div className="col-12 col-md-3">
                          <Form.Select value={meta.priority} onChange={(event) => setMeta((prev) => ({ ...prev, priority: event.target.value }))}>
                            <option value="urgent">緊急</option>
                            <option value="normal">通常</option>
                            <option value="low">低</option>
                          </Form.Select>
                        </div>
                        <div className="col-12 col-md-3">
                          <Form.Select value={meta.assignedAdminId} onChange={(event) => setMeta((prev) => ({ ...prev, assignedAdminId: event.target.value }))}>
                            <option value="">担当なし</option>
                            {assignees.map((assignee) => (
                              <option key={assignee.id} value={assignee.id}>{assignee.name}</option>
                            ))}
                          </Form.Select>
                        </div>
                        <div className="col-12 col-md-3">
                          <Form.Select value={meta.closeReason} onChange={(event) => setMeta((prev) => ({ ...prev, closeReason: event.target.value }))}>
                            <option value="">クローズしない</option>
                            <option value="completed">完了</option>
                            <option value="duplicate">重複</option>
                            <option value="rejected">却下</option>
                            <option value="cannot_reproduce">再現不可</option>
                            <option value="on_hold">保留</option>
                          </Form.Select>
                        </div>
                      </div>
                      <div className="d-flex justify-content-end mt-3">
                        <div className="dl-action-row mobile-stack">
                          <LoadingButton variant="primary" onClick={handleSaveMeta} loading={savingMeta} loadingLabel="保存中...">
                            管理情報を保存
                          </LoadingButton>
                          {selectedIds.length > 0 && (
                            <AppDropdownMenu
                              label="一括操作"
                              variant="outline-secondary"
                              items={[
                                {
                                  key: 'preview-bulk',
                                  label: '一括適用をプレビュー',
                                  onClick: () => { void handlePreviewBulkSaveMeta(); },
                                  disabled: savingMeta,
                                },
                                {
                                  key: 'apply-bulk',
                                  label: savingMeta ? '適用中...' : '選択中に一括適用',
                                  onClick: () => { void handleBulkSaveMeta(); },
                                  disabled: savingMeta,
                                },
                              ]}
                            />
                          )}
                        </div>
                      </div>
                    </div>

                    {(detail.request.branchName || detail.request.prUrl || detail.request.lastQuestion || detail.request.lastError) && (
                      <div className="border rounded p-3">
                        <div className="fw-semibold mb-2">実装結果・進行状況</div>
                        {detail.request.prUrl && (
                          <div className="small">
                            PR: <a href={detail.request.prUrl} target="_blank" rel="noreferrer">#{detail.request.prNumber ?? '-'}</a>
                          </div>
                        )}
                        {detail.request.branchName && (
                          <div className="small text-muted">branch: {detail.request.branchName}</div>
                        )}
                        {detail.request.lastQuestion && (
                          <div className="small mt-2">確認事項: {detail.request.lastQuestion}</div>
                        )}
                        {detail.request.lastError && (
                          <div className="small text-danger mt-2">最新エラー: {detail.request.lastError}</div>
                        )}
                      </div>
                    )}

                    <div className="border rounded p-3">
                      <div className="fw-semibold mb-2">ユーザーへの返信</div>
                      <div className="dl-action-row mobile-stack mb-2">
                        <AppDropdownMenu
                          label="定型文を挿入"
                          variant="outline-secondary"
                          align="start"
                          items={replyTemplateMenuItems}
                        />
                      </div>
                      <Form.Control
                        as="textarea"
                        rows={4}
                        value={replyText}
                        onChange={(event) => setReplyText(event.target.value)}
                        placeholder="ユーザーへ共有する内容を入力"
                      />
                      <div className="d-flex flex-column flex-md-row gap-2 justify-content-between align-items-md-center mt-2">
                        <div className="d-flex flex-column gap-1">
                          <Form.Control
                            type="file"
                            multiple
                            onChange={handleReplyFilesChange}
                          />
                          {replyFiles.length > 0 && (
                            <div className="small text-muted">{replyFiles.map((file) => file.name).join(', ')}</div>
                          )}
                          {savedReplyTemplates.length > 0 && (
                            <div className="small text-muted">保存済みテンプレート: {savedReplyTemplates.length} 件</div>
                          )}
                        </div>
                        <div className="dl-action-row mobile-stack justify-content-end">
                          <LoadingButton variant="primary" onClick={handleReply} loading={sendingReply} loadingLabel="送信中...">
                            管理者返信を送信
                          </LoadingButton>
                          <AppDropdownMenu
                            label="その他"
                            variant="outline-secondary"
                            items={[
                              {
                                key: 'save-current-reply',
                                label: '現在文面を保存',
                                onClick: saveCurrentReplyTemplate,
                                disabled: !replyText.trim(),
                              },
                            ]}
                          />
                        </div>
                      </div>
                      {savedReplyTemplates.length > 0 && (
                        <div className="dl-action-row mobile-stack mt-2">
                          <AppDropdownMenu
                            label="保存済み定型文を整理"
                            variant="outline-secondary"
                            items={savedReplyTemplates.map((template, index) => ({
                              key: `delete-template-${index}`,
                              label: `${template.slice(0, 28)}${template.length > 28 ? '…' : ''} を削除`,
                              onClick: () => setSavedReplyTemplates((prev) => removeStoredTemplate(prev, template)),
                              danger: true,
                            }))}
                          />
                        </div>
                      )}
                    </div>

                    <div className="border rounded p-3">
                      <div className="fw-semibold mb-2">内部メモ</div>
                      {detail.notes.length === 0 ? (
                        <div className="text-muted small mb-2">内部メモはまだありません。</div>
                      ) : (
                        <div className="d-flex flex-column gap-2 mb-3">
                          {detail.notes.map((note) => (
                            <div key={note.id} className="border rounded p-2 bg-light">
                              <div className="small fw-semibold">{note.authorAdminName ?? 'Admin'}</div>
                              <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{note.body}</div>
                              <div className="small text-muted mt-1">{formatDateTimeJa(note.createdAt)}</div>
                            </div>
                          ))}
                        </div>
                      )}
                      <Form.Control
                        as="textarea"
                        rows={3}
                        value={noteText}
                        onChange={(event) => setNoteText(event.target.value)}
                        placeholder="管理者だけが見えるメモ"
                      />
                      <div className="d-flex justify-content-end mt-2">
                        <LoadingButton variant="outline-secondary" onClick={handleSaveNote} loading={savingNote} loadingLabel="保存中...">
                          内部メモを保存
                        </LoadingButton>
                      </div>
                    </div>

                    <div className="border rounded p-3">
                      <div className="fw-semibold mb-2">会話履歴</div>
                      <div className="d-flex flex-column gap-2">
                        {detail.messages.map((message) => (
                          <div key={message.id} className="border rounded p-3">
                            <div className="d-flex justify-content-between align-items-center mb-1">
                              <strong className="small">{authorLabel(message.authorType)}</strong>
                              <span className="small text-muted">{formatDateTimeJa(message.createdAt)}</span>
                            </div>
                            {message.body ? (
                              <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{message.body}</div>
                            ) : (
                              <div className="small text-muted">添付ファイル</div>
                            )}
                            <AttachmentPreviewList
                              attachments={message.attachments}
                              getDownloadUrl={attachmentUrl}
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    {detail.events.some((event) => event.eventType === 'assignee_changed') && (
                      <div className="border rounded p-3">
                        <div className="fw-semibold mb-2">担当変更履歴</div>
                        <div className="d-flex flex-column gap-2">
                          {detail.events.filter((event) => event.eventType === 'assignee_changed').map((event) => (
                            <div key={`assignee-${event.id}`} className="small border-bottom pb-2">
                              <div className="fw-semibold">{event.summary ?? '担当変更'}</div>
                              {event.note && <div>{event.note}</div>}
                              <div className="text-muted mt-1">{formatDateTimeJa(event.createdAt)}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {detail.events.length > 0 && (
                      <div className="border rounded p-3">
                        <div className="fw-semibold mb-2">更新ログ</div>
                        <div className="d-flex flex-column gap-2">
                          {detail.events.map((event) => (
                            <div key={event.id} className="small border-bottom pb-2">
                              <div className="fw-semibold">{event.eventType}</div>
                              {event.summary && <div>{event.summary}</div>}
                              {event.note && <div className="text-muted">{event.note}</div>}
                              <div className="text-muted mt-1">{formatDateTimeJa(event.createdAt)}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </AppCard.Body>
            </AppCard>
          </div>
        </div>
      </ScrollArea>
    </PageShell>
  );
}
