import { type ChangeEvent, type KeyboardEvent } from 'react';
import { Badge, Form } from 'react-bootstrap';
import AppButton from '../ui/AppButton';
import AppControl from '../ui/AppControl';
import AppDropdownMenu from '../ui/AppDropdownMenu';
import LoadingButton from '../ui/LoadingButton';
import {
  type CameraManualCandidate,
  getManualCandidateKeywordValidationError,
  MAX_MANUAL_CANDIDATE_SEARCH_LENGTH,
  normalizeManualCandidateKeyword,
  resolveCandidateKey,
} from '../../hooks/useBarcodeResolver';
import type { DraftRow } from '../../hooks/useCameraDraftRows';

const MAX_CAMERA_CODE_INPUT_LENGTH = 500;
const MAX_PACKAGE_LABEL_LENGTH = 120;
const MAX_LOT_NUMBER_LENGTH = 120;
const QUANTITY_STEP = '0.001';

function mergeCandidateLists(candidates: CameraManualCandidate[]): CameraManualCandidate[] {
  const uniqueByKey = new Map<string, CameraManualCandidate>();
  for (const candidate of candidates) {
    const key = resolveCandidateKey(candidate);
    if (!uniqueByKey.has(key)) {
      uniqueByKey.set(key, candidate);
    }
  }
  return [...uniqueByKey.values()];
}

function resolveErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function resolveInitialCandidateKey(candidates: CameraManualCandidate[]): string {
  return candidates[0] ? resolveCandidateKey(candidates[0]) : '';
}

interface UnmatchedManualResolverProps {
  rowId: number;
  disabled: boolean;
  initialCandidates: CameraManualCandidate[];
  initialSearchKeyword: string;
  onSearchCandidates: (keyword: string) => Promise<CameraManualCandidate[]>;
  onApplyCandidate: (rowId: number, candidate: CameraManualCandidate) => void;
}

function UnmatchedManualResolver({
  rowId,
  disabled,
  initialCandidates,
  initialSearchKeyword,
  onSearchCandidates,
  onApplyCandidate,
}: UnmatchedManualResolverProps) {
  const [searchKeyword, setSearchKeyword] = useState(initialSearchKeyword);
  const [candidates, setCandidates] = useState<CameraManualCandidate[]>(initialCandidates);
  const [selectedCandidateKey, setSelectedCandidateKey] = useState(resolveInitialCandidateKey(initialCandidates));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const searchRequestIdRef = useRef(0);

  useEffect(() => {
    setCandidates(initialCandidates);
    setSelectedCandidateKey(resolveInitialCandidateKey(initialCandidates));
  }, [initialCandidates]);

  useEffect(() => {
    setSearchKeyword(initialSearchKeyword);
  }, [initialSearchKeyword]);

  const selectedCandidate = useMemo(() => (
    candidates.find((candidate) => resolveCandidateKey(candidate) === selectedCandidateKey) ?? null
  ), [candidates, selectedCandidateKey]);

  const handleSearch = async () => {
    const keyword = normalizeManualCandidateKeyword(searchKeyword);
    const validationError = getManualCandidateKeywordValidationError(keyword);
    if (validationError) {
      setError(validationError);
      return;
    }

    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;
    setLoading(true);
    setError('');
    try {
      const nextCandidates = await onSearchCandidates(keyword);
      if (searchRequestIdRef.current !== requestId) {
        return;
      }
      setCandidates((prev) => mergeCandidateLists([...prev, ...nextCandidates]));
      if (nextCandidates.length === 0) {
        setError('候補が見つかりませんでした。薬剤名やYJコードを変えて再検索してください。');
        return;
      }
      setSelectedCandidateKey(resolveCandidateKey(nextCandidates[0]));
    } catch (err) {
      if (searchRequestIdRef.current !== requestId) {
        return;
      }
      setError(resolveErrorMessage(err, '候補検索に失敗しました'));
    } finally {
      if (searchRequestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  };

  return (
    <div className="small">
      <div className="d-flex gap-1 mb-1">
        <AppControl
          value={searchKeyword}
          onChange={(event: ChangeEvent<HTMLInputElement>) => setSearchKeyword(event.currentTarget.value)}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void handleSearch();
            }
          }}
          aria-label="候補検索キーワード"
          maxLength={MAX_MANUAL_CANDIDATE_SEARCH_LENGTH}
          placeholder="薬剤名 or YJコードで検索"
        />
        <LoadingButton
          variant="outline-primary"
          size="sm"
          loading={loading}
          loadingLabel="検索中..."
          disabled={disabled}
          onClick={() => void handleSearch()}
        >
          候補検索
        </LoadingButton>
      </div>
      {candidates.length > 0 && (
        <div className="d-flex gap-1 align-items-center">
          <Form.Select
            size="sm"
            value={selectedCandidateKey}
            disabled={disabled}
            aria-label="候補医薬品"
            onChange={(event) => setSelectedCandidateKey(event.currentTarget.value)}
          >
            {candidates.map((candidate) => (
              <option key={resolveCandidateKey(candidate)} value={resolveCandidateKey(candidate)}>
                {candidate.drugName} ({candidate.yjCode ?? '-'})
              </option>
            ))}
          </Form.Select>
          <AppButton
            variant="outline-success"
            size="sm"
            disabled={disabled || selectedCandidate === null}
            onClick={() => {
              if (!selectedCandidate) return;
              onApplyCandidate(rowId, selectedCandidate);
            }}
          >
            確定
          </AppButton>
        </div>
      )}
      {error && <div className="text-danger mt-1">{error}</div>}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';

export interface DraftRowListProps {
  rows: DraftRow[];
  submitting: boolean;
  resolving: boolean;
  onRowRawCodeChange: (rowId: number, value: string) => void;
  onUpdateRowField: (rowId: number, field: 'packageLabel' | 'expirationDate' | 'lotNumber' | 'quantity', value: string) => void;
  onRemoveRow: (rowId: number) => void;
  onResolveCode: (code: string, rowId?: number, forceUpdate?: boolean) => Promise<unknown>;
  onSearchCandidates: (keyword: string) => Promise<CameraManualCandidate[]>;
  onApplyCandidate: (rowId: number, candidate: CameraManualCandidate) => void;
  /**
   * コンパクトモード（モバイル用）
   * true の場合、テーブルを簡略表示
   */
  compact?: boolean;
}

/**
 * ドラフト行一覧コンポーネント
 * スキャン結果のテーブル表示と操作
 */
export default function DraftRowList({
  rows,
  submitting,
  resolving,
  onRowRawCodeChange,
  onUpdateRowField,
  onRemoveRow,
  onResolveCode,
  onSearchCandidates,
  onApplyCandidate,
  compact = false,
}: DraftRowListProps) {
  if (rows.length === 0) {
    return (
      <div className="small text-muted">
        まだ読取結果がありません。カメラ読取またはコード入力で追加してください。
      </div>
    );
  }

  if (compact) {
    return (
      <div className="draft-row-list-compact">
        {rows.map((row) => (
          <div
            key={row.id}
            className="d-flex align-items-center justify-content-between p-2 border-bottom"
          >
            <div className="flex-grow-1" style={{ minWidth: 0 }}>
              <div className="fw-bold text-truncate">
                {row.drugName || '医薬品未確定'}
              </div>
              <div className="small text-muted text-truncate">{row.rawCode}</div>
            </div>
            <div className="d-flex align-items-center gap-2">
              <Badge bg={row.status === 'resolved' ? 'success' : 'warning'}>
                {row.status === 'resolved' ? '確定' : '要確認'}
              </Badge>
              <AppDropdownMenu
                label="行操作"
                variant="outline-secondary"
                items={[
                  {
                    key: `delete-${row.id}`,
                    label: '削除',
                    onClick: () => onRemoveRow(row.id),
                    danger: true,
                  },
                ]}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="table-responsive">
      <table className="table table-sm table-bordered mobile-table camera-mobile-table">
        <thead>
          <tr>
            <th>コード</th>
            <th>状態</th>
            <th>医薬品</th>
            <th>包装単位</th>
            <th>使用期限</th>
            <th>ロット</th>
            <th>数量</th>
            <th>単位</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td style={{ minWidth: 180 }}>
                <AppControl
                  value={row.rawCode}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    onRowRawCodeChange(row.id, event.currentTarget.value);
                  }}
                  maxLength={MAX_CAMERA_CODE_INPUT_LENGTH}
                  inputMode="text"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-label={`コード-${row.id}`}
                />
              </td>
              <td>
                <Badge bg={row.status === 'resolved' ? 'success' : 'warning'}>
                  {row.status === 'resolved'
                    ? (row.warnings.includes('手動で医薬品候補を確定しました。') ? '確定済み' : '自動確定')
                    : '候補確認待ち'}
                </Badge>
                {row.warnings.length > 0 && (
                  <div className="small text-muted mt-1">{row.warnings.join(' / ')}</div>
                )}
              </td>
              <td style={{ minWidth: 220 }}>
                {row.status === 'resolved' ? (
                  row.drugName || '-'
                ) : (
                  <UnmatchedManualResolver
                    rowId={row.id}
                    disabled={submitting || resolving}
                    initialCandidates={row.candidateOptions}
                    initialSearchKeyword={row.candidateSearchKeyword}
                    onSearchCandidates={onSearchCandidates}
                    onApplyCandidate={onApplyCandidate}
                  />
                )}
              </td>
              <td style={{ minWidth: 120 }}>
                <AppControl
                  value={row.packageLabel}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    onUpdateRowField(row.id, 'packageLabel', event.currentTarget.value);
                  }}
                  maxLength={MAX_PACKAGE_LABEL_LENGTH}
                  aria-label={`包装単位-${row.id}`}
                />
              </td>
              <td style={{ minWidth: 140 }}>
                <AppControl
                  type="date"
                  value={row.expirationDate}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    onUpdateRowField(row.id, 'expirationDate', event.currentTarget.value);
                  }}
                  aria-label={`使用期限-${row.id}`}
                />
              </td>
              <td style={{ minWidth: 120 }}>
                <AppControl
                  value={row.lotNumber}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    onUpdateRowField(row.id, 'lotNumber', event.currentTarget.value);
                  }}
                  maxLength={MAX_LOT_NUMBER_LENGTH}
                  inputMode="text"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-label={`ロット-${row.id}`}
                />
              </td>
              <td style={{ minWidth: 110 }}>
                <AppControl
                  type="number"
                  min={QUANTITY_STEP}
                  step={QUANTITY_STEP}
                  inputMode="decimal"
                  value={row.quantity}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    onUpdateRowField(row.id, 'quantity', event.currentTarget.value);
                  }}
                  aria-label={`数量-${row.id}`}
                />
              </td>
              <td>{row.unit || '-'}</td>
              <td>
                <div className="d-flex gap-1">
                  <LoadingButton
                    variant="outline-secondary"
                    size="sm"
                    loading={resolving}
                    loadingLabel="再解析中..."
                    onClick={() => void onResolveCode(row.rawCode, row.id, true)}
                  >
                    再解析
                  </LoadingButton>
                  <AppDropdownMenu
                    label="行操作"
                    variant="outline-secondary"
                    items={[
                      {
                        key: `delete-${row.id}`,
                        label: '削除',
                        onClick: () => onRemoveRow(row.id),
                        danger: true,
                      },
                    ]}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
