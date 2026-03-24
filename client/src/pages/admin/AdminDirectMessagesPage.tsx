import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Badge, Col, Row } from 'react-bootstrap';
import { api, buildApiUrl } from '../../api/client';
import Pagination from '../../components/Pagination';
import AppCard from '../../components/ui/AppCard';
import AppEmptyState from '../../components/ui/AppEmptyState';
import AppField from '../../components/ui/AppField';
import ErrorRetryAlert from '../../components/ui/ErrorRetryAlert';
import InlineLoader from '../../components/ui/InlineLoader';
import PageShell, { ScrollArea } from '../../components/ui/PageShell';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { formatDateTimeJa } from '../../utils/formatters';

interface AdminDirectMessageThread {
  pharmacyAId: number;
  pharmacyAName: string;
  pharmacyBId: number;
  pharmacyBName: string;
  lastMessage: string;
  lastMessageAt: string;
  lastMessageSenderId: number;
  messageCount: number;
  waitingOn: string | null;
  isOverdue: boolean;
  hasAttachments: boolean;
}

interface AdminDirectMessage {
  id: number;
  fromPharmacyId: number;
  toPharmacyId: number;
  body: string;
  isRead: boolean;
  createdAt: string;
  attachments: Array<{
    id: number;
    fileName: string;
    mimeType: string;
    fileSize: number;
  }>;
}

interface AdminDirectMessageThreadResponse {
  data: AdminDirectMessageThread[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface AdminDirectMessageDetailResponse {
  thread: {
    pharmacyAId: number;
    pharmacyAName: string;
    pharmacyBId: number;
    pharmacyBName: string;
  };
  data: AdminDirectMessage[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

function buildThreadKey(pharmacyAId: number, pharmacyBId: number): string {
  return `${pharmacyAId}:${pharmacyBId}`;
}

export default function AdminDirectMessagesPage() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [selectedThreadKey, setSelectedThreadKey] = useState<string | null>(null);
  const [threadPage, setThreadPage] = useState(1);
  const [threadReloadKey, setThreadReloadKey] = useState(0);
  const [threadResponse, setThreadResponse] = useState<AdminDirectMessageDetailResponse | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState('');

  const {
    items: threads,
    page,
    setPage,
    totalPages,
    loading,
    error,
    fetchPage,
    retry,
  } = usePaginatedList<AdminDirectMessageThread, AdminDirectMessageThreadResponse>(
    (targetPage, signal) => {
      const params = new URLSearchParams({
        page: String(targetPage),
        limit: '20',
      });
      if (search) {
        params.set('search', search);
      }
      return api.get<AdminDirectMessageThreadResponse>(`/admin/direct-messages/threads?${params}`, { signal });
    },
    { errorMessage: 'ユーザー間メッセージ一覧の取得に失敗しました' },
  );

  useEffect(() => {
    if (threads.length === 0) {
      setSelectedThreadKey(null);
      setThreadResponse(null);
      return;
    }

    setSelectedThreadKey((current) => {
      if (current && threads.some((item) => buildThreadKey(item.pharmacyAId, item.pharmacyBId) === current)) {
        return current;
      }
      const first = threads[0];
      return buildThreadKey(first.pharmacyAId, first.pharmacyBId);
    });
  }, [threads]);

  useEffect(() => {
    if (!selectedThreadKey) {
      setThreadResponse(null);
      return;
    }

    const [pharmacyAIdText, pharmacyBIdText] = selectedThreadKey.split(':');
    const pharmacyAId = Number(pharmacyAIdText);
    const pharmacyBId = Number(pharmacyBIdText);
    if (!Number.isInteger(pharmacyAId) || !Number.isInteger(pharmacyBId)) {
      setThreadError('対象スレッドの識別子が不正です');
      return;
    }

    const controller = new AbortController();
    setThreadLoading(true);
    setThreadError('');
    void api.get<AdminDirectMessageDetailResponse>(
      `/admin/direct-messages/thread?pharmacyAId=${pharmacyAId}&pharmacyBId=${pharmacyBId}&page=${threadPage}&limit=100`,
      { signal: controller.signal },
    )
      .then((response) => {
        setThreadResponse(response);
      })
      .catch((err) => {
        if (controller.signal.aborted) {
          return;
        }
        setThreadError(err instanceof Error ? err.message : 'ユーザー間メッセージ履歴の取得に失敗しました');
        setThreadResponse(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setThreadLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [selectedThreadKey, threadPage, threadReloadKey]);

  const orderedMessages = useMemo(() => {
    if (!threadResponse) {
      return [];
    }
    return [...threadResponse.data].reverse();
  }, [threadResponse]);

  const handleSearch = (event: FormEvent) => {
    event.preventDefault();
    const nextSearch = searchInput.trim();
    if (search === nextSearch && page === 1) {
      void fetchPage(1, { force: true });
      return;
    }
    setSearch(nextSearch);
    setPage(1);
  };

  const attachmentUrl = (attachmentId: number) =>
    buildApiUrl(`/admin/direct-messages/attachments/${attachmentId}`);

  return (
    <PageShell>
      <div className="dl-page-header">
        <div className="dl-page-header-copy">
          <h4 className="page-title mb-0">ユーザー間メッセージ確認</h4>
          <div className="text-muted small">tablet までは 1 カラム、広い画面では一覧と会話を横に並べます。</div>
        </div>
      </div>

      <form className="mb-3" onSubmit={handleSearch}>
        <Row className="g-2 align-items-end">
          <Col xs={12} md={7} lg={6}>
            <AppField
              label="薬局名で絞り込み"
              value={searchInput}
              onChange={(value) => setSearchInput(value)}
              placeholder="例: みどり薬局"
            />
          </Col>
          <Col xs={12} md="auto">
            <button type="submit" className="btn btn-primary">検索</button>
          </Col>
        </Row>
      </form>

      {error && <ErrorRetryAlert error={error} onRetry={() => void retry()} />}

      <ScrollArea>
        <Row className="g-3">
          <Col xs={12} xl={4}>
            <AppCard className="h-100">
              <AppCard.Header>スレッド一覧</AppCard.Header>
              <AppCard.Body>
                {loading ? (
                  <InlineLoader text="スレッド一覧を読み込み中..." className="text-muted small" />
                ) : threads.length === 0 ? (
                  <AppEmptyState
                    title="対象スレッドがありません"
                    description="該当するユーザー間メッセージはまだありません。"
                  />
                ) : (
                  <div className="d-flex flex-column gap-2">
                    {threads.map((thread) => {
                      const threadKey = buildThreadKey(thread.pharmacyAId, thread.pharmacyBId);
                      return (
                        <button
                          key={threadKey}
                          type="button"
                          className={`btn text-start border ${selectedThreadKey === threadKey ? 'border-primary bg-light' : 'border-light-subtle'}`}
                          onClick={() => {
                            setSelectedThreadKey(threadKey);
                            setThreadPage(1);
                          }}
                        >
                          <div className="d-flex justify-content-between align-items-start gap-2">
                            <strong>{thread.pharmacyAName}</strong>
                            <div className="d-flex flex-wrap justify-content-end gap-1">
                              <Badge bg="secondary">{thread.messageCount}件</Badge>
                              {thread.isOverdue && <Badge bg="warning" text="dark">24時間超</Badge>}
                              {thread.hasAttachments && <Badge bg="dark">添付</Badge>}
                            </div>
                          </div>
                          <div className="small text-muted">↔ {thread.pharmacyBName}</div>
                          {thread.waitingOn && (
                            <div className="small mt-1 text-muted">待機先: {thread.waitingOn}</div>
                          )}
                          <div className="small mt-2" style={{ whiteSpace: 'pre-wrap' }}>{thread.lastMessage}</div>
                          <div className="text-muted small mt-2">{formatDateTimeJa(thread.lastMessageAt)}</div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </AppCard.Body>
            </AppCard>
            <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
          </Col>

          <Col xs={12} xl={8}>
            <AppCard className="h-100">
              <AppCard.Header>会話内容</AppCard.Header>
              <AppCard.Body>
                {!selectedThreadKey ? (
                  <AppEmptyState
                    title="確認するスレッドを選択してください"
                    description="左の一覧から対象のユーザー間メッセージを選ぶと詳細を表示します。"
                  />
                ) : threadLoading ? (
                  <InlineLoader text="会話内容を読み込み中..." className="text-muted small" />
                ) : threadError ? (
                  <ErrorRetryAlert error={threadError} onRetry={() => setThreadReloadKey((current) => current + 1)} />
                ) : !threadResponse ? (
                  <AppEmptyState
                    title="会話内容を表示できません"
                    description="対象スレッドの読み込みに失敗しました。"
                  />
                ) : (
                  <div className="d-flex flex-column gap-3">
                    <div className="border rounded p-3 bg-light">
                      <div className="fw-semibold">
                        {threadResponse.thread.pharmacyAName} ↔ {threadResponse.thread.pharmacyBName}
                      </div>
                      <div className="text-muted small mt-1">
                        表示中: {threadResponse.pagination.total}件
                      </div>
                    </div>

                    {orderedMessages.length === 0 ? (
                      <AppEmptyState
                        title="メッセージはまだありません"
                        description="このスレッドには表示対象のメッセージがありません。"
                      />
                    ) : (
                      <div className="d-flex flex-column gap-2">
                        {orderedMessages.map((message) => {
                          const attachments = message.attachments ?? [];
                          const senderName = message.fromPharmacyId === threadResponse.thread.pharmacyAId
                            ? threadResponse.thread.pharmacyAName
                            : threadResponse.thread.pharmacyBName;
                          const recipientName = message.toPharmacyId === threadResponse.thread.pharmacyAId
                            ? threadResponse.thread.pharmacyAName
                            : threadResponse.thread.pharmacyBName;
                          return (
                            <div key={message.id} className="border rounded p-3">
                              <div className="d-flex justify-content-between align-items-center gap-2 mb-1">
                                <strong className="small">{senderName} → {recipientName}</strong>
                                <span className="text-muted small">{formatDateTimeJa(message.createdAt)}</span>
                              </div>
                              {message.body ? (
                                <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{message.body}</div>
                              ) : (
                                <div className="small text-muted">添付ファイル</div>
                              )}
                              {attachments.length > 0 && (
                                <div className="d-flex flex-column gap-1 mt-2">
                                  {attachments.map((attachment) => (
                                    <a
                                      key={attachment.id}
                                      href={attachmentUrl(attachment.id)}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="small text-decoration-none"
                                    >
                                      添付: {attachment.fileName}
                                    </a>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <Pagination
                      currentPage={threadPage}
                      totalPages={threadResponse.pagination.totalPages}
                      onPageChange={setThreadPage}
                    />
                  </div>
                )}
              </AppCard.Body>
            </AppCard>
          </Col>
        </Row>
      </ScrollArea>
    </PageShell>
  );
}
