import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { Badge } from 'react-bootstrap';
import { api } from '../api/client';
import AppAlert from '../components/ui/AppAlert';
import PageShell, { ScrollArea } from '../components/ui/PageShell';
import { useSseRefresh } from '../hooks/useSseRefresh';
import { matchesQueueFilter, requestSortRank } from './my-requests/helpers';
import { NewRequestSection } from './my-requests/NewRequestSection';
import { RequestListPane } from './my-requests/RequestListPane';
import { RequestThreadPane } from './my-requests/RequestThreadPane';
import {
  LIVE_REFRESH_INTERVAL_MS,
  type DuplicateRequestSuggestion,
  type RequestItem,
  type RequestQueueFilter,
  type RequestThreadResponse,
} from './my-requests/types';

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
  const [queueFilter, setQueueFilter] = useState<RequestQueueFilter>('all');

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

  const handleCancelCreateForm = () => {
    setShowCreateForm(false);
    setNewRequestText('');
    setNewFiles([]);
    setDuplicateSuggestions([]);
  };

  const requestSummary = useMemo(() => ({
    myTurn: requests.filter((item) => item.waitingOn === 'user').length,
    overdue: requests.filter((item) => item.isOverdue).length,
    unread: requests.filter((item) => item.hasUnread).length,
    openclaw: requests.filter((item) => item.waitingOn === 'openclaw').length,
  }), [requests]);

  const displayRequests = useMemo(() => [...requests]
    .filter((item) => matchesQueueFilter(item, queueFilter))
    .sort((left, right) => {
      const rankDiff = requestSortRank(left) - requestSortRank(right);
      if (rankDiff !== 0) return rankDiff;
      return new Date(right.updatedAt ?? right.createdAt ?? '').getTime()
        - new Date(left.updatedAt ?? left.createdAt ?? '').getTime();
    }), [queueFilter, requests]);

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

      <NewRequestSection
        showCreateForm={showCreateForm}
        newRequestText={newRequestText}
        newCategory={newCategory}
        newPriority={newPriority}
        newFiles={newFiles}
        duplicateSuggestions={duplicateSuggestions}
        creating={creating}
        onOpenCreateForm={() => setShowCreateForm(true)}
        onCancel={handleCancelCreateForm}
        onRequestTextChange={setNewRequestText}
        onCategoryChange={setNewCategory}
        onPriorityChange={setNewPriority}
        onNewFilesChange={handleNewFilesChange}
        onSubmit={handleCreateRequest}
        onSelectSuggestion={setSelectedRequestId}
      />

      <ScrollArea>
        <div className={`dl-two-pane-grid${selectedRequestId ? ' dl-pane-detail-active' : ''}`}>
          <div className="dl-stack-gap-md">
            <RequestListPane
              loading={loading}
              requests={requests}
              displayRequests={displayRequests}
              selectedRequestId={selectedRequestId}
              queueFilter={queueFilter}
              requestSummary={requestSummary}
              onSelectRequest={setSelectedRequestId}
              onQueueFilterChange={setQueueFilter}
            />
          </div>

          <div className="dl-stack-gap-md">
            <RequestThreadPane
              selectedRequestId={selectedRequestId}
              threadLoading={threadLoading}
              thread={thread}
              replyText={replyText}
              replyFiles={replyFiles}
              sending={sending}
              onBack={() => setSelectedRequestId(null)}
              onReplyTextChange={setReplyText}
              onReplyFilesChange={handleReplyFilesChange}
              onReplyTemplateSelect={setReplyText}
              onSendReply={handleReply}
            />
          </div>
        </div>
      </ScrollArea>
    </PageShell>
  );
}
