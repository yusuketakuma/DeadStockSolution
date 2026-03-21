import { Badge } from 'react-bootstrap';
import type { DraftRow } from '../../hooks/useCameraDraftRows';

interface ScanResultSheetProps {
  /**
   * 最新のスキャン結果行
   * 未指定の場合はシートを表示しない
   */
  latestRow: DraftRow | null;
  /**
   * シートを閉じるコールバック
   */
  onClose: () => void;
  /**
   * 行数（ヘッダー表示用）
   */
  totalCount: number;
  /**
   * 一覧を開くコールバック
   */
  onViewAll?: () => void;
}

/**
 * スキャン結果をボトムシート形式で表示するコンポーネント
 * モバイルファースト設計: 画面下部からスライドアップ
 */
export default function ScanResultSheet({
  latestRow,
  onClose,
  totalCount,
  onViewAll,
}: ScanResultSheetProps) {
  if (!latestRow) {
    return null;
  }

  const isResolved = latestRow.status === 'resolved';

  return (
    <div
      className="scan-result-sheet"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 110,
        backgroundColor: '#fff',
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        boxShadow: '0 -4px 20px rgba(0,0,0,0.15)',
        paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))',
        maxHeight: '40vh',
        overflowY: 'auto' as const,
      }}
    >
      {/* ドラッグハンドル */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          padding: '0.5rem 0',
        }}
      >
        <div
          style={{
            width: 40,
            height: 4,
            backgroundColor: '#dee2e6',
            borderRadius: 2,
          }}
        />
      </div>

      {/* ヘッダー */}
      <div
        className="d-flex justify-content-between align-items-center px-3 pb-2"
        style={{ borderBottom: '1px solid #dee2e6' }}
      >
        <div className="d-flex align-items-center gap-2">
          <span className="fw-bold">読取結果</span>
          <Badge bg="secondary">{totalCount}件</Badge>
        </div>
        <div className="d-flex gap-2">
          {onViewAll && (
            <button
              type="button"
              className="btn btn-link btn-sm p-0"
              onClick={onViewAll}
            >
              一覧
            </button>
          )}
          <button
            type="button"
            className="btn-close"
            aria-label="閉じる"
            onClick={onClose}
            style={{ fontSize: '0.75rem' }}
          />
        </div>
      </div>

      {/* 最新スキャン結果 */}
      <div className="p-3">
        <div className="small text-muted mb-1">最新追加</div>
        <div className="d-flex align-items-start justify-content-between gap-2">
          <div className="flex-grow-1" style={{ minWidth: 0 }}>
            <div
              className="fw-bold text-truncate"
              title={latestRow.drugName || '未確定'}
            >
              {latestRow.drugName || '医薬品未確定'}
            </div>
            <div className="small text-muted text-truncate" title={latestRow.rawCode}>
              {latestRow.rawCode}
            </div>
            {(latestRow.packageLabel || latestRow.unit) && (
              <div className="small text-muted">
                {[
                  latestRow.packageLabel,
                  latestRow.unit ? `単位: ${latestRow.unit}` : '',
                ].filter(Boolean).join(' | ')}
              </div>
            )}
            {(latestRow.expirationDate || latestRow.lotNumber) && (
              <div className="small text-muted">
                {[
                  latestRow.expirationDate ? `使用期限: ${latestRow.expirationDate}` : '',
                  latestRow.lotNumber ? `ロット: ${latestRow.lotNumber}` : '',
                ].filter(Boolean).join(' | ')}
              </div>
            )}
          </div>
          <Badge bg={isResolved ? 'success' : 'warning'}>
            {isResolved ? '確定' : '要確認'}
          </Badge>
        </div>

        {latestRow.warnings.length > 0 && (
          <div className="small text-warning mt-2">
            {latestRow.warnings.join(' / ')}
          </div>
        )}

        {!isResolved && (
          <div className="small text-info mt-2">
            候補から医薬品を選択してください
          </div>
        )}
      </div>
    </div>
  );
}
