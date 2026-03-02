/** Undici dispatcher type used with createPinnedDnsAgent */
export type FetchDispatcher = NonNullable<RequestInit['dispatcher']>;

/** MHLW ファイルダウンロード共通デフォルト */
export const MHLW_MAX_DOWNLOAD_SIZE = 100 * 1024 * 1024; // 100MB
export const MHLW_FETCH_TIMEOUT_MS = 120_000; // 2分（大きなファイル用）
export const MHLW_DEFAULT_FETCH_RETRIES = 2;

export class FetchTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FetchTimeoutError';
  }
}

interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryOnStatuses?: number[];
}

interface FetchWithTimeoutOptions extends RequestInit {
  timeoutMs: number;
  retry?: RetryOptions;
}

const DEFAULT_RETRYABLE_STATUSES = [408, 425, 429, 500, 502, 503, 504];
const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 5000;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeBackoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exp = Math.min(maxDelayMs, baseDelayMs * (2 ** Math.max(0, attempt - 1)));
  const jitter = Math.floor(Math.random() * Math.max(50, Math.floor(baseDelayMs / 2)));
  return Math.min(maxDelayMs, exp + jitter);
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function shouldRetryError(err: unknown): boolean {
  if (err instanceof FetchTimeoutError) return true;
  if (isAbortError(err)) return false;
  return err instanceof Error;
}

async function fetchOnceWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const externalSignal = options.signal;
  let timeoutTriggered = false;

  const abortExternal = () => {
    controller.abort(externalSignal?.reason);
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      abortExternal();
    } else {
      externalSignal.addEventListener('abort', abortExternal, { once: true });
    }
  }

  const timeout = setTimeout(() => {
    timeoutTriggered = true;
    controller.abort(new Error('timeout'));
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (err) {
    if (timeoutTriggered) {
      throw new FetchTimeoutError(`request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
    if (externalSignal) {
      externalSignal.removeEventListener('abort', abortExternal);
    }
  }
}

export async function fetchWithTimeout(url: string, options: FetchWithTimeoutOptions): Promise<Response> {
  const {
    timeoutMs,
    retry,
    ...requestInit
  } = options;

  const retries = Math.max(0, retry?.retries ?? 0);
  const baseDelayMs = Math.max(10, retry?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
  const maxDelayMs = Math.max(baseDelayMs, retry?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS);
  const retryOnStatuses = retry?.retryOnStatuses ?? DEFAULT_RETRYABLE_STATUSES;

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchOnceWithTimeout(url, requestInit, timeoutMs);
      if (attempt < retries && retryOnStatuses.includes(response.status)) {
        response.body?.cancel().catch(() => undefined);
        await sleep(computeBackoffDelay(attempt + 1, baseDelayMs, maxDelayMs));
        continue;
      }
      return response;
    } catch (err) {
      lastError = err;
      const externalSignalAborted = requestInit.signal?.aborted ?? false;
      if (externalSignalAborted) {
        throw err;
      }

      if (attempt >= retries || !shouldRetryError(err)) {
        throw err;
      }

      await sleep(computeBackoffDelay(attempt + 1, baseDelayMs, maxDelayMs));
    }
  }

  throw lastError instanceof Error ? lastError : new Error('request failed');
}

export function summarizeSourceUrl(sourceUrl: string): string {
  try {
    return new URL(sourceUrl).hostname;
  } catch {
    return sourceUrl.slice(0, 64);
  }
}

export async function downloadResponseBuffer(response: Response, maxDownloadSize: number): Promise<Buffer> {
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const size = Number(contentLength);
    if (Number.isFinite(size) && size > maxDownloadSize) {
      throw new Error(`File too large: ${size} bytes (max ${maxDownloadSize})`);
    }
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > maxDownloadSize) {
    throw new Error(`Downloaded file too large: ${arrayBuffer.byteLength} bytes (max ${maxDownloadSize})`);
  }

  return Buffer.from(arrayBuffer);
}
