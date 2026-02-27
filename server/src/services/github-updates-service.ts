import { parseBooleanFlag, parseBoundedInt } from '../utils/number-utils';
import { logger } from './logger';
import { FetchTimeoutError, fetchWithTimeout } from '../utils/http-utils';

interface GitHubReleaseResponse {
  id: number;
  name: string | null;
  body: string | null;
  html_url: string;
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
}

export interface GitHubUpdateItem {
  id: string;
  tag: string;
  title: string;
  body: string;
  url: string;
  publishedAt: string | null;
  prerelease: boolean;
}

export interface GitHubUpdatesPayload {
  repository: string;
  source: 'github_releases';
  stale: boolean;
  fetchedAt: string;
  items: GitHubUpdateItem[];
}

interface CachedGitHubUpdates {
  repository: string;
  expiresAtMs: number;
  payload: GitHubUpdatesPayload;
}

const DEFAULT_REPOSITORY = 'yusuketakuma/DeadStockSolution';
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;
const MIN_CACHE_TTL_SECONDS = 30;
const MAX_CACHE_TTL_SECONDS = 3600;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 20_000;
const MIN_RETRIES = 0;
const MAX_RETRIES = 3;
const MAX_BODY_LENGTH = 2400;
const MAX_ERROR_BODY_LENGTH = 320;

let updatesCache: CachedGitHubUpdates | null = null;

function normalizeRepository(raw: string | undefined): string {
  const candidate = raw?.trim();
  if (!candidate) {
    return DEFAULT_REPOSITORY;
  }
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(candidate)) {
    return candidate;
  }
  logger.warn('Invalid GitHub repository config for updates. Falling back to default repository.', {
    configuredRepository: candidate,
    fallbackRepository: DEFAULT_REPOSITORY,
  });
  return DEFAULT_REPOSITORY;
}

function resolveRepository(): string {
  return normalizeRepository(
    process.env.GITHUB_UPDATES_REPOSITORY
      ?? process.env.GITHUB_REPOSITORY
      ?? undefined
  );
}

function resolveLimit(): number {
  return parseBoundedInt(process.env.GITHUB_UPDATES_LIMIT, 100, MIN_LIMIT, MAX_LIMIT);
}

function resolveCacheTtlMs(): number {
  const ttlSeconds = parseBoundedInt(
    process.env.GITHUB_UPDATES_CACHE_TTL_SECONDS,
    300,
    MIN_CACHE_TTL_SECONDS,
    MAX_CACHE_TTL_SECONDS,
  );
  return ttlSeconds * 1000;
}

function resolveTimeoutMs(): number {
  return parseBoundedInt(process.env.GITHUB_UPDATES_TIMEOUT_MS, 5000, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
}

function includePrerelease(): boolean {
  return parseBooleanFlag(process.env.GITHUB_UPDATES_INCLUDE_PRERELEASE, false);
}

function resolveRetries(): number {
  return parseBoundedInt(process.env.GITHUB_UPDATES_RETRIES, 1, MIN_RETRIES, MAX_RETRIES);
}

function normalizeBody(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.length > MAX_BODY_LENGTH ? `${trimmed.slice(0, MAX_BODY_LENGTH)}...` : trimmed;
}

function normalizeTitle(name: unknown, tag: string): string {
  if (typeof name === 'string' && name.trim()) {
    return name.trim();
  }
  return tag;
}

function parseRelease(item: unknown): GitHubUpdateItem | null {
  if (!item || typeof item !== 'object') return null;
  const release = item as Partial<GitHubReleaseResponse>;
  if (
    typeof release.id !== 'number'
    || typeof release.tag_name !== 'string'
    || typeof release.html_url !== 'string'
  ) {
    return null;
  }

  return {
    id: String(release.id),
    tag: release.tag_name,
    title: normalizeTitle(release.name, release.tag_name),
    body: normalizeBody(release.body),
    url: release.html_url,
    publishedAt: typeof release.published_at === 'string' ? release.published_at : null,
    prerelease: Boolean(release.prerelease),
  };
}

async function fetchGitHubReleaseUpdates(repository: string): Promise<GitHubUpdatesPayload> {
  const perPage = resolveLimit();
  const timeoutMs = resolveTimeoutMs();
  const retries = resolveRetries();
  const includePrereleaseReleases = includePrerelease();
  const token = process.env.GITHUB_UPDATES_TOKEN?.trim();
  const url = `https://api.github.com/repos/${repository}/releases?per_page=${perPage}`;

  try {
    const response = await fetchWithTimeout(url, {
      timeoutMs,
      retry: { retries },
      redirect: 'manual',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'DeadStockSolution/updates-widget',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    if (response.status >= 300 && response.status < 400) {
      throw new Error(`GitHub API redirect response is not allowed: ${response.status}`);
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      const compactError = errorBody.trim().slice(0, MAX_ERROR_BODY_LENGTH);
      throw new Error(`GitHub API ${response.status}${compactError ? `: ${compactError}` : ''}`);
    }

    const raw = await response.json() as unknown;
    if (!Array.isArray(raw)) {
      throw new Error('GitHub API returned a non-array releases response');
    }

    const releases = raw
      .filter((item): item is GitHubReleaseResponse => Boolean(item) && typeof item === 'object')
      .filter((item) => !item.draft)
      .filter((item) => includePrereleaseReleases || !item.prerelease)
      .map((item) => parseRelease(item))
      .filter((item): item is GitHubUpdateItem => item !== null)
      .slice(0, perPage);

    return {
      repository,
      source: 'github_releases',
      stale: false,
      fetchedAt: new Date().toISOString(),
      items: releases,
    };
  } catch (err) {
    if (err instanceof FetchTimeoutError || (err instanceof DOMException && err.name === 'AbortError')) {
      throw new Error(`GitHub updates request timed out after ${timeoutMs}ms`);
    }
    throw err;
  }
}

export async function getGitHubUpdates(): Promise<GitHubUpdatesPayload> {
  const repository = resolveRepository();
  const now = Date.now();
  if (
    updatesCache
    && updatesCache.repository === repository
    && updatesCache.expiresAtMs > now
  ) {
    return updatesCache.payload;
  }

  try {
    const payload = await fetchGitHubReleaseUpdates(repository);
    updatesCache = {
      repository,
      expiresAtMs: now + resolveCacheTtlMs(),
      payload,
    };
    return payload;
  } catch (err) {
    if (updatesCache && updatesCache.repository === repository) {
      logger.warn('GitHub updates fetch failed. Serving stale updates cache.', {
        repository,
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        ...updatesCache.payload,
        stale: true,
      };
    }
    throw err;
  }
}

export function resetGitHubUpdatesCacheForTests(): void {
  updatesCache = null;
}
