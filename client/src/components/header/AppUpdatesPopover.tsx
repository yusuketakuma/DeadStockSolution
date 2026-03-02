import { Collapse, OverlayTrigger, Popover } from 'react-bootstrap';
import AppButton from '../ui/AppButton';
import InlineLoader from '../ui/InlineLoader';
import type { GitHubUpdatesResponse } from '../Header';
import { formatDateJa, formatDateTimeJa, truncatePreview } from '../../utils/formatters';

function formatUpdateDate(value: string | null): string {
  return formatDateJa(value, '日付不明');
}

function formatUpdateDateTime(value: string): string {
  return formatDateTimeJa(value, value);
}

const RELEASE_HOST_ALLOWLIST = new Set(['github.com', 'www.github.com']);

function normalizeRepository(repository: string): string | null {
  const normalized = repository.trim().replace(/^\/+|\/+$/g, '');
  if (!normalized) return null;
  const [owner, name, ...rest] = normalized.split('/');
  if (rest.length > 0) return null;
  if (!owner || !name) return null;
  return `${owner}/${name}`;
}

function sanitizeReleaseUrl(rawUrl: string, repository: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return null;
    if (!RELEASE_HOST_ALLOWLIST.has(parsed.hostname.toLowerCase())) return null;
    if (!parsed.pathname.startsWith(`/${repository}/releases/`)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
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
  const trustedRepository = normalizeRepository(updatesData?.repository ?? '');

  const latestUpdateUrl = latestUpdate && trustedRepository
    ? sanitizeReleaseUrl(latestUpdate.url, trustedRepository)
    : null;
  const hasBlockedUrls = Boolean(
    trustedRepository &&
      updatesData?.items.some((item) => sanitizeReleaseUrl(item.url, trustedRepository) === null),
  );

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
                <InlineLoader text="GitHubから更新情報を取得中..." />
              </div>
            )}
            {!updatesLoading && updatesError && (
              <div className="app-updates-error-wrap">
                <p className="app-updates-error-text">{updatesError}</p>
                <AppButton variant="outline-primary" size="sm" onClick={onRetry}>
                  再読み込み
                </AppButton>
              </div>
            )}
            {!updatesLoading && !updatesError && latestUpdate && (
              <div className="app-updates-latest">
                {latestUpdateUrl ? (
                  <a
                    href={latestUpdateUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="app-updates-item-title"
                  >
                    <span className="app-updates-item-tag">{latestUpdate.tag}</span>
                    <span>{latestUpdate.title}</span>
                  </a>
                ) : (
                  <div className="app-updates-item-title">
                    <span className="app-updates-item-tag">{latestUpdate.tag}</span>
                    <span>{latestUpdate.title}</span>
                  </div>
                )}
                <small className="text-muted">{formatUpdateDate(latestUpdate.publishedAt)}</small>
                {latestUpdate.body && (
                  <p className="app-updates-item-body">{truncatePreview(latestUpdate.body, 180, '')}</p>
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
            {!updatesLoading && !updatesError && hasBlockedUrls && (
              <p className="app-updates-stale-note">
                安全でないリンクを検出したため、一部のリンク表示を無効化しました。
              </p>
            )}
            {!updatesLoading && !updatesError && historicalUpdates.length > 0 && (
              <div className="app-updates-history">
                <AppButton
                  type="button"
                  variant="link"
                  className="app-updates-history-toggle"
                  onClick={onHistoryToggle}
                  aria-expanded={historyOpen}
                  aria-controls="app-updates-history-list"
                >
                  {historyOpen ? '履歴を閉じる' : '過去のアップデート履歴を表示'}
                </AppButton>
                <Collapse in={historyOpen} mountOnEnter unmountOnExit>
                  <div
                    id="app-updates-history-list"
                    className="app-updates-history-list"
                    role="region"
                    aria-label="過去のアップデート履歴"
                  >
                    <ul className="app-updates-list">
                      {historicalUpdates.map((item) => {
                        const safeUrl = trustedRepository
                          ? sanitizeReleaseUrl(item.url, trustedRepository)
                          : null;
                        return (
                          <li key={item.id} className="app-updates-list-item">
                            {safeUrl ? (
                              <a
                                href={safeUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="app-updates-item-title"
                              >
                                <span className="app-updates-item-tag">{item.tag}</span>
                                <span>{item.title}</span>
                              </a>
                            ) : (
                              <div className="app-updates-item-title">
                                <span className="app-updates-item-tag">{item.tag}</span>
                                <span>{item.title}</span>
                              </div>
                            )}
                            <small className="text-muted">{formatUpdateDate(item.publishedAt)}</small>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </Collapse>
              </div>
            )}
          </Popover.Body>
        </Popover>
      )}
    >
      <AppButton
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
      </AppButton>
    </OverlayTrigger>
  );
}
