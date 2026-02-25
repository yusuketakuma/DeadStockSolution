import { Button, Collapse, OverlayTrigger, Popover, Spinner } from 'react-bootstrap';
import type { GitHubUpdatesResponse } from '../Header';

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

interface AppUpdatesPopoverProps {
  updatesLoading: boolean;
  updatesError: string;
  updatesData: GitHubUpdatesResponse | null;
  popoverOpen: boolean;
  historyOpen: boolean;
  onToggle: (nextOpen: boolean) => void;
  onHistoryToggle: () => void;
  onRetry: () => void;
}

export default function AppUpdatesPopover({
  updatesLoading,
  updatesError,
  updatesData,
  popoverOpen,
  historyOpen,
  onToggle,
  onHistoryToggle,
  onRetry,
}: AppUpdatesPopoverProps) {
  const latestUpdate = updatesData?.items[0] ?? null;
  const historicalUpdates = updatesData?.items.slice(1) ?? [];

  return (
    <OverlayTrigger
      trigger="click"
      placement="bottom"
      rootClose
      show={popoverOpen}
      onToggle={onToggle}
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
                <Button variant="outline-primary" size="sm" onClick={onRetry}>
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
                  onClick={onHistoryToggle}
                  aria-expanded={historyOpen}
                  aria-controls="app-updates-history-list"
                >
                  {historyOpen ? '履歴を閉じる' : '過去のアップデート履歴を表示'}
                </Button>
                <Collapse in={historyOpen} mountOnEnter unmountOnExit>
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
  );
}
