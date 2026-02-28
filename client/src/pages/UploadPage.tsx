import { useState, useRef, useCallback, FormEvent, useEffect } from 'react';
import AppAlert from '../components/ui/AppAlert';
import { Form, ProgressBar } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, isApiErrorCode } from '../api/client';
import DraftRestoreAlert from '../components/DraftRestoreAlert';
import { useAutoSave } from '../hooks/useAutoSave';
import AppSelect from '../components/ui/AppSelect';
import LoadingButton from '../components/ui/LoadingButton';
import AppControl from '../components/ui/AppControl';
import AppCard from '../components/ui/AppCard';
import { useAuth } from '../contexts/AuthContext';
import { useAsyncState } from '../hooks/useAsyncState';

interface PreviewResponse {
  headers: string[];
  rows: string[][];
  suggestedMapping: Record<string, string | null>;
  headerRowIndex: number;
  hasSavedMapping: boolean;
}

interface DiffSummary {
  inserted: number;
  updated: number;
  deactivated: number;
  unchanged: number;
  totalIncoming: number;
}

interface UploadConfirmJobResult {
  uploadId: number;
  rowCount: number;
  applyMode: 'replace' | 'diff';
  deleteMissing?: boolean;
  diffSummary?: DiffSummary;
}

interface UploadConfirmAsyncResponse {
  message: string;
  jobId: number;
  status: 'pending' | 'processing';
}

interface UploadConfirmJobStatusResponse {
  id: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  lastError: string | null;
  lastErrorCode?: string | null;
  result: UploadConfirmJobResult | null;
}

const UPLOAD_CONFIRM_ENQUEUE_TIMEOUT_MS = 5 * 60 * 1000;
const UPLOAD_JOB_POLL_INTERVAL_MS = import.meta.env.MODE === 'test' ? 20 : 1500;
const UPLOAD_JOB_POLL_MAX_INTERVAL_MS = import.meta.env.MODE === 'test' ? 100 : 5000;
const UPLOAD_JOB_MAX_POLL_WAIT_MS = import.meta.env.MODE === 'test' ? 3000 : 60 * 60 * 1000;
const UPLOAD_JOB_POLL_TRANSIENT_RETRY_MAX = import.meta.env.MODE === 'test' ? 1 : 3;

function resolveNextPollIntervalMs(elapsedMs: number, status: 'pending' | 'processing'): number {
  if (status === 'processing') {
    return Math.min(2500, UPLOAD_JOB_POLL_MAX_INTERVAL_MS);
  }
  if (elapsedMs >= 5 * 60 * 1000) {
    return UPLOAD_JOB_POLL_MAX_INTERVAL_MS;
  }
  if (elapsedMs >= 60 * 1000) {
    return Math.min(3000, UPLOAD_JOB_POLL_MAX_INTERVAL_MS);
  }
  return UPLOAD_JOB_POLL_INTERVAL_MS;
}

function resolveTransientPollRetryIntervalMs(retryCount: number): number {
  if (import.meta.env.MODE === 'test') {
    return Math.min(UPLOAD_JOB_POLL_MAX_INTERVAL_MS, 20 * (retryCount + 1));
  }
  const base = Math.min(UPLOAD_JOB_POLL_MAX_INTERVAL_MS, 1000 * (2 ** Math.max(0, retryCount - 1)));
  const jitter = Math.floor(Math.random() * 300);
  return Math.min(UPLOAD_JOB_POLL_MAX_INTERVAL_MS, base + jitter);
}

function isTransientUploadJobPollingError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (err.status === 0) return true;
  return err.status === 429 || (err.status >= 500 && err.status <= 599);
}

async function waitForNextPoll(signal: AbortSignal, intervalMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const onAbort = () => {
      if (timer !== null) {
        clearTimeout(timer);
      }
      signal.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };

    timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, intervalMs);

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** カラムマッピング設定の自動保存対象 */
interface MappingDraftData {
  mapping: Record<string, string | null>;
  uploadType: 'dead_stock' | 'used_medication';
}

export default function UploadPage() {
  const { user } = useAuth();
  const [uploadType, setUploadType] = useState<'dead_stock' | 'used_medication'>('dead_stock');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const { loading, setLoading, error, setError, message, setMessage } = useAsyncState();
  const [showMatchingHint, setShowMatchingHint] = useState(false);
  const [applyMode, setApplyMode] = useState<'replace' | 'diff'>('replace');
  const [deleteMissing, setDeleteMissing] = useState(false);
  const [diffSummary, setDiffSummary] = useState<DiffSummary | null>(null);
  const [acknowledgeDeleteImpact, setAcknowledgeDeleteImpact] = useState(false);
  const [uploadJobId, setUploadJobId] = useState<number | null>(null);
  const [uploadJobStatus, setUploadJobStatus] = useState<'pending' | 'processing' | null>(null);
  const [uploadJobAttempts, setUploadJobAttempts] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const navigateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uploadRequestAbortRef = useRef<AbortController | null>(null);
  const navigate = useNavigate();

  // カラムマッピング設定の自動保存
  const mappingDraftData: MappingDraftData = { mapping, uploadType };
  const mappingAutoSave = useAutoSave<MappingDraftData>('upload-mapping', mappingDraftData, {
    userId: user?.id,
    enabled: Object.keys(mapping).length > 0,
  });

  const handleMappingDraftRestore = useCallback(() => {
    const draft = mappingAutoSave.restoreDraft();
    if (draft) {
      setMapping(draft.mapping);
      setUploadType(draft.uploadType);
    }
    mappingAutoSave.clearDraft();
  }, [mappingAutoSave]);

  const handleMappingDraftDiscard = useCallback(() => {
    mappingAutoSave.clearDraft();
  }, [mappingAutoSave]);

  const fieldLabels: Record<string, string> = {
    drug_code: 'YJコード / GS1コード',
    drug_name: '薬剤名',
    quantity: '数量',
    unit: '包装単位',
    yakka_unit_price: '薬価（単価）',
    expiration_date: '期限',
    lot_number: 'ロット番号',
    monthly_usage: '月間使用量',
  };

  const requiredFields: Record<string, Set<string>> = {
    dead_stock: new Set(['drug_code', 'drug_name', 'quantity', 'unit', 'expiration_date']),
    used_medication: new Set(['drug_name', 'monthly_usage']),
  };

  const isRequired = (field: string) => requiredFields[uploadType]?.has(field) ?? false;
  const missingRequiredFields = Array.from(requiredFields[uploadType] ?? []).filter((field) => !mapping[field]);
  const hasAllRequiredMappings = missingRequiredFields.length === 0;
  const requiresDeleteImpactAcknowledgement = applyMode === 'diff' && deleteMissing && (diffSummary?.deactivated ?? 0) > 0;
  const canSubmit = hasAllRequiredMappings && (!requiresDeleteImpactAcknowledgement || acknowledgeDeleteImpact);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    uploadRequestAbortRef.current?.abort();
    uploadRequestAbortRef.current = null;
    setLoading(false);
    const selected = e.target.files?.[0] || null;
    setFile(selected);
    setPreview(null);
    setMessage('');
    setError('');
    setShowMatchingHint(false);
    setApplyMode('replace');
    setDeleteMissing(false);
    setDiffSummary(null);
    setAcknowledgeDeleteImpact(false);
    setUploadJobId(null);
    setUploadJobStatus(null);
    setUploadJobAttempts(0);
  };

  const handlePreview = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;

    uploadRequestAbortRef.current?.abort();
    const controller = new AbortController();
    uploadRequestAbortRef.current = controller;

    setLoading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('uploadType', uploadType);

      const data = await api.upload<PreviewResponse>('/upload/preview', formData, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setPreview(data);
      setMapping(data.suggestedMapping);
      setDiffSummary(null);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : 'プレビューに失敗しました');
    } finally {
      if (uploadRequestAbortRef.current === controller) {
        uploadRequestAbortRef.current = null;
      }
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  };

  const handleConfirm = async () => {
    if (!file) return;
    if (!hasAllRequiredMappings) {
      const labels = missingRequiredFields.map((field) => fieldLabels[field] || field);
      setError(`必須項目が未割り当てです: ${labels.join('、')}`);
      return;
    }

    uploadRequestAbortRef.current?.abort();
    const controller = new AbortController();
    uploadRequestAbortRef.current = controller;
    const submittedUploadType = uploadType;

    setLoading(true);
    setError('');
    setMessage('');
    setShowMatchingHint(false);
    setUploadJobId(null);
    setUploadJobStatus(null);
    setUploadJobAttempts(0);
    let currentJobId: number | null = null;
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('uploadType', submittedUploadType);
      formData.append('mapping', JSON.stringify(mapping));
      formData.append('headerRowIndex', String(preview?.headerRowIndex ?? 0));
      formData.append('applyMode', applyMode);
      formData.append('deleteMissing', String(deleteMissing));

      const enqueueResult = await api.upload<UploadConfirmAsyncResponse>(
        '/upload/confirm-async',
        formData,
        {
          signal: controller.signal,
          timeout: UPLOAD_CONFIRM_ENQUEUE_TIMEOUT_MS,
        },
      );
      if (controller.signal.aborted) return;

      const { jobId } = enqueueResult;
      currentJobId = jobId;
      setUploadJobId(jobId);
      setUploadJobStatus(enqueueResult.status);
      setMessage(`${enqueueResult.message}（ジョブID: ${jobId}）`);

      const pollingStartedAt = Date.now();
      let completedResult: UploadConfirmJobResult | null = null;
      let transientPollFailures = 0;

      while (!controller.signal.aborted) {
        let job: UploadConfirmJobStatusResponse;
        try {
          job = await api.get<UploadConfirmJobStatusResponse>(`/upload/jobs/${jobId}`, {
            signal: controller.signal,
            timeout: 30000,
          });
        } catch (pollErr) {
          if (controller.signal.aborted) return;

          if (
            isTransientUploadJobPollingError(pollErr)
            && transientPollFailures < UPLOAD_JOB_POLL_TRANSIENT_RETRY_MAX
          ) {
            transientPollFailures += 1;
            const retryIntervalMs = resolveTransientPollRetryIntervalMs(transientPollFailures);
            await waitForNextPoll(controller.signal, retryIntervalMs);
            continue;
          }

          throw pollErr;
        }

        transientPollFailures = 0;
        if (controller.signal.aborted) return;
        setUploadJobAttempts(job.attempts);

        if (job.status === 'completed') {
          if (!job.result) {
            throw new Error('アップロード処理結果の取得に失敗しました');
          }
          completedResult = job.result;
          break;
        }
        if (job.status === 'failed') {
          throw new Error(job.lastError || 'アップロード処理に失敗しました');
        }

        setUploadJobStatus(job.status);

        if (Date.now() - pollingStartedAt > UPLOAD_JOB_MAX_POLL_WAIT_MS) {
          throw new Error(`アップロード処理の待機時間が長くなっています（ジョブID: ${jobId}）。時間をおいて再確認してください。`);
        }

        const elapsedMs = Date.now() - pollingStartedAt;
        const intervalMs = resolveNextPollIntervalMs(elapsedMs, job.status);
        await waitForNextPoll(controller.signal, intervalMs);
      }

      if (controller.signal.aborted) return;
      setUploadJobId(null);
      setUploadJobStatus(null);
      setUploadJobAttempts(0);
      setMessage(`${completedResult?.rowCount ?? 0}件のデータを登録しました マッチング候補の再計算と通知更新が反映されます。`);
      setDiffSummary(completedResult?.diffSummary ?? null);
      setShowMatchingHint(true);
      setPreview(null);
      setFile(null);
      mappingAutoSave.clearDraft();
      if (fileRef.current) fileRef.current.value = '';

      if (navigateTimerRef.current !== null) {
        clearTimeout(navigateTimerRef.current);
      }
      navigateTimerRef.current = setTimeout(() => {
        navigateTimerRef.current = null;
        navigate(submittedUploadType === 'dead_stock' ? '/inventory/dead-stock' : '/inventory/used-medication');
      }, 1200);
    } catch (err) {
      if (controller.signal.aborted) return;
      if (isApiErrorCode(err, 'UPLOAD_CONFIRM_QUEUE_LIMIT')) {
        setUploadJobId(null);
        setUploadJobStatus(null);
        setUploadJobAttempts(0);
        setMessage('');
        setError(err.message);
        return;
      }
      if (err instanceof Error && err.message.includes('待機時間が長くなっています')) {
        setError(err.message);
        setMessage(`ジョブは継続中の可能性があります（ジョブID: ${currentJobId ?? '不明'}）。時間をおいて再確認してください。`);
        return;
      }
      setUploadJobId(null);
      setUploadJobStatus(null);
      setUploadJobAttempts(0);
      setMessage('');
      setError(err instanceof Error ? err.message : '登録に失敗しました');
    } finally {
      if (uploadRequestAbortRef.current === controller) {
        uploadRequestAbortRef.current = null;
      }
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  };

  const handleDiffPreview = async () => {
    if (!file || !preview) return;
    if (applyMode !== 'diff') return;
    if (!hasAllRequiredMappings) {
      const labels = missingRequiredFields.map((field) => fieldLabels[field] || field);
      setError(`必須項目が未割り当てです: ${labels.join('、')}`);
      return;
    }

    uploadRequestAbortRef.current?.abort();
    const controller = new AbortController();
    uploadRequestAbortRef.current = controller;

    setLoading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('uploadType', uploadType);
      formData.append('mapping', JSON.stringify(mapping));
      formData.append('headerRowIndex', String(preview.headerRowIndex));
      formData.append('applyMode', 'diff');
      formData.append('deleteMissing', String(deleteMissing));

      const result = await api.upload<{ summary: DiffSummary }>('/upload/diff-preview', formData, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setDiffSummary(result.summary);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : '差分プレビューに失敗しました');
    } finally {
      if (uploadRequestAbortRef.current === controller) {
        uploadRequestAbortRef.current = null;
      }
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  };

  const handleMappingChange = (field: string, value: string) => {
    setMapping((prev) => ({ ...prev, [field]: value === '' ? null : value }));
  };

  useEffect(() => () => {
    if (navigateTimerRef.current !== null) {
      clearTimeout(navigateTimerRef.current);
      navigateTimerRef.current = null;
    }
    uploadRequestAbortRef.current?.abort();
    uploadRequestAbortRef.current = null;
  }, []);

  return (
    <div>
      <h4 className="page-title mb-3">Excelアップロード</h4>
      {error && <AppAlert variant="danger">{error}</AppAlert>}
      {message && <AppAlert variant="success">{message}</AppAlert>}
      {showMatchingHint && (
        <AppAlert variant="info">
          交換候補をすぐ確認する場合は「マッチング」ページで再実行してください。
        </AppAlert>
      )}
      {uploadJobId !== null && uploadJobStatus && (
        <AppAlert variant="info">
          非同期処理中です（ジョブID: {uploadJobId} / 状態: {uploadJobStatus === 'pending' ? '待機中' : '処理中'} / 試行回数: {uploadJobAttempts}）
        </AppAlert>
      )}

      {mappingAutoSave.hasDraft && !preview && (
        <DraftRestoreAlert
          draftTimestamp={mappingAutoSave.draftTimestamp}
          onRestore={handleMappingDraftRestore}
          onDiscard={handleMappingDraftDiscard}
        />
      )}

      <AppCard className="mb-3">
        <AppCard.Header>アップロード手順</AppCard.Header>
        <AppCard.Body>
          <ol className="mb-2 upload-step-list">
            <li>アップロードタイプを選択します（デッドストックリスト / 医薬品使用量リスト）。</li>
            <li><code>.xlsx</code> 形式のExcelファイルを選択します（最大50MB）。</li>
            <li>「プレビュー」を押してカラム自動判定を確認します。</li>
            <li>必要に応じてマッピングを修正し、「この設定でデータを登録」を押します。</li>
          </ol>
          <div className="small mt-2">
            <strong>必須項目（<span className="text-danger">赤字</span>）:</strong>
            {uploadType === 'dead_stock' ? (
              <div className="text-danger">YJコード / GS1コード、薬剤名、数量、包装単位、期限</div>
            ) : (
              <div className="text-danger">薬剤名、月間使用量</div>
            )}
          </div>
          <div className="small text-muted mt-1">
            見出し行が複数ある場合は、プレビュー結果を見て割当を調整してください。
          </div>
        </AppCard.Body>
      </AppCard>

      <AppCard className="mb-3">
        <AppCard.Body>
          <Form onSubmit={handlePreview}>
            <Form.Group className="mb-3" controlId="upload-type">
              <Form.Label>アップロードタイプ</Form.Label>
              <AppSelect
                controlId="upload-type"
                value={uploadType}
                ariaLabel="アップロードタイプ"
                disabled={loading}
                onChange={(value) => {
                  setUploadType(value as typeof uploadType);
                  setPreview(null);
                }}
                options={[
                  { value: 'dead_stock', label: 'デッドストックリスト' },
                  { value: 'used_medication', label: '医薬品使用量リスト' },
                ]}
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Excelファイル (.xlsx)</Form.Label>
              <AppControl
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={handleFileChange}
                ref={fileRef}
              />
            </Form.Group>

            <LoadingButton type="submit" variant="primary" disabled={!file} loading={loading} loadingLabel="プレビュー中...">
              プレビュー
            </LoadingButton>
          </Form>
        </AppCard.Body>
      </AppCard>

      {loading && <ProgressBar animated now={100} className="mb-3" />}

      {preview && (
        <AppCard className="mb-3">
          <AppCard.Header>
            カラムマッピング
            {preview.hasSavedMapping && <small className="text-muted ms-2">（前回のマッピングを適用）</small>}
          </AppCard.Header>
          <AppCard.Body>
            <p className="text-muted small">各カラムに対応するフィールドを選択してください。薬品名は必須です。</p>

            <div className="table-responsive mb-3">
              <table className="table table-sm table-bordered mobile-table">
                <thead>
                  <tr>
                    {preview.headers.map((header, headerIdx) => (
                      <th key={headerIdx} className="small">{header || `列${headerIdx + 1}`}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 3).map((row, rowIdx) => (
                    <tr key={rowIdx}>
                      {row.map((cell, cellIdx) => (
                        <td key={cellIdx} className="small">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h6>フィールド割り当て</h6>
            <div className="d-flex flex-column gap-2">
              {Object.entries(mapping).map(([field, colIdx]) => (
                <div key={field}>
                  <Form.Label htmlFor={`upload-mapping-${field}`} className={`small mb-1${isRequired(field) ? ' text-danger fw-semibold' : ''}`}>
                    {fieldLabels[field] || field}
                    {isRequired(field) && <span> *</span>}
                  </Form.Label>
                  <AppSelect
                    controlId={`upload-mapping-${field}`}
                    size="sm"
                    value={colIdx ?? ''}
                    ariaLabel={`${fieldLabels[field] || field} の割り当て`}
                    onChange={(value) => handleMappingChange(field, value)}
                    placeholder="（未選択）"
                    options={preview.headers.map((header, headerIdx) => ({
                      value: String(headerIdx),
                      label: header || `列${headerIdx + 1}`,
                    }))}
                  />
                </div>
              ))}
            </div>

            <hr />

            <Form.Group className="mb-2" controlId="upload-apply-mode">
              <Form.Label>反映方式</Form.Label>
              <AppSelect
                controlId="upload-apply-mode"
                value={applyMode}
                ariaLabel="反映方式"
                onChange={(value) => {
                  setApplyMode(value as 'replace' | 'diff');
                  setDiffSummary(null);
                  setAcknowledgeDeleteImpact(false);
                }}
                options={[
                  { value: 'replace', label: '置換（既定）' },
                  { value: 'diff', label: '差分反映' },
                ]}
              />
              <div className="small text-muted mt-1">既定は置換です。差分反映は明示的に選択した場合のみ有効です。</div>
            </Form.Group>

            {applyMode === 'diff' && (
              <Form.Group className="mb-2">
                <Form.Check
                  id="upload-delete-missing"
                  type="checkbox"
                  label="差分に存在しない既存データを無効化/削除する"
                  checked={deleteMissing}
                  onChange={(e) => {
                    setDeleteMissing(e.currentTarget.checked);
                    setAcknowledgeDeleteImpact(false);
                  }}
                />
                <div className="mt-2">
                  <LoadingButton
                    variant="outline-secondary"
                    size="sm"
                    onClick={handleDiffPreview}
                    loading={loading}
                    loadingLabel="差分比較中..."
                    disabled={!hasAllRequiredMappings}
                  >
                    差分プレビューを更新
                  </LoadingButton>
                </div>
              </Form.Group>
            )}

            {applyMode === 'diff' && diffSummary && (
              <AppAlert variant="info" className="small">
                追加: {diffSummary.inserted}件 / 更新: {diffSummary.updated}件 / 無効化・削除: {diffSummary.deactivated}件 / 変更なし: {diffSummary.unchanged}件
                {' '}（取込総数: {diffSummary.totalIncoming}件）
              </AppAlert>
            )}

            <div className="mt-3 mobile-stack">
              <LoadingButton
                variant="success"
                onClick={handleConfirm}
                disabled={!canSubmit}
                loading={loading}
                loadingLabel="登録中..."
              >
                この設定でデータを登録
              </LoadingButton>
              {requiresDeleteImpactAcknowledgement && (
                <div className="small text-warning mt-2">
                  <Form.Check
                    id="upload-delete-impact-ack"
                    type="checkbox"
                    label={`無効化・削除 ${diffSummary?.deactivated ?? 0} 件の影響を確認しました`}
                    checked={acknowledgeDeleteImpact}
                    onChange={(e) => setAcknowledgeDeleteImpact(e.currentTarget.checked)}
                  />
                </div>
              )}
              {!hasAllRequiredMappings && (
                <div className="small text-danger mt-2">
                  必須項目が未割り当てです。赤字項目をすべて選択してください。
                </div>
              )}
            </div>
          </AppCard.Body>
        </AppCard>
      )}
    </div>
  );
}
