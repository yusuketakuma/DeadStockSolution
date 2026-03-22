import { type ChangeEvent, useCallback, useEffect, useRef } from 'react';
import { Badge } from 'react-bootstrap';
import type { DraftRow } from '../../hooks/useCameraDraftRows';
import { daysUntilExpiry } from '../../utils/expiry-risk';
import AppAlert from '../ui/AppAlert';
import AppButton from '../ui/AppButton';
import AppControl from '../ui/AppControl';

const AUTO_DISMISS_MS = 3000;
const QUANTITY_STEP = '0.001';

interface ScanResultSheetProps {
  /** シートの表示状態 */
  open: boolean;
  /** 最新のスキャン結果行 */
  latestRow: DraftRow | null;
  /** 合計行数 */
  totalCount: number;
  /** シートを閉じる */
  onClose: () => void;
  /** 一覧確認（フルスクリーン終了） */
  onViewAll: () => void;
  /** 最後のスキャンを元に戻す */
  onUndo: () => void;
  /** フィールド変更（数量・使用期限・ロット番号） */
  onFieldChange: (rowId: number, field: 'quantity' | 'expirationDate' | 'lotNumber', value: string) => void;
  /** 次のスキャンへ進む（シート閉じ + カメラ継続） */
  onContinueScan: () => void;
}

/**
 * リッチスキャン結果ボトムシート
 * - 薬品名を大きく表示
 * - 使用期限・ロットの自動取得/手動入力を明確に区別
 * - 期限切れ/期限間近の警告
 * - シート内で数量入力（ステッパー付き）
 * - 元に戻す / 次をスキャン アクション
 */
export default function ScanResultSheet({
  open,
  latestRow,
  totalCount,
  onClose,
  onViewAll,
  onUndo,
  onFieldChange,
  onContinueScan,
}: ScanResultSheetProps) {
  const autoDismissRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const touchedRef = useRef(false);

  // Auto-dismiss for resolved items
  useEffect(() => {
    clearTimeout(autoDismissRef.current);
    touchedRef.current = false;
    if (open && latestRow?.status === 'resolved') {
      autoDismissRef.current = setTimeout(() => {
        if (!touchedRef.current) {
          onContinueScan();
        }
      }, AUTO_DISMISS_MS);
    }
    return () => clearTimeout(autoDismissRef.current);
  }, [open, latestRow?.id, latestRow?.status, onContinueScan]);

  const cancelAutoDismiss = useCallback(() => {
    touchedRef.current = true;
    clearTimeout(autoDismissRef.current);
  }, []);

  const isResolved = latestRow?.status === 'resolved';
  const expiryDays = latestRow?.expirationDate ? daysUntilExpiry(latestRow.expirationDate) : null;
  const hasAutoExpiry = Boolean(latestRow?.expirationDate) && !latestRow?.warnings.some((w) => w.includes('使用期限'));
  const hasAutoLot = Boolean(latestRow?.lotNumber) && !latestRow?.warnings.some((w) => w.includes('ロット番号'));
  const allAutoFilled = hasAutoExpiry && hasAutoLot;

  const handleQuantityStep = (delta: number) => {
    if (!latestRow) return;
    cancelAutoDismiss();
    const current = Number(latestRow.quantity) || 0;
    const next = Math.max(0, current + delta);
    onFieldChange(latestRow.id, 'quantity', next === 0 ? '' : String(next));
  };

  return (
    <div
      className={`scan-result-sheet bottom-sheet${open ? ' open' : ''}`}
      onTouchStart={cancelAutoDismiss}
      onClick={cancelAutoDismiss}
    >
      {/* Drag handle */}
      <div className="bottom-sheet-handle" />

      {/* Header */}
      <div className="bottom-sheet-header">
        <h3 className="bottom-sheet-header-title">
          スキャン結果
          <Badge bg="secondary">{totalCount}件</Badge>
        </h3>
        <button
          type="button"
          className="bottom-sheet-close"
          aria-label="閉じる"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      {/* Content */}
      <div className="bottom-sheet-content">
        {latestRow && (
          <>
            {/* Drug name + status */}
            <div className="d-flex align-items-start justify-content-between gap-2 mb-2">
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="fw-bold" style={{ fontSize: '1.1rem' }}>
                  <span className={isResolved ? undefined : 'text-warning'}>
                    {latestRow.drugName || '医薬品未確定'}
                  </span>
                </div>
                {latestRow.packageLabel && (
                  <div className="small text-muted">{latestRow.packageLabel}</div>
                )}
                <div className="small text-muted text-truncate" title={latestRow.rawCode} style={{ maxWidth: '100%' }}>
                  {latestRow.rawCode}
                </div>
              </div>
              <Badge
                bg={isResolved ? 'success' : 'warning'}
                text={isResolved ? undefined : 'dark'}
                style={{ flexShrink: 0, fontSize: '0.8rem', padding: '6px 10px' }}
              >
                {isResolved ? '確定' : '要確認'}
              </Badge>
            </div>

            {/* Auto-fill data card */}
            <div className={`scan-autofill-card ${allAutoFilled ? 'scan-autofill-card--filled' : 'scan-autofill-card--partial'}`}>
              {/* Expiration date */}
              <div className="scan-autofill-row">
                <span className="scan-autofill-label">使用期限</span>
                <span className="scan-autofill-value">
                  {hasAutoExpiry ? (
                    latestRow.expirationDate
                  ) : (
                    <AppControl
                      type="date"
                      value={latestRow.expirationDate}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => {
                        cancelAutoDismiss();
                        onFieldChange(latestRow.id, 'expirationDate', e.currentTarget.value);
                      }}
                      aria-label="使用期限"
                      style={{ height: 36, fontSize: '0.875rem' }}
                    />
                  )}
                </span>
                <Badge
                  bg={hasAutoExpiry ? 'success' : 'warning'}
                  text={hasAutoExpiry ? undefined : 'dark'}
                  style={{ fontSize: '0.7rem', flexShrink: 0 }}
                >
                  {hasAutoExpiry ? '自動取得' : '手動入力'}
                </Badge>
              </div>

              {/* Lot number */}
              <div className="scan-autofill-row">
                <span className="scan-autofill-label">ロット</span>
                <span className="scan-autofill-value">
                  {hasAutoLot ? (
                    latestRow.lotNumber
                  ) : (
                    <AppControl
                      value={latestRow.lotNumber}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => {
                        cancelAutoDismiss();
                        onFieldChange(latestRow.id, 'lotNumber', e.currentTarget.value);
                      }}
                      aria-label="ロット番号"
                      placeholder="ロット番号"
                      maxLength={120}
                      autoCapitalize="off"
                      autoCorrect="off"
                      spellCheck={false}
                      style={{ height: 36, fontSize: '0.875rem' }}
                    />
                  )}
                </span>
                <Badge
                  bg={hasAutoLot ? 'success' : 'warning'}
                  text={hasAutoLot ? undefined : 'dark'}
                  style={{ fontSize: '0.7rem', flexShrink: 0 }}
                >
                  {hasAutoLot ? '自動取得' : '手動入力'}
                </Badge>
              </div>
            </div>

            {/* Expiry warnings */}
            {expiryDays !== null && expiryDays < 0 && (
              <AppAlert variant="danger" className="small py-2 mb-2">
                使用期限を過ぎています
              </AppAlert>
            )}
            {expiryDays !== null && expiryDays >= 0 && expiryDays <= 90 && (
              <AppAlert variant="warning" className="small py-2 mb-2">
                使用期限まで残り{expiryDays}日です
              </AppAlert>
            )}

            {/* Unmatched guidance */}
            {!isResolved && (
              <AppAlert variant="info" className="small py-2 mb-2">
                一覧画面で候補から医薬品を確定してください
              </AppAlert>
            )}

            {/* Quantity stepper */}
            <div className="mb-2">
              <div className="small text-muted mb-1">数量</div>
              <div className="scan-qty-stepper">
                <button
                  type="button"
                  className="scan-qty-stepper-btn"
                  onClick={() => handleQuantityStep(-1)}
                  disabled={!latestRow.quantity || Number(latestRow.quantity) <= 0}
                  aria-label="数量を減らす"
                >
                  −
                </button>
                <AppControl
                  type="number"
                  className="scan-qty-stepper-input"
                  value={latestRow.quantity}
                  min={QUANTITY_STEP}
                  step={QUANTITY_STEP}
                  inputMode="decimal"
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    cancelAutoDismiss();
                    onFieldChange(latestRow.id, 'quantity', e.currentTarget.value);
                  }}
                  aria-label="数量"
                  placeholder="0"
                />
                <button
                  type="button"
                  className="scan-qty-stepper-btn"
                  onClick={() => handleQuantityStep(1)}
                  aria-label="数量を増やす"
                >
                  +
                </button>
                {latestRow.unit && (
                  <span className="scan-qty-unit">{latestRow.unit}</span>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="bottom-sheet-footer">
        <AppButton
          variant="outline-secondary"
          size="sm"
          onClick={onUndo}
          disabled={!latestRow}
        >
          元に戻す
        </AppButton>
        <div className="d-flex gap-2">
          <AppButton
            variant="outline-primary"
            size="sm"
            onClick={onViewAll}
          >
            一覧確認 ({totalCount}件)
          </AppButton>
          <AppButton
            variant="primary"
            size="sm"
            onClick={onContinueScan}
          >
            次をスキャン →
          </AppButton>
        </div>
      </div>
    </div>
  );
}
