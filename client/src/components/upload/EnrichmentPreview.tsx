import { useState, useCallback, useRef } from 'react';
import { api, ApiError } from '../../api/client';
import AppAlert from '../ui/AppAlert';
import AppButton from '../ui/AppButton';

interface EnrichmentSummary {
  total: number;
  matched: number;
  fuzzy: number;
  unmatched: number;
}

interface UnmatchedRow {
  index: number;
  drugName: string;
  drugCode: string | null;
  matchConfidence: 'none' | 'fuzzy';
}

interface MasterCandidate {
  drugMasterId: number;
  drugName: string;
  yjCode: string;
  yakkaPrice: number;
  unit: string | null;
  matchType: string;
}

interface EnrichmentPreviewProps {
  previewRows: unknown[][];
  mapping: Record<string, number | null>;
}

export default function EnrichmentPreview({ previewRows, mapping }: EnrichmentPreviewProps) {
  const [summary, setSummary] = useState<EnrichmentSummary | null>(null);
  const [unmatchedRows, setUnmatchedRows] = useState<UnmatchedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [candidateMap, setCandidateMap] = useState<Map<number, MasterCandidate[]>>(new Map());
  const [loadingCandidates, setLoadingCandidates] = useState<Set<number>>(new Set());
  const loadingCandidatesRef = useRef(loadingCandidates);
  loadingCandidatesRef.current = loadingCandidates;

  const drugNameIdx = mapping.drug_name;
  const drugCodeIdx = mapping.drug_code;
  const unitIdx = mapping.unit;

  const handleCheck = useCallback(async () => {
    if (drugNameIdx === null || drugNameIdx === undefined) return;
    setLoading(true);
    setError('');
    try {
      const rows = previewRows.map((row) => ({
        drugName: row[drugNameIdx] != null ? String(row[drugNameIdx]).trim() : '',
        drugCode: drugCodeIdx != null && row[drugCodeIdx] != null ? String(row[drugCodeIdx]).trim() : null,
        unit: unitIdx != null && row[unitIdx] != null ? String(row[unitIdx]).trim() : null,
      })).filter((r) => r.drugName.length > 0);

      const result = await api.post<{ summary: EnrichmentSummary; unmatchedRows: UnmatchedRow[] }>(
        '/upload/enrich-preview',
        { rows },
      );
      setSummary(result.summary);
      setUnmatchedRows(result.unmatchedRows);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'チェックに失敗しました');
    } finally {
      setLoading(false);
    }
  }, [previewRows, drugNameIdx, drugCodeIdx, unitIdx]);

  const handleSearchCandidates = useCallback(async (rowIndex: number, drugName: string) => {
    if (loadingCandidatesRef.current.has(rowIndex)) return;
    setLoadingCandidates((prev) => new Set(prev).add(rowIndex));
    try {
      const result = await api.get<{ candidates: MasterCandidate[] }>(
        `/upload/master-candidates?drugName=${encodeURIComponent(drugName)}`,
      );
      setCandidateMap((prev) => {
        const next = new Map(prev);
        next.set(rowIndex, result.candidates);
        return next;
      });
    } catch {
      // ignore
    } finally {
      setLoadingCandidates((prev) => {
        const next = new Set(prev);
        next.delete(rowIndex);
        return next;
      });
    }
  }, []);

  return (
    <div className="mb-3">
      <div className="d-flex align-items-center gap-2 mb-2">
        <AppButton
          variant="outline-info"
          size="sm"
          onClick={() => void handleCheck()}
          disabled={loading || drugNameIdx === null || drugNameIdx === undefined}
        >
          {loading ? 'チェック中...' : 'マスター紐付けチェック'}
        </AppButton>
        {summary && (
          <span className="small text-muted">
            紐付け済み: {summary.matched}/{summary.total}件
            {summary.unmatched > 0 && (
              <span className="text-warning ms-1">（未紐付け: {summary.unmatched}件）</span>
            )}
          </span>
        )}
      </div>

      {error && <AppAlert variant="danger" className="small">{error}</AppAlert>}

      {summary && summary.unmatched === 0 && (
        <AppAlert variant="success" className="small">
          全行がマスターに紐付けされています。薬価・単位・包装形態が自動設定されます。
        </AppAlert>
      )}

      {unmatchedRows.length > 0 && (
        <div className="border rounded p-2">
          <div className="small fw-bold text-warning mb-2">
            以下の {unmatchedRows.length} 件がマスター未紐付けです。薬品コードの入力、または推奨候補からの選択を推奨します。
          </div>
          <div className="table-responsive" style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table className="table table-sm table-bordered mb-0">
              <thead className="table-light">
                <tr>
                  <th className="small" style={{ width: 50 }}>行</th>
                  <th className="small">薬品名</th>
                  <th className="small" style={{ width: 120 }}>薬品コード</th>
                  <th className="small" style={{ width: 120 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {unmatchedRows.map((row) => (
                  <tr key={row.index}>
                    <td className="small">{row.index + 1}</td>
                    <td className="small">{row.drugName}</td>
                    <td className="small text-muted">{row.drugCode || '（なし）'}</td>
                    <td className="small">
                      <button
                        type="button"
                        className="btn btn-outline-primary btn-sm"
                        disabled={loadingCandidates.has(row.index)}
                        onClick={() => void handleSearchCandidates(row.index, row.drugName)}
                      >
                        {loadingCandidates.has(row.index) ? '検索中...' : '候補を検索'}
                      </button>
                    </td>
                  </tr>
                ))}
                {unmatchedRows.map((row) => {
                  const candidates = candidateMap.get(row.index);
                  if (!candidates || candidates.length === 0) return null;
                  return (
                    <tr key={`candidates-${row.index}`}>
                      <td colSpan={4} className="small bg-light p-2">
                        <div className="fw-bold mb-1">「{row.drugName}」の推奨候補:</div>
                        {candidates.map((c, ci) => (
                          <div key={ci} className="d-flex align-items-center gap-2 mb-1 ps-2">
                            <span className="badge bg-info text-dark">{c.matchType === 'exact_name' ? '完全一致' : '類似'}</span>
                            <span>{c.drugName}</span>
                            <span className="text-muted">YJ:{c.yjCode}</span>
                            <span className="text-muted">¥{c.yakkaPrice}</span>
                            {c.unit && <span className="text-muted">({c.unit})</span>}
                          </div>
                        ))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
