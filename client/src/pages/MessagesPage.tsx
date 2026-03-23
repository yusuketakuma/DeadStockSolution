import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Col,
  Container,
  Form,
  ListGroup,
  Row,
  Spinner,
} from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchThreads,
  fetchThread,
  sendMessage,
  markThreadRead,
  type Message,
  type MessageThread,
} from '../api/messages';

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const isToday =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (isToday) {
      return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
  } catch {
    return '';
  }
}

export default function MessagesPage() {
  const { user } = useAuth();
  const myPharmacyId = user?.id ?? 0;

  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [threadsLoading, setThreadsLoading] = useState(true);
  const [threadsError, setThreadsError] = useState<string | null>(null);

  const [selectedPharmacyId, setSelectedPharmacyId] = useState<number | null>(null);
  const [selectedPharmacyName, setSelectedPharmacyName] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);

  const [inputBody, setInputBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // モバイル: スレッド一覧表示中か詳細表示中か
  const [showDetail, setShowDetail] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadThreads = useCallback(async () => {
    setThreadsLoading(true);
    setThreadsError(null);
    try {
      const res = await fetchThreads();
      setThreads(res.data);
    } catch (err) {
      setThreadsError(err instanceof Error ? err.message : 'スレッド一覧の取得に失敗しました');
    } finally {
      setThreadsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  const loadMessages = useCallback(async (pharmacyId: number) => {
    setMessagesLoading(true);
    setMessagesError(null);
    try {
      const res = await fetchThread(pharmacyId);
      // APIは新しい順で返す可能性があるため、古い順に並べ替える
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

  const handleSelectThread = useCallback(
    async (thread: MessageThread) => {
      setSelectedPharmacyId(thread.otherPharmacyId);
      setSelectedPharmacyName(thread.otherPharmacyName);
      setInputBody('');
      setSendError(null);
      setShowDetail(true);
      await loadMessages(thread.otherPharmacyId);
      // 既読化
      try {
        await markThreadRead(thread.otherPharmacyId);
        setThreads((prev) =>
          prev.map((t) =>
            t.otherPharmacyId === thread.otherPharmacyId ? { ...t, unreadCount: 0 } : t,
          ),
        );
      } catch {
        // 既読化失敗は非致命的
      }
    },
    [loadMessages],
  );

  // メッセージ末尾にスクロール
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleSend = useCallback(async () => {
    if (!selectedPharmacyId || !inputBody.trim()) return;
    setSending(true);
    setSendError(null);
    try {
      await sendMessage(selectedPharmacyId, inputBody.trim());
      setInputBody('');
      await loadMessages(selectedPharmacyId);
      await loadThreads();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'メッセージ送信に失敗しました');
    } finally {
      setSending(false);
    }
  }, [selectedPharmacyId, inputBody, loadMessages, loadThreads]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      void handleSend();
    }
  };

  const ThreadList = (
    <Card className="h-100">
      <Card.Header className="fw-semibold">メッセージ一覧</Card.Header>
      {threadsLoading ? (
        <Card.Body className="d-flex justify-content-center align-items-center">
          <Spinner animation="border" size="sm" />
        </Card.Body>
      ) : threadsError ? (
        <Card.Body>
          <p className="text-danger small mb-1">{threadsError}</p>
          <Button size="sm" variant="outline-secondary" onClick={() => void loadThreads()}>
            再読み込み
          </Button>
        </Card.Body>
      ) : threads.length === 0 ? (
        <Card.Body className="text-muted small">メッセージはありません</Card.Body>
      ) : (
        <ListGroup variant="flush">
          {threads.map((t) => (
            <ListGroup.Item
              key={t.otherPharmacyId}
              action
              active={selectedPharmacyId === t.otherPharmacyId}
              onClick={() => void handleSelectThread(t)}
              className="d-flex justify-content-between align-items-start"
              style={{ cursor: 'pointer' }}
            >
              <div className="me-2 overflow-hidden">
                <div className="fw-semibold text-truncate">{t.otherPharmacyName}</div>
                <div
                  className="text-muted small text-truncate"
                  style={{ maxWidth: '180px' }}
                >
                  {t.lastMessageBody}
                </div>
              </div>
              <div className="d-flex flex-column align-items-end gap-1 flex-shrink-0">
                <span className="text-muted" style={{ fontSize: '0.7rem' }}>
                  {formatDateTime(t.lastMessageAt)}
                </span>
                {t.unreadCount > 0 && (
                  <Badge bg="danger" pill>
                    {t.unreadCount}
                  </Badge>
                )}
              </div>
            </ListGroup.Item>
          ))}
        </ListGroup>
      )}
    </Card>
  );

  const MessageDetail = (
    <Card className="h-100 d-flex flex-column">
      <Card.Header className="d-flex align-items-center gap-2">
        {/* モバイル: 戻るボタン */}
        <Button
          variant="link"
          size="sm"
          className="d-md-none p-0 text-secondary"
          onClick={() => setShowDetail(false)}
          aria-label="一覧に戻る"
        >
          &#8592;
        </Button>
        <span className="fw-semibold">
          {selectedPharmacyName || 'スレッドを選択してください'}
        </span>
      </Card.Header>

      {/* メッセージエリア */}
      <div
        className="flex-grow-1 overflow-auto p-3"
        style={{ minHeight: 0, maxHeight: '55vh' }}
      >
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
          messages.map((msg) => {
            const isMine = msg.fromPharmacyId === myPharmacyId;
            return (
              <div
                key={msg.id}
                className={`d-flex mb-2 ${isMine ? 'justify-content-end' : 'justify-content-start'}`}
              >
                <div
                  className={`px-3 py-2 rounded-3 text-wrap ${
                    isMine ? 'bg-primary text-white' : 'bg-light text-dark border'
                  }`}
                  style={{ maxWidth: '70%', wordBreak: 'break-word' }}
                >
                  <div style={{ fontSize: '0.95rem' }}>{msg.body}</div>
                  <div
                    className={`text-end mt-1 ${isMine ? 'text-white-50' : 'text-muted'}`}
                    style={{ fontSize: '0.7rem' }}
                  >
                    {formatDateTime(msg.createdAt)}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 送信フォーム */}
      {selectedPharmacyId && (
        <Card.Footer className="bg-white border-top">
          {sendError && <p className="text-danger small mb-1">{sendError}</p>}
          <Form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSend();
            }}
          >
            <div className="d-flex gap-2">
              <Form.Control
                as="textarea"
                rows={2}
                value={inputBody}
                onChange={(e) => setInputBody(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="メッセージを入力（Ctrl+Enter で送信）"
                disabled={sending}
                style={{ resize: 'none' }}
                aria-label="メッセージ本文"
              />
              <Button
                type="submit"
                variant="primary"
                disabled={sending || !inputBody.trim()}
                style={{ minWidth: '72px' }}
              >
                {sending ? <Spinner animation="border" size="sm" /> : '送信'}
              </Button>
            </div>
          </Form>
        </Card.Footer>
      )}
    </Card>
  );

  return (
    <Container fluid className="py-3" style={{ height: 'calc(100vh - 60px)' }}>
      {/* デスクトップ: 左右分割レイアウト */}
      <Row className="h-100 d-none d-md-flex g-3">
        <Col md={4} className="h-100">
          {ThreadList}
        </Col>
        <Col md={8} className="h-100">
          {MessageDetail}
        </Col>
      </Row>

      {/* モバイル: 一覧 ↔ 詳細の切り替え */}
      <div className="d-md-none h-100">
        {showDetail ? MessageDetail : ThreadList}
      </div>
    </Container>
  );
}
