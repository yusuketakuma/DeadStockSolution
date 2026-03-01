export type UploadType = 'dead_stock' | 'used_medication';

export type UploadApplyMode = 'replace' | 'diff' | 'partial';

export type UploadJobStatus =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'canceled';

export interface DiffSummary {
  inserted: number;
  updated: number;
  deactivated: number;
  unchanged: number;
  totalIncoming: number;
}

export interface PartialSummary {
  processed?: number;
  succeeded?: number;
  failed?: number;
  inspectedRows?: number;
  acceptedRows?: number;
  rejectedRows?: number;
  inserted?: number;
  updated?: number;
  deactivated?: number;
  unchanged?: number;
  totalIncoming?: number;
  issueCounts?: Record<string, number>;
  [key: string]: number | Record<string, number> | null | undefined;
}

export interface UploadConfirmJobResult {
  uploadId: number;
  rowCount: number;
  applyMode: UploadApplyMode;
  deleteMissing?: boolean;
  diffSummary?: DiffSummary;
  partialSummary?: PartialSummary | null;
  errorReportAvailable?: boolean;
  deduplicated?: boolean;
}

export interface UploadConfirmJobStatusResponse {
  id: number;
  status: UploadJobStatus;
  attempts: number;
  lastError: string | null;
  lastErrorCode?: string | null;
  result: UploadConfirmJobResult | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
  partialSummary?: PartialSummary | null;
  errorReportAvailable?: boolean;
  deduplicated?: boolean;
  cancelable?: boolean;
}

const PARTIAL_SUMMARY_LABELS: Record<string, string> = {
  processed: '処理済み',
  succeeded: '成功',
  failed: '失敗',
  inspectedRows: '検査行数',
  acceptedRows: '反映行数',
  rejectedRows: '失敗行数',
  inserted: '追加',
  updated: '更新',
  deactivated: '無効化・削除',
  unchanged: '変更なし',
  totalIncoming: '取込総数',
};

export function resolveUploadTypeLabel(uploadType: UploadType): string {
  return uploadType === 'dead_stock' ? 'デッドストックリスト' : '医薬品使用量リスト';
}

export function resolveUploadApplyModeLabel(applyMode: UploadApplyMode): string {
  if (applyMode === 'replace') return '置換';
  if (applyMode === 'diff') return '差分';
  return '部分反映';
}

export function resolveUploadJobStatusLabel(status: UploadJobStatus): string {
  if (status === 'pending') return '待機中';
  if (status === 'processing') return '処理中';
  if (status === 'completed') return '完了';
  if (status === 'failed') return '失敗';
  return 'キャンセル';
}

export function resolvePartialSummaryEntries(
  summary: PartialSummary | null | undefined,
): Array<{ key: string; label: string; value: number }> {
  if (!summary) return [];

  return Object.entries(summary)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))
    .map(([key, value]) => ({
      key,
      label: PARTIAL_SUMMARY_LABELS[key] ?? key,
      value,
    }));
}
