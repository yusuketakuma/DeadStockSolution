import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Collapse, Form, Modal, OverlayTrigger, Popover, Spinner } from 'react-bootstrap';
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

interface GitHubUpdateItem {
  id: string;
  tag: string;
  title: string;
  body: string;
  url: string;
  publishedAt: string | null;
  prerelease: boolean;
}

interface GitHubUpdatesResponse {
  repository: string;
  source: 'github_releases';
  stale: boolean;
  fetchedAt: string;
  items: GitHubUpdateItem[];
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

function formatUpdateDate(value: string | null): string {
  if (!value) return '日付不明';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '日付不明';
  return date.toLocaleDateString('ja-JP');
}

function formatUpdateDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ja-JP');
}

function summarizeUpdateBody(body: string): string {
  const normalized = body.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > 180 ? `${normalized.slice(0, 180)}...` : normalized;
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
  const [updatesPopoverOpen, setUpdatesPopoverOpen] = useState(false);
  const [updatesLoading, setUpdatesLoading] = useState(false);
  const [updatesError, setUpdatesError] = useState('');
  const [updatesData, setUpdatesData] = useState<GitHubUpdatesResponse | null>(null);
  const [updatesHistoryOpen, setUpdatesHistoryOpen] = useState(false);

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

  const loadGitHubUpdates = async () => {
    setUpdatesLoading(true);
    setUpdatesError('');
    try {
      const result = await api.get<GitHubUpdatesResponse>('/updates/github');
      setUpdatesData(result);
    } catch (err) {
      setUpdatesError(err instanceof Error ? err.message : 'アップデートの取得に失敗しました');
    } finally {
      setUpdatesLoading(false);
    }
  };

  const handleUpdatesPopoverToggle = (nextOpen: boolean) => {
    setUpdatesPopoverOpen(nextOpen);
    if (!nextOpen) {
      setUpdatesHistoryOpen(false);
      return;
    }
    if (!updatesLoading) {
      void loadGitHubUpdates();
    }
  };

  const handleRetryUpdates = () => {
    void loadGitHubUpdates();
  };

  const latestUpdate = updatesData?.items[0] ?? null;
  const historicalUpdates = updatesData?.items.slice(1) ?? [];

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
          <div className="app-header-brand-meta">
            <Link to="/" className="app-header-brand">
              <span>DeadStockSolution</span>
              <span className="app-header-version">{APP_VERSION}</span>
            </Link>
            <OverlayTrigger
              trigger="click"
              placement="bottom"
              rootClose
              show={updatesPopoverOpen}
              onToggle={handleUpdatesPopoverToggle}
              overlay={(
                <Popover id="app-header-updates-popover" className="app-updates-popover">
                  <Popover.Header as="h3">アップデート内容</Popover.Header>
                  <Popover.Body>
                    {updatesLoading && (
                      <div className="app-updates-loading">
                        <Spinner animation="border" size="sm" role="status" />
                        <span>GitHubから更新情報を取得中...</span>
                      </div>
                    )}
                    {!updatesLoading && updatesError && (
                      <div className="app-updates-error-wrap">
                        <p className="app-updates-error-text">{updatesError}</p>
                        <Button variant="outline-primary" size="sm" onClick={handleRetryUpdates}>
                          再読み込み
                        </Button>
                      </div>
                    )}
                    {!updatesLoading && !updatesError && latestUpdate && (
                      <div className="app-updates-latest">
                        <a
                          href={latestUpdate.url}
                          target="_blank"
                          rel="noreferrer"
                          className="app-updates-item-title"
                        >
                          <span className="app-updates-item-tag">{latestUpdate.tag}</span>
                          <span>{latestUpdate.title}</span>
                        </a>
                        <small className="text-muted">{formatUpdateDate(latestUpdate.publishedAt)}</small>
                        {latestUpdate.body && (
                          <p className="app-updates-item-body">{summarizeUpdateBody(latestUpdate.body)}</p>
                        )}
                      </div>
                    )}
                    {!updatesLoading && !updatesError && !latestUpdate && (
                      <p className="app-updates-empty">公開済みアップデートはまだありません。</p>
                    )}
                    {!updatesLoading && !updatesError && updatesData?.stale && (
                      <p className="app-updates-stale-note">
                        GitHubの取得に失敗したため、{formatUpdateDateTime(updatesData.fetchedAt)} 時点のキャッシュを表示しています。
                      </p>
                    )}
                    {!updatesLoading && !updatesError && historicalUpdates.length > 0 && (
                      <div className="app-updates-history">
                        <Button
                          type="button"
                          variant="link"
                          className="app-updates-history-toggle"
                          onClick={() => setUpdatesHistoryOpen((prev) => !prev)}
                          aria-expanded={updatesHistoryOpen}
                          aria-controls="app-updates-history-list"
                        >
                          {updatesHistoryOpen ? '履歴を閉じる' : '過去のアップデート履歴を表示'}
                        </Button>
                        <Collapse in={updatesHistoryOpen} mountOnEnter unmountOnExit>
                          <div
                            id="app-updates-history-list"
                            className="app-updates-history-list"
                            role="region"
                            aria-label="過去のアップデート履歴"
                          >
                            <ul className="app-updates-list">
                              {historicalUpdates.map((item) => (
                                <li key={item.id} className="app-updates-list-item">
                                  <a
                                    href={item.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="app-updates-item-title"
                                  >
                                    <span className="app-updates-item-tag">{item.tag}</span>
                                    <span>{item.title}</span>
                                  </a>
                                  <small className="text-muted">{formatUpdateDate(item.publishedAt)}</small>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </Collapse>
                      </div>
                    )}
                  </Popover.Body>
                </Popover>
              )}
            >
              <Button
                type="button"
                variant="link"
                className="app-header-updates-trigger"
                aria-label="GitHub更新内容を表示"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  data-testid="updates-trigger-icon"
                >
                  <path d="m12 2.75 2.12 4.63 4.63 2.12-4.63 2.12L12 16.25l-2.12-4.63-4.63-2.12 4.63-2.12L12 2.75Z" />
                  <path d="m19 13.75.95 2.05 2.05.95-2.05.95L19 19.75l-.95-2.05-2.05-.95 2.05-.95L19 13.75Z" />
                  <path d="m5 14.75.72 1.53 1.53.72-1.53.72L5 19.25l-.72-1.53-1.53-.72 1.53-.72L5 14.75Z" />
                </svg>
              </Button>
            </OverlayTrigger>
          </div>
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
