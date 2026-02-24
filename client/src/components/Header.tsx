import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Form, Modal } from 'react-bootstrap';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api/client';
import { APP_VERSION } from '../constants/appVersion';
import { useAuth } from '../contexts/AuthContext';

interface Props {
  onToggleSidebar: () => void;
}

interface QuickAction {
  to: string;
  label: string;
}

const PATH_TRACK_CURRENT_KEY = 'dss.currentPath';
const PATH_TRACK_PREV_KEY = 'dss.previousPath';
const HIDDEN_PATH_PREFIXES = ['/login', '/register', '/password-reset'];
const USER_QUICK_ACTIONS: QuickAction[] = [
  { to: '/upload', label: 'アップロード' },
  { to: '/matching', label: 'マッチング' },
  { to: '/proposals', label: '提案確認' },
];
const ADMIN_QUICK_ACTIONS: QuickAction[] = [
  { to: '/admin/openclaw', label: '要望対応' },
  { to: '/admin/drug-master', label: 'マスター管理' },
  { to: '/admin/logs', label: '操作ログ' },
];

function isTrackablePath(pathname: string): boolean {
  return !HIDDEN_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export default function Header({ onToggleSidebar }: Props) {
  const { user } = useAuth();
  const location = useLocation();
  const [previousPath, setPreviousPath] = useState('');
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [requestText, setRequestText] = useState('');
  const [requestError, setRequestError] = useState('');
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestMessage, setRequestMessage] = useState('');

  useEffect(() => {
    const nextPath = `${location.pathname}${location.search}${location.hash}`;
    if (!isTrackablePath(location.pathname)) return;

    const current = window.localStorage.getItem(PATH_TRACK_CURRENT_KEY) ?? '';
    if (current && current !== nextPath) {
      window.localStorage.setItem(PATH_TRACK_PREV_KEY, current);
    }
    window.localStorage.setItem(PATH_TRACK_CURRENT_KEY, nextPath);

    const prev = window.localStorage.getItem(PATH_TRACK_PREV_KEY) ?? '';
    setPreviousPath(prev && prev !== nextPath ? prev : '');
  }, [location.pathname, location.search, location.hash]);

  const quickActions = useMemo(() => {
    const source = user?.isAdmin ? ADMIN_QUICK_ACTIONS : USER_QUICK_ACTIONS;
    return source.filter((item) => !location.pathname.startsWith(item.to)).slice(0, 2);
  }, [location.pathname, user?.isAdmin]);

  const openRequestModal = () => {
    setRequestError('');
    setRequestMessage('');
    setRequestModalOpen(true);
  };

  const closeRequestModal = () => {
    if (requestSubmitting) return;
    setRequestModalOpen(false);
  };

  const handleRequestSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const message = requestText.trim();
    if (!message) {
      setRequestError('要望内容を入力してください');
      return;
    }
    if (message.length > 2000) {
      setRequestError('要望は2000文字以内で入力してください');
      return;
    }

    setRequestSubmitting(true);
    setRequestError('');
    try {
      const result = await api.post<{ message?: string; nextStep?: string }>('/requests', { message });
      const detail = result.nextStep ? ` ${result.nextStep}` : '';
      setRequestMessage(`${result.message ?? '要望を受け付けました。'}${detail}`);
      setRequestText('');
      setRequestModalOpen(false);
    } catch (err) {
      setRequestError(err instanceof Error ? err.message : '要望の送信に失敗しました');
    } finally {
      setRequestSubmitting(false);
    }
  };

  return (
    <header className="app-header">
      <div className="app-header-main">
        <Button
          variant="link"
          className="sidebar-toggle d-lg-none text-white p-0 me-3"
          onClick={onToggleSidebar}
          aria-label="メニューを開く"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </Button>
        <div className="app-header-brand-group">
          <Link to="/" className="app-header-brand">
            <span>DeadStockSolution</span>
            <span className="app-header-version">{APP_VERSION}</span>
          </Link>
          {!user?.isAdmin && (
            <Button
              type="button"
              variant="outline-light"
              size="sm"
              className="app-header-request-btn"
              onClick={openRequestModal}
            >
              要望をあげる
            </Button>
          )}
        </div>

        <div className="app-header-quick ms-auto d-none d-lg-flex">
          {requestMessage && (
            <span className="app-header-request-message" role="status">{requestMessage}</span>
          )}
          {previousPath && (
            <Link to={previousPath} className="app-header-quick-link app-header-quick-link-muted">
              前回の画面へ戻る
            </Link>
          )}
          {quickActions.map((action) => (
            <Link key={action.to} to={action.to} className="app-header-quick-link">
              {action.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="app-header-quick-mobile d-lg-none" aria-label="ヘッダークイック導線">
        {requestMessage && (
          <span className="app-header-request-message" role="status">{requestMessage}</span>
        )}
        {previousPath && (
          <Link to={previousPath} className="app-header-quick-link app-header-quick-link-muted">
            前回の画面へ戻る
          </Link>
        )}
        {quickActions.map((action) => (
          <Link key={`mobile-${action.to}`} to={action.to} className="app-header-quick-link">
            {action.label}
          </Link>
        ))}
      </div>

      <Modal show={requestModalOpen} onHide={closeRequestModal} centered>
        <Modal.Header closeButton>
          <Modal.Title>要望をあげる</Modal.Title>
        </Modal.Header>
        <Form onSubmit={handleRequestSubmit}>
          <Modal.Body>
            {requestError && <Alert variant="danger">{requestError}</Alert>}
            <Form.Group controlId="request-message">
              <Form.Label>要望内容</Form.Label>
              <Form.Control
                as="textarea"
                rows={5}
                maxLength={2000}
                value={requestText}
                onChange={(event) => setRequestText(event.target.value)}
                placeholder="改善してほしい点、困っていることを入力してください"
                required
              />
              <Form.Text className="text-muted">
                {requestText.length}/2000 文字
              </Form.Text>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" type="button" onClick={closeRequestModal} disabled={requestSubmitting}>
              閉じる
            </Button>
            <Button variant="primary" type="submit" disabled={requestSubmitting}>
              {requestSubmitting ? '送信中...' : '送信する'}
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </header>
  );
}
