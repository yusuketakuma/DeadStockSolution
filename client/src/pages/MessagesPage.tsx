import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  Badge,
  Button,
  Card,
  Col,
  Form,
  ListGroup,
  Row,
  Spinner,
} from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchThreads,
  fetchThread,
  getMessageAttachmentDownloadUrl,
  sendMessage,
  markThreadRead,
  type Message,
  type MessageAttachment,
  type MessageThread,
} from '../api/messages';
import { notifyMessageNavUpdated } from '../lib/message-nav-events';
import PageShell, { ScrollArea } from '../components/ui/PageShell';

const QUICK_REPLY_TEMPLATES = [
  'ありがとうございます。内容を確認して折り返します。',
  '在庫状況を確認中です。少々お待ちください。',
  '詳細条件をもう少し教えてください。',
  '対応できる見込みです。進めます。',
] as const;

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const isToday =
      d.getFullYear() === now.getFullYear()
      && d.getMonth() === now.getMonth()
      && d.getDate() === now.getDate();
    if (isToday) {
      return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function threadStatusBadge(thread: MessageThread) {
  if (thread.isOverdue) {
    return <Badge bg="warning" text="dark">24時間超</Badge>;
  }
  if (thread.waitingOn === 'me') {
    return <Badge bg="danger">返信待ち</Badge>;
  }
  if (thread.waitingOn === 'them') {
    return <Badge bg="info">相手確認中</Badge>;
  }
  return null;
}

function AttachmentLinks({ attachments }: { attachments: MessageAttachment[] }) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="d-flex flex-column gap-1 mt-2">
      {attachments.map((attachment) => (
        <a
          key={attachment.id}
          href={getMessageAttachmentDownloadUrl(attachment.id)}
          target="_blank"
          rel="noreferrer"
          className="small text-decoration-none"
        >
          添付: {attachment.fileName} ({Math.max(1, Math.round(attachment.fileSize / 1024))}KB)
        </a>
      ))}
    </div>
  );
}

export default function MessagesPage() {
  const { user } = useAuth();
  const myPharmacyId = user?.id ?? 0;

  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [threadsError, setThreadsError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  const [selectedPharmacyId, setSelectedPharmacyId] = useState<number | null>(null);
  const [selectedPharmacyName, setSelectedPharmacyName] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  const [inputBody, setInputBody] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const [showDetail, setShowDetail] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadThreads = useCallback(async (nextSearch: string) => {
    setThreadsLoading(true);
    setThreadsError(null);
    try {
      const res = await fetchThreads(nextSearch || undefined);
      setThreads(res.data);
    } catch (err) {
      setThreadsError(err instanceof Error ? err.message : 'スレッド一覧の取得に失敗しました');
    } finally {
      setThreadsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadThreads(search);
  }, [loadThreads, search]);

  const loadMessages = useCallback(async (pharmacyId: number) => {
    setMessagesLoading(true);
    setMessagesError(null);
    try {
      const res = await fetchThread(pharmacyId);
      const sorted = [...res.data].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      setMessages(sorted);
    } catch (err) {
      setMessagesError(err instanceof Error ? err.message : 'メッセージの取得に失敗しました');
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  useEffect(() => {
    if (threads.length === 0) {
      setSelectedPharmacyId(null);
      setSelectedPharmacyName('');
      setMessages([]);
      return;
    }
    if (selectedPharmacyId && threads.some((thread) => thread.otherPharmacyId === selectedPharmacyId)) {
      return;
    }
    const next = threads[0];
    setSelectedPharmacyId(next.otherPharmacyId);
    setSelectedPharmacyName(next.otherPharmacyName);
  }, [threads, selectedPharmacyId]);

  useEffect(() => {
    if (!selectedPharmacyId) {
      return;
    }
    void loadMessages(selectedPharmacyId);
  }, [selectedPharmacyId, loadMessages]);

  const handleSelectThread = useCallback(
    async (thread: MessageThread) => {
      setSelectedPharmacyId(thread.otherPharmacyId);
      setSelectedPharmacyName(thread.otherPharmacyName);
      setInputBody('');
      setSelectedFiles([]);
      setSendError(null);
      setShowDetail(true);
      await loadMessages(thread.otherPharmacyId);
      try {
        await markThreadRead(thread.otherPharmacyId);
        setThreads((prev) =>
          prev.map((current) =>
            current.otherPharmacyId === thread.otherPharmacyId
              ? { ...current, unreadCount: 0 }
              : current,
          ),
        );
        notifyMessageNavUpdated();
      } catch {
        // ignore optimistic read sync errors
      }
    },
    [loadMessages],
  );

  const handleSend = useCallback(async () => {
    if (!selectedPharmacyId || (!inputBody.trim() && selectedFiles.length === 0)) {
      return;
    }
    setSending(true);
    setSendError(null);
    try {
      await sendMessage(selectedPharmacyId, inputBody.trim(), selectedFiles);
      setInputBody('');
      setSelectedFiles([]);
      await loadMessages(selectedPharmacyId);
      await loadThreads(search);
      notifyMessageNavUpdated();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'メッセージ送信に失敗しました');
    } finally {
      setSending(false);
    }
  }, [inputBody, loadMessages, loadThreads, search, selectedFiles, selectedPharmacyId]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      void handleSend();
    }
  };

  const handleSelectedFilesChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSelectedFiles(Array.from(event.currentTarget.files ?? []));
  };

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.otherPharmacyId === selectedPharmacyId) ?? null,
    [selectedPharmacyId, threads],
  );

  const threadList = (
    <Card>
      <Card.Header className="fw-semibold">メッセージ一覧</Card.Header>
      <Card.Body className="border-bottom">
        <Form
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(searchInput.trim());
          }}
        >
          <div className="d-flex gap-2">
            <Form.Control
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="薬局名・本文で検索"
              aria-label="メッセージ検索"
            />
            <Button type="submit" variant="outline-secondary">検索</Button>
          </div>
        </Form>
      </Card.Body>
      {threadsLoading ? (
        <Card.Body className="d-flex justify-content-center align-items-center">
          <Spinner animation="border" size="sm" />
        </Card.Body>
      ) : threadsError ? (
        <Card.Body>
          <p className="text-danger small mb-1">{threadsError}</p>
          <Button size="sm" variant="outline-secondary" onClick={() => void loadThreads(search)}>
            再読み込み
          </Button>
        </Card.Body>
      ) : threads.length === 0 ? (
        <Card.Body className="text-muted small">
          {search ? '検索条件に一致するメッセージはありません' : 'メッセージはありません'}
        </Card.Body>
      ) : (
        <ListGroup variant="flush">
          {threads.map((thread) => (
            <ListGroup.Item
              key={thread.otherPharmacyId}
              action
              active={selectedPharmacyId === thread.otherPharmacyId}
              onClick={() => void handleSelectThread(thread)}
              className="d-flex justify-content-between align-items-start gap-2"
              style={{ cursor: 'pointer' }}
            >
              <div className="overflow-hidden">
                <div className="fw-semibold text-truncate">{thread.otherPharmacyName}</div>
                <div className="d-flex flex-wrap gap-1 mt-1">
                  {thread.unreadCount > 0 && (
                    <Badge bg="danger" pill>{thread.unreadCount}件未読</Badge>
                  )}
                  {threadStatusBadge(thread)}
                  {thread.hasAttachments && <Badge bg="secondary">添付あり</Badge>}
                </div>
                <div className="text-muted small mt-2 text-truncate" style={{ maxWidth: '220px' }}>
                  {thread.lastMessageBody || '添付ファイル'}
                </div>
              </div>
              <span className="text-muted flex-shrink-0" style={{ fontSize: '0.72rem' }}>
                {formatDateTime(thread.lastMessageAt)}
              </span>
            </ListGroup.Item>
          ))}
        </ListGroup>
      )}
    </Card>
  );

  const messageDetail = (
    <Card>
      <Card.Header className="d-flex align-items-center gap-2">
        <Button
          variant="link"
          size="sm"
          className="d-md-none p-0 text-secondary"
          onClick={() => setShowDetail(false)}
          aria-label="一覧に戻る"
        >
          &#8592;
        </Button>
        <div className="d-flex flex-column">
          <span className="fw-semibold">
            {selectedPharmacyName || 'スレッドを選択してください'}
          </span>
          {selectedThread && (
            <div className="d-flex flex-wrap gap-1 mt-1">
              {threadStatusBadge(selectedThread)}
              {selectedThread.hasAttachments && <Badge bg="secondary">添付あり</Badge>}
            </div>
          )}
        </div>
      </Card.Header>

      <div className="p-3">
        {!selectedPharmacyId ? (
          <p className="text-muted text-center mt-4">左のスレッドを選択してください</p>
        ) : messagesLoading ? (
          <div className="d-flex justify-content-center mt-4">
            <Spinner animation="border" size="sm" />
          </div>
        ) : messagesError ? (
          <p className="text-danger small">{messagesError}</p>
        ) : messages.length === 0 ? (
          <p className="text-muted small text-center mt-4">まだメッセージがありません</p>
        ) : (
          messages.map((message) => {
            const isMine = message.fromPharmacyId === myPharmacyId;
            return (
              <div
                key={message.id}
                className={`d-flex mb-2 ${isMine ? 'justify-content-end' : 'justify-content-start'}`}
              >
                <div
                  className={`px-3 py-2 rounded-3 ${
                    isMine ? 'bg-primary text-white' : 'bg-light text-dark border'
                  }`}
                  style={{ maxWidth: '78%', wordBreak: 'break-word' }}
                >
                  {message.body ? (
                    <div style={{ fontSize: '0.95rem', whiteSpace: 'pre-wrap' }}>{message.body}</div>
                  ) : (
                    <div className={isMine ? 'text-white-50' : 'text-muted'} style={{ fontSize: '0.9rem' }}>
                      添付ファイル
                    </div>
                  )}
                  <AttachmentLinks attachments={message.attachments} />
                  <div
                    className={`text-end mt-1 ${isMine ? 'text-white-50' : 'text-muted'}`}
                    style={{ fontSize: '0.7rem' }}
                  >
                    {formatDateTime(message.createdAt)}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {selectedPharmacyId && (
        <Card.Footer className="bg-white border-top">
          <div className="d-flex flex-wrap gap-2 mb-2">
            {QUICK_REPLY_TEMPLATES.map((template) => (
              <Button
                key={template}
                type="button"
                size="sm"
                variant="outline-secondary"
                onClick={() => setInputBody(template)}
              >
                {template}
              </Button>
            ))}
          </div>
          {sendError && <p className="text-danger small mb-1">{sendError}</p>}
          <Form
            onSubmit={(event) => {
              event.preventDefault();
              void handleSend();
            }}
          >
            <div className="d-flex flex-column gap-2">
              <Form.Control
                as="textarea"
                rows={3}
                value={inputBody}
                onChange={(event) => setInputBody(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="メッセージを入力（Ctrl+Enter で送信）"
                disabled={sending}
                style={{ resize: 'none' }}
                aria-label="メッセージ本文"
              />
              <div className="d-flex flex-column flex-md-row gap-2 justify-content-between align-items-md-center">
                <div className="d-flex flex-column gap-1">
                  <Form.Control
                    type="file"
                    multiple
                    onChange={handleSelectedFilesChange}
                    aria-label="添付ファイル"
                  />
                  {selectedFiles.length > 0 && (
                    <div className="small text-muted">
                      {selectedFiles.map((file) => file.name).join(', ')}
                    </div>
                  )}
                </div>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={sending || (!inputBody.trim() && selectedFiles.length === 0)}
                  style={{ minWidth: '88px' }}
                >
                  {sending ? <Spinner animation="border" size="sm" /> : '送信'}
                </Button>
              </div>
            </div>
          </Form>
        </Card.Footer>
      )}
    </Card>
  );

  return (
    <PageShell>
      <div className="dl-page-header">
        <div className="dl-page-header-copy">
          <h4 className="page-title mb-0">薬局間メッセージ</h4>
          <div className="text-muted small">一覧と会話を device 幅に合わせて切り替えます。</div>
        </div>
      </div>

      <ScrollArea>
        <Row className="d-none d-lg-flex g-3">
          <Col lg={4}>{threadList}</Col>
          <Col lg={8}>{messageDetail}</Col>
        </Row>

        <div className="d-lg-none">
          {showDetail ? messageDetail : threadList}
        </div>
      </ScrollArea>
    </PageShell>
  );
}
