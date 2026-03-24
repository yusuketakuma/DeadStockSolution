import { useEffect, useState, type ChangeEvent } from 'react';
import { Badge, Form } from 'react-bootstrap';
import { api, buildApiUrl } from '../api/client';
import AppAlert from '../components/ui/AppAlert';
import AppCard from '../components/ui/AppCard';
import AppControl from '../components/ui/AppControl';
import AttachmentPreviewList from '../components/ui/AttachmentPreviewList';
import InlineLoader from '../components/ui/InlineLoader';
import LoadingButton from '../components/ui/LoadingButton';
import PageShell, { ScrollArea } from '../components/ui/PageShell';
import { useSseRefresh } from '../hooks/useSseRefresh';
import { formatDateTimeJa } from '../utils/formatters';

const LIVE_REFRESH_INTERVAL_MS = 60_000;
const REQUEST_TEMPLATES = [
  '操作中にエラーが発生しました。再現手順は次のとおりです。',
  '医薬品マスターの更新状況を確認したいです。',
  '検索結果の表示順を改善してほしいです。',
  'OpenClaw 連携の挙動を確認したいです。',
] as const;

interface RequestItem {
  id: number;
  requestText: string;
  category: string;
  priority: string;
  closeReason: string | null;
  assignedAdminId: number | null;
  assignedAdminName: string | null;
  requesterLastViewedAt: string | null;
  adminLastViewedAt: string | null;
  latestUserMessageAt: string | null;
  latestStaffMessageAt: string | null;
  openclawStatus: string;
  openclawThreadId: string | null;
  openclawSummary: string | null;
  workflowStatus: string | null;
  latestSummary: string | null;
  branchName: string | null;
  prUrl: string | null;
  prNumber: number | null;
  updatedAt: string | null;
  createdAt: string | null;
  hasUnread: boolean;
  waitingOn: 'user' | 'admin' | 'openclaw' | null;
  isOverdue: boolean;
}

interface RequestMessageItem {
  id: number;
  authorType: 'user' | 'openclaw_agent' | 'system' | 'admin';
  messageType: 'message' | 'question' | 'status_update' | 'pr_report';
  body: string;
  createdAt: string | null;
  metadata: Record<string, unknown> | null;
  attachments: Array<{
    id: number;
    fileName: string;
    mimeType: string;
    fileSize: number;
  }>;
}

interface DuplicateRequestSuggestion {
  id: number;
  requestText: string;
  category: string;
  priority: string;
  closeReason: string | null;
  createdAt: string | null;
  score: number;
}

interface RequestThreadResponse {
  request: RequestItem & {
    lastQuestion?: string | null;
    lastError?: string | null;
  };
  messages: RequestMessageItem[];
}

function statusBadge(status: string | null): { bg: 'secondary' | 'primary' | 'warning' | 'success' | 'danger'; label: string } {
  switch (status) {
    case 'awaiting_user':
      return { bg: 'primary', label: '回答待ち' };
    case 'implementing':
      return { bg: 'warning', label: '実装中' };
    case 'pr_opened':
      return { bg: 'warning', label: 'PR作成済み' };
    case 'completed':
      return { bg: 'success', label: '完了' };
    case 'failed':
      return { bg: 'danger', label: '失敗' };
    case 'analyzing':
      return { bg: 'secondary', label: '解析中' };
    case 'queued':
    default:
      return { bg: 'secondary', label: '受付済み' };
  }
}

function authorLabel(authorType: RequestMessageItem['authorType']): string {
  if (authorType === 'openclaw_agent') return 'DSS Manager';
  if (authorType === 'system') return 'System';
  if (authorType === 'admin') return 'Admin';
  return 'あなた';
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

function priorityLabel(priority: string): string {
  switch (priority) {
    case 'urgent':
      return '緊急';
    case 'low':
      return '低';
    case 'normal':
    default:
      return '通常';
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

function waitingBadge(item: RequestItem) {
  if (item.isOverdue) {
    return <Badge bg="warning" text="dark">24時間超</Badge>;
  }
  if (item.waitingOn === 'user') {
    return <Badge bg="primary">回答待ち</Badge>;
  }
  if (item.waitingOn === 'admin') {
    return <Badge bg="danger">管理者確認待ち</Badge>;
  }
  if (item.waitingOn === 'openclaw') {
    return <Badge bg="secondary">処理中</Badge>;
  }
  return null;
}

function attachmentUrl(attachmentId: number): string {
  return buildApiUrl(`/requests/attachments/${attachmentId}`);
}

export default function MyRequestsPage() {
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
  const [thread, setThread] = useState<RequestThreadResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newRequestText, setNewRequestText] = useState('');
  const [newCategory, setNewCategory] = useState('improvement');
  const [newPriority, setNewPriority] = useState('normal');
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [duplicateSuggestions, setDuplicateSuggestions] = useState<DuplicateRequestSuggestion[]>([]);
  const [creating, setCreating] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const loadRequests = async ({ background = false }: { background?: boolean } = {}) => {
    if (!background) {
      setLoading(true);
    }
    try {
      const response = await api.get<{ data: RequestItem[] }>('/requests/me');
      setRequests(response.data);
      setSelectedRequestId((current) => {
        if (current && response.data.some((item) => item.id === current)) {
          return current;
        }
        return response.data[0]?.id ?? null;
      });
    } catch (err) {
      if (!background) {
        setError(err instanceof Error ? err.message : '要望一覧の取得に失敗しました');
      }
    } finally {
      if (!background) {
        setLoading(false);
      }
    }
  };

  const loadThread = async (requestId: number, { background = false }: { background?: boolean } = {}) => {
    if (!background) {
      setThreadLoading(true);
    }
    try {
      const response = await api.get<RequestThreadResponse>(`/requests/${requestId}/messages`);
      setThread(response);
    } catch (err) {
      if (!background) {
        setError(err instanceof Error ? err.message : '会話履歴の取得に失敗しました');
      }
    } finally {
      if (!background) {
        setThreadLoading(false);
      }
    }
  };

  useEffect(() => {
    void loadRequests();
  }, []);

  useEffect(() => {
    if (!selectedRequestId) {
      setThread(null);
      return;
    }
    void loadThread(selectedRequestId);
  }, [selectedRequestId]);

  useEffect(() => {
    if (!showCreateForm) {
      setDuplicateSuggestions([]);
      return;
    }
    const query = newRequestText.trim();
    if (query.length < 4) {
      setDuplicateSuggestions([]);
      return;
    }

    const timer = window.setTimeout(() => {
      void api
        .get<{ data: DuplicateRequestSuggestion[] }>(`/requests/suggestions?query=${encodeURIComponent(query)}`)
        .then((response) => setDuplicateSuggestions(response.data))
        .catch(() => setDuplicateSuggestions([]));
    }, 300);

    return () => window.clearTimeout(timer);
  }, [newRequestText, showCreateForm]);

  const { connected: realtimeConnected } = useSseRefresh({
    enabled: true,
    streamPath: '/realtime/stream?topics=requests',
    events: ['requests.refresh'],
    onRefresh: async () => {
      await loadRequests({ background: true });
      if (selectedRequestId) {
        await loadThread(selectedRequestId, { background: true });
      }
    },
    fallbackIntervalMs: LIVE_REFRESH_INTERVAL_MS,
    minFetchIntervalMs: 4_000,
  });

  const handleReply = async () => {
    if (!selectedRequestId) return;
    const trimmed = replyText.trim();
    if (!trimmed && replyFiles.length === 0) {
      setError('返信内容を入力してください');
      return;
    }

    setSending(true);
    setError('');
    setMessage('');
    try {
      if (replyFiles.length > 0) {
        const formData = new FormData();
        formData.set('message', trimmed);
        replyFiles.forEach((file) => formData.append('files', file));
        await api.upload<{ message: string; nextStep?: string }>(`/requests/${selectedRequestId}/messages`, formData);
      } else {
        await api.post<{ message: string; nextStep?: string }>(`/requests/${selectedRequestId}/messages`, {
          message: trimmed,
        });
      }
      setReplyText('');
      setReplyFiles([]);
      await Promise.all([loadRequests(), loadThread(selectedRequestId)]);
      setMessage('追加情報を送信しました');
    } catch (err) {
      setError(err instanceof Error ? err.message : '返信の送信に失敗しました');
    } finally {
      setSending(false);
    }
  };

  const handleCreateRequest = async () => {
    const trimmed = newRequestText.trim();
    if (!trimmed && newFiles.length === 0) {
      setError('新しい要望内容を入力してください');
      return;
    }

    setCreating(true);
    setError('');
    setMessage('');
    try {
      let response: {
        message: string;
        nextStep?: string;
        request: { id: number };
      };

      if (newFiles.length > 0) {
        const formData = new FormData();
        formData.set('message', trimmed);
        formData.set('category', newCategory);
        formData.set('priority', newPriority);
        newFiles.forEach((file) => formData.append('files', file));
        response = await api.upload('/requests', formData);
      } else {
        response = await api.post('/requests', {
          message: trimmed,
          category: newCategory,
          priority: newPriority,
        });
      }

      const createdRequestId = response.request?.id ?? null;
      setNewRequestText('');
      setNewCategory('improvement');
      setNewPriority('normal');
      setNewFiles([]);
      setDuplicateSuggestions([]);
      setShowCreateForm(false);
      setMessage(response.nextStep ? `${response.message} ${response.nextStep}` : response.message);
      await loadRequests();
      if (createdRequestId) {
        setSelectedRequestId(createdRequestId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '要望の送信に失敗しました');
    } finally {
      setCreating(false);
    }
  };

  const handleNewFilesChange = (event: ChangeEvent<HTMLInputElement>) => {
    setNewFiles(Array.from(event.currentTarget.files ?? []));
  };

  const handleReplyFilesChange = (event: ChangeEvent<HTMLInputElement>) => {
    setReplyFiles(Array.from(event.currentTarget.files ?? []));
  };

  return (
    <PageShell>
      <div className="dl-page-header">
        <div className="dl-page-header-copy">
          <h4 className="page-title mb-0">ユーザーリクエストとバグ報告</h4>
          <div className="text-muted small">新規要望の登録と、OpenClaw・管理者とのやり取りをここで追えます。</div>
        </div>
        <Badge bg={realtimeConnected ? 'success' : 'secondary'}>
          自動更新: {realtimeConnected ? '接続中' : 'ポーリング'}
        </Badge>
      </div>
      {message && <AppAlert variant="success" dismissible onClose={() => setMessage('')}>{message}</AppAlert>}
      {error && <AppAlert variant="danger" dismissible onClose={() => setError('')}>{error}</AppAlert>}

      <AppCard className="mb-3">
        <AppCard.Header>新しい要望</AppCard.Header>
        <AppCard.Body>
          {!showCreateForm ? (
            <div className="d-flex flex-column gap-2 gap-md-0 flex-md-row justify-content-between align-items-md-center">
              <div className="text-muted small">不具合修正や改善依頼を新しく登録できます。</div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setShowCreateForm(true)}
              >
                新しい要望を入力
              </button>
            </div>
          ) : (
            <div className="d-flex flex-column gap-3">
              <div className="d-flex flex-wrap gap-2">
                {REQUEST_TEMPLATES.map((template) => (
                  <button
                    key={template}
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={() => setNewRequestText(template)}
                  >
                    {template}
                  </button>
                ))}
              </div>

              <div className="row g-2">
                <div className="col-12 col-md-4">
                  <Form.Select value={newCategory} onChange={(event) => setNewCategory(event.target.value)}>
                    <option value="improvement">改善要望</option>
                    <option value="bug_report">不具合</option>
                    <option value="question">質問</option>
                    <option value="master_update">マスター更新</option>
                    <option value="integration_issue">連携不具合</option>
                  </Form.Select>
                </div>
                <div className="col-12 col-md-4">
                  <Form.Select value={newPriority} onChange={(event) => setNewPriority(event.target.value)}>
                    <option value="urgent">緊急</option>
                    <option value="normal">通常</option>
                    <option value="low">低</option>
                  </Form.Select>
                </div>
                <div className="col-12 col-md-4">
                  <Form.Control
                    type="file"
                    multiple
                    onChange={handleNewFilesChange}
                  />
                </div>
              </div>

              <AppControl
                as="textarea"
                rows={4}
                value={newRequestText}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setNewRequestText(e.target.value)}
                placeholder="依頼したい内容や困っていることを入力してください"
              />

              {newFiles.length > 0 && (
                <div className="small text-muted">{newFiles.map((file) => file.name).join(', ')}</div>
              )}

              {duplicateSuggestions.length > 0 && (
                <div className="border rounded p-3 bg-light">
                  <div className="fw-semibold small mb-2">似た要望が見つかりました</div>
                  <div className="d-flex flex-column gap-2">
                    {duplicateSuggestions.map((suggestion) => (
                      <button
                        key={suggestion.id}
                        type="button"
                        className="btn btn-outline-secondary text-start"
                        onClick={() => setSelectedRequestId(suggestion.id)}
                      >
                        <div className="d-flex flex-wrap gap-1 mb-1">
                          <Badge bg="secondary">#{suggestion.id}</Badge>
                          <Badge bg="light" text="dark">{categoryLabel(suggestion.category)}</Badge>
                          <Badge bg="light" text="dark">{priorityLabel(suggestion.priority)}</Badge>
                        </div>
                        <div className="small">{suggestion.requestText}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="d-flex justify-content-end gap-2">
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={() => {
                    setShowCreateForm(false);
                    setNewRequestText('');
                    setNewFiles([]);
                    setDuplicateSuggestions([]);
                  }}
                  disabled={creating}
                >
                  キャンセル
                </button>
                <LoadingButton
                  variant="primary"
                  onClick={handleCreateRequest}
                  loading={creating}
                  loadingLabel="送信中..."
                >
                  要望を送信
                </LoadingButton>
              </div>
            </div>
          )}
        </AppCard.Body>
      </AppCard>

      <ScrollArea>
        <div className="dl-two-pane-grid">
          <div className="dl-stack-gap-md">
            <AppCard>
              <AppCard.Header>要望一覧</AppCard.Header>
              <AppCard.Body>
                <div className="text-muted small mb-3">
                  更新はリアルタイムで反映されます。OpenClaw の進行状況と管理者返信もここに集約されます。
                </div>
                {loading ? (
                  <InlineLoader text="読み込み中..." className="text-muted small" />
                ) : requests.length === 0 ? (
                  <div className="text-muted small">送信済みの要望はまだありません。</div>
                ) : (
                  <div className="d-flex flex-column gap-2">
                    {requests.map((item) => {
                      const badge = statusBadge(item.workflowStatus);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`btn text-start border ${selectedRequestId === item.id ? 'border-primary bg-light' : 'border-light-subtle'}`}
                          onClick={() => setSelectedRequestId(item.id)}
                        >
                          <div className="d-flex justify-content-between align-items-start gap-2">
                            <strong>要望 #{item.id}</strong>
                            <Badge bg={badge.bg}>{badge.label}</Badge>
                          </div>
                          <div className="d-flex flex-wrap gap-1 mt-2">
                            <Badge bg="light" text="dark">{categoryLabel(item.category)}</Badge>
                            <Badge bg={item.priority === 'urgent' ? 'danger' : item.priority === 'low' ? 'secondary' : 'info'}>
                              {priorityLabel(item.priority)}
                            </Badge>
                            {item.hasUnread && <Badge bg="danger">未読あり</Badge>}
                            {waitingBadge(item)}
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
          </div>

          <div className="dl-stack-gap-md">
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
                        <Badge bg={statusBadge(thread.request.workflowStatus).bg}>{statusBadge(thread.request.workflowStatus).label}</Badge>
                        <Badge bg="light" text="dark">{categoryLabel(thread.request.category)}</Badge>
                        <Badge bg={thread.request.priority === 'urgent' ? 'danger' : thread.request.priority === 'low' ? 'secondary' : 'info'}>
                          {priorityLabel(thread.request.priority)}
                        </Badge>
                        {thread.request.closeReason && (
                          <Badge bg="secondary">クローズ: {closeReasonLabel(thread.request.closeReason)}</Badge>
                        )}
                        {thread.request.assignedAdminName && (
                          <Badge bg="dark">担当: {thread.request.assignedAdminName}</Badge>
                        )}
                        {waitingBadge(thread.request)}
                      </div>
                      <div className="small text-muted mt-2">元の要望: {thread.request.requestText}</div>
                      {(thread.request.latestSummary || thread.request.openclawSummary) && (
                        <div className="small mt-2">{thread.request.latestSummary ?? thread.request.openclawSummary}</div>
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
                            onClick={() => setReplyText(template)}
                          >
                            {template}
                          </button>
                        ))}
                      </div>
                      <AppControl
                        as="textarea"
                        rows={4}
                        value={replyText}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReplyText(e.target.value)}
                        placeholder="必要な追加情報や回答を入力"
                      />
                      <div className="d-flex flex-column flex-md-row justify-content-between gap-2 mt-2">
                        <div className="d-flex flex-column gap-1">
                          <Form.Control
                            type="file"
                            multiple
                            onChange={handleReplyFilesChange}
                          />
                          {replyFiles.length > 0 && (
                            <div className="text-muted small">{replyFiles.map((file) => file.name).join(', ')}</div>
                          )}
                        </div>
                        <LoadingButton
                          variant="primary"
                          onClick={handleReply}
                          loading={sending}
                          loadingLabel="送信中..."
                          disabled={thread.request.workflowStatus === 'completed'}
                        >
                          追加情報を送信
                        </LoadingButton>
                      </div>
                      {thread.request.workflowStatus === 'completed' && (
                        <div className="text-muted small mt-2">完了済み要望のため返信はできません。</div>
                      )}
                    </div>
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
