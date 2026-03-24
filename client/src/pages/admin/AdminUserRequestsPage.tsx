import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Badge, Form } from 'react-bootstrap';
import { api, buildApiUrl } from '../../api/client';
import Pagination from '../../components/Pagination';
import AppAlert from '../../components/ui/AppAlert';
import AttachmentPreviewList from '../../components/ui/AttachmentPreviewList';
import AppCard from '../../components/ui/AppCard';
import AppEmptyState from '../../components/ui/AppEmptyState';
import ErrorRetryAlert from '../../components/ui/ErrorRetryAlert';
import InlineLoader from '../../components/ui/InlineLoader';
import LoadingButton from '../../components/ui/LoadingButton';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { useSseRefresh } from '../../hooks/useSseRefresh';
import { formatDateTimeJa } from '../../utils/formatters';

const LIVE_REFRESH_INTERVAL_MS = 60_000;

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

export default function AdminUserRequestsPage() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [waitingOnFilter, setWaitingOnFilter] = useState('');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
  const [assignees, setAssignees] = useState<Array<{ id: number; name: string }>>([]);
  const [detail, setDetail] = useState<AdminUserRequestDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [actionError, setActionError] = useState('');
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
  const filtersInitializedRef = useRef(false);

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
    (targetPage, signal) => {
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
    },
    { errorMessage: 'ユーザーリクエストの取得に失敗しました' },
  );

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
    if (items.length === 0) {
      setSelectedRequestId(null);
      setDetail(null);
      return;
    }
    if (selectedRequestId && items.some((item) => item.id === selectedRequestId)) {
      return;
    }
    setSelectedRequestId(items[0].id);
  }, [items, selectedRequestId]);

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
      await refreshListAndDetail();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '要望の更新に失敗しました');
    } finally {
      setSavingMeta(false);
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
      {actionMessage && <AppAlert variant="success" dismissible onClose={() => setActionMessage('')}>{actionMessage}</AppAlert>}
      {actionError && <AppAlert variant="danger" dismissible onClose={() => setActionError('')}>{actionError}</AppAlert>}

      <AppCard className="mb-3">
        <AppCard.Header>絞り込み</AppCard.Header>
        <AppCard.Body>
          <div className="row g-2">
            <div className="col-12 col-md-4">
              <Form.Control
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
            <div className="col-12 d-flex flex-wrap gap-2 align-items-center">
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
          </div>
        </AppCard.Body>
      </AppCard>

      {error && <ErrorRetryAlert error={error} onRetry={() => void retry()} />}

      <ScrollArea>
        <div className="dl-two-pane-grid">
          <div className="dl-stack-gap-md">
            <AppCard className="h-100">
              <AppCard.Header>要望一覧</AppCard.Header>
              <AppCard.Body>
                {loading ? (
                  <InlineLoader text="ユーザーリクエストを読み込み中..." className="text-muted small" />
                ) : items.length === 0 ? (
                  <AppEmptyState title="対象の要望がありません" description="条件に一致する要望がありません。" />
                ) : (
                  <div className="d-flex flex-column gap-2">
                    {items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`btn text-start border ${selectedRequestId === item.id ? 'border-primary bg-light' : 'border-light-subtle'}`}
                        onClick={() => setSelectedRequestId(item.id)}
                      >
                        <div className="d-flex justify-content-between align-items-start gap-2">
                          <strong>#{item.id} {item.pharmacyName ?? `薬局ID:${item.pharmacyId}`}</strong>
                          {workflowBadge(item.workflowStatus)}
                        </div>
                        <div className="d-flex flex-wrap gap-1 mt-2">
                          <Badge bg="light" text="dark">{categoryLabel(item.category)}</Badge>
                          {priorityBadge(item.priority)}
                          {item.hasUnread && <Badge bg="danger">未読</Badge>}
                          {waitingBadge(item)}
                        </div>
                        <div className="small mt-2">{item.requestText}</div>
                        {(item.latestSummary || item.openclawSummary) && (
                          <div className="small text-muted mt-2">{item.latestSummary ?? item.openclawSummary}</div>
                        )}
                        <div className="small text-muted mt-2">{formatDateTimeJa(item.updatedAt ?? item.createdAt)}</div>
                      </button>
                    ))}
                  </div>
                )}
              </AppCard.Body>
            </AppCard>
            <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
          </div>

          <div className="dl-stack-gap-md">
            <AppCard className="h-100">
              <AppCard.Header>要望詳細</AppCard.Header>
              <AppCard.Body>
                {!selectedRequestId ? (
                  <AppEmptyState title="要望を選択してください" description="左の一覧から対象要望を選ぶと詳細を表示します。" />
                ) : detailLoading ? (
                  <InlineLoader text="要望詳細を読み込み中..." className="text-muted small" />
                ) : detailError ? (
                  <ErrorRetryAlert error={detailError} onRetry={() => void refreshListAndDetail()} />
                ) : !detail ? (
                  <AppEmptyState title="詳細を表示できません" description="対象要望の取得に失敗しました。" />
                ) : (
                  <div className="d-flex flex-column gap-3">
                    <div className="border rounded p-3 bg-light">
                      <div className="d-flex flex-wrap gap-2">
                        {workflowBadge(detail.request.workflowStatus)}
                        <Badge bg="light" text="dark">{categoryLabel(detail.request.category)}</Badge>
                        {priorityBadge(detail.request.priority)}
                        {detail.request.closeReason && (
                          <Badge bg="secondary">クローズ: {closeReasonLabel(detail.request.closeReason) ?? detail.request.closeReason}</Badge>
                        )}
                        {detail.request.hasUnread && <Badge bg="danger">管理者未読あり</Badge>}
                        {waitingBadge(detail.request)}
                      </div>
                      <div className="fw-semibold mt-2">{detail.request.pharmacyName ?? `薬局ID:${detail.request.pharmacyId}`}</div>
                      <div className="small mt-2">{detail.request.requestText}</div>
                      {(detail.request.latestSummary || detail.request.openclawSummary) && (
                        <div className="small text-muted mt-2">{detail.request.latestSummary ?? detail.request.openclawSummary}</div>
                      )}
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
                        <LoadingButton variant="primary" onClick={handleSaveMeta} loading={savingMeta} loadingLabel="保存中...">
                          管理情報を保存
                        </LoadingButton>
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
                      <div className="d-flex flex-wrap gap-2 mb-2">
                        {REPLY_TEMPLATES.map((template) => (
                          <button
                            key={template}
                            type="button"
                            className="btn btn-outline-secondary btn-sm"
                            onClick={() => setReplyText(template)}
                          >
                            {template}
                          </button>
                        ))}
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
                        </div>
                        <LoadingButton variant="primary" onClick={handleReply} loading={sendingReply} loadingLabel="送信中...">
                          管理者返信を送信
                        </LoadingButton>
                      </div>
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
