export interface PreviousSourceStateLike {
  etag: string | null;
  lastModified: string | null;
}

export interface SourceHeaderSnapshot {
  etag: string | null;
  lastModified: string | null;
}

export interface SourceUpdateDecision {
  shouldDownload: boolean;
  compareByContentHash: boolean;
}

/**
 * 取得元が ETag / Last-Modified を返さない場合でも更新見逃しを防ぐため、
 * content-hash 比較フォールバックを有効化する。
 */
export function decideSourceUpdate(
  previous: PreviousSourceStateLike | null,
  current: SourceHeaderSnapshot,
): SourceUpdateDecision {
  const hasHeaders = Boolean(current.etag || current.lastModified);

  if (!hasHeaders) {
    return { shouldDownload: true, compareByContentHash: true };
  }

  const comparisons: boolean[] = [];

  if (current.etag !== null) {
    if (previous?.etag === null || previous === null) {
      return { shouldDownload: true, compareByContentHash: false };
    }
    comparisons.push(current.etag !== previous.etag);
  }

  if (current.lastModified !== null) {
    if (previous?.lastModified === null || previous === null) {
      return { shouldDownload: true, compareByContentHash: false };
    }
    comparisons.push(current.lastModified !== previous.lastModified);
  }

  return {
    shouldDownload: comparisons.some(Boolean),
    compareByContentHash: false,
  };
}
