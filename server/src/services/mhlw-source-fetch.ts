/**
 * MHLW ソースファイルの更新チェック・ダウンロード共通ロジック
 *
 * drug-master-scheduler / drug-package-scheduler が共有する
 * checkForUpdates / downloadFile を一元化。
 */
import { downloadResponseBuffer, fetchWithTimeout, MHLW_MAX_DOWNLOAD_SIZE, MHLW_FETCH_TIMEOUT_MS, type FetchDispatcher } from '../utils/http-utils';
import { getSourceState } from './drug-master-source-state-service';
import { decideSourceUpdate } from './source-update-detection';

export interface CheckForUpdatesResult {
  hasUpdate: boolean;
  etag: string | null;
  lastModified: string | null;
  contentType: string | null;
  compareByContentHash: boolean;
  previousContentHash: string | null;
}

/**
 * HEAD リクエストでサイトの更新を検知する。
 * ETag / Last-Modified の変化を DB 永続化された前回状態と比較。
 */
export async function checkForUpdates(
  url: string,
  dispatcher: FetchDispatcher,
  opts: {
    sourceKey: string;
    retries: number;
    headers: Record<string, string>;
  },
): Promise<CheckForUpdatesResult> {
  const response = await fetchWithTimeout(url, {
    method: 'HEAD',
    timeoutMs: 30_000,
    retry: { retries: opts.retries },
    redirect: 'manual',
    dispatcher,
    headers: opts.headers,
  });

  if (response.status >= 300 && response.status < 400) {
    throw new Error(`Redirect response is not allowed for source URL: ${response.status}`);
  }

  if (!response.ok) {
    throw new Error(`HEAD request failed: ${response.status} ${response.statusText}`);
  }

  const etag = response.headers.get('etag');
  const lastModified = response.headers.get('last-modified');
  const contentType = response.headers.get('content-type');

  const prevState = await getSourceState(opts.sourceKey);
  const decision = decideSourceUpdate(prevState, { etag, lastModified });
  return {
    hasUpdate: decision.shouldDownload,
    etag,
    lastModified,
    contentType,
    compareByContentHash: decision.compareByContentHash,
    previousContentHash: prevState?.contentHash ?? null,
  };
}

/**
 * ファイルをダウンロードしてバッファとして取得。
 */
export async function downloadFile(
  url: string,
  dispatcher: FetchDispatcher,
  opts: {
    retries: number;
    headers: Record<string, string>;
  },
): Promise<{ buffer: Buffer; contentType: string | null }> {
  const response = await fetchWithTimeout(url, {
    timeoutMs: MHLW_FETCH_TIMEOUT_MS,
    retry: { retries: opts.retries },
    redirect: 'manual',
    dispatcher,
    headers: opts.headers,
  });

  if (response.status >= 300 && response.status < 400) {
    throw new Error(`Redirect response is not allowed for source URL: ${response.status}`);
  }

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type');
  const buffer = await downloadResponseBuffer(response, MHLW_MAX_DOWNLOAD_SIZE);

  return { buffer, contentType };
}
