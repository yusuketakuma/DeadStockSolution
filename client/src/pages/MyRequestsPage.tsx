import { useEffect, useState } from 'react';
import { Badge } from 'react-bootstrap';
import { api } from '../api/client';
import AppAlert from '../components/ui/AppAlert';
import AppCard from '../components/ui/AppCard';
import AppControl from '../components/ui/AppControl';
import InlineLoader from '../components/ui/InlineLoader';
import LoadingButton from '../components/ui/LoadingButton';
import PageShell, { ScrollArea } from '../components/ui/PageShell';
import { useSseRefresh } from '../hooks/useSseRefresh';
import { formatDateTimeJa } from '../utils/formatters';

const LIVE_REFRESH_INTERVAL_MS = 60_000;

interface RequestItem {
  id: number;
  requestText: string;
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
}

interface RequestMessageItem {
  id: number;
  authorType: 'user' | 'openclaw_agent' | 'system' | 'admin';
  messageType: 'message' | 'question' | 'status_update' | 'pr_report';
  body: string;
  createdAt: string | null;
  metadata: Record<string, unknown> | null;
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

export default function MyRequestsPage() {
  const [requests, setRequests] = useState<RequestItem[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState<number | null>(null);
  const [thread, setThread] = useState<RequestThreadResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [replyText, setReplyText] = useState('');
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

  useSseRefresh({
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
    if (!trimmed) {
      setError('返信内容を入力してください');
      return;
    }

    setSending(true);
    setError('');
    setMessage('');
    try {
      const response = await api.post<{ message: string; nextStep?: string }>(`/requests/${selectedRequestId}/messages`, {
        message: trimmed,
      });
      setReplyText('');
      setMessage(response.nextStep ? `${response.message} ${response.nextStep}` : response.message);
      await Promise.all([loadRequests(), loadThread(selectedRequestId)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '返信の送信に失敗しました');
    } finally {
      setSending(false);
    }
  };

  return (
    <PageShell>
      <h4 className="page-title mb-3">ユーザーリクエストとバグ報告</h4>
      {message && <AppAlert variant="success" dismissible onClose={() => setMessage('')}>{message}</AppAlert>}
      {error && <AppAlert variant="danger" dismissible onClose={() => setError('')}>{error}</AppAlert>}

      <ScrollArea>
        <div className="row g-3">
          <div className="col-12 col-lg-4">
            <AppCard>
              <AppCard.Header>要望一覧</AppCard.Header>
              <AppCard.Body>
                <div className="text-muted small mb-3">
                  OpenClaw からの更新を SSE で自動反映し、接続できない場合は約1分ごとに再取得します。
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

          <div className="col-12 col-lg-8">
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
                    <div className="d-flex flex-wrap gap-2 align-items-center">
                      <Badge bg={statusBadge(thread.request.workflowStatus).bg}>{statusBadge(thread.request.workflowStatus).label}</Badge>
                      {thread.request.prUrl && (
                        <a href={thread.request.prUrl} target="_blank" rel="noreferrer" className="small">
                          PR #{thread.request.prNumber ?? '-'} を開く
                        </a>
                      )}
                      {thread.request.branchName && <span className="text-muted small">branch: {thread.request.branchName}</span>}
                    </div>

                    <div className="small text-muted">
                      元の要望: {thread.request.requestText}
                    </div>

                    <div className="d-flex flex-column gap-2">
                      {thread.messages.map((entry) => (
                        <div key={entry.id} className={`border rounded p-3 ${entry.authorType === 'user' ? 'bg-light' : 'bg-white'}`}>
                          <div className="d-flex justify-content-between align-items-center mb-1">
                            <strong className="small">{authorLabel(entry.authorType)}</strong>
                            <span className="text-muted small">{formatDateTimeJa(entry.createdAt)}</span>
                          </div>
                          <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{entry.body}</div>
                        </div>
                      ))}
                    </div>

                    <div className="border-top pt-3">
                      <AppControl
                        as="textarea"
                        rows={4}
                        value={replyText}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReplyText(e.target.value)}
                        placeholder="必要な追加情報や回答を入力"
                      />
                      <div className="d-flex justify-content-end mt-2">
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
