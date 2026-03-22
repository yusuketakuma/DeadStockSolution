import { Badge } from 'react-bootstrap';

interface ScanStatsBarProps {
  resolvedCount: number;
  unmatchedCount: number;
  totalCount: number;
  soundEnabled: boolean;
  onToggleSound: () => void;
}

/**
 * カメラフルスクリーン上部の統計バー
 * 確定数/合計 + 要確認数 + サウンドトグル
 */
export default function ScanStatsBar({
  resolvedCount,
  unmatchedCount,
  totalCount,
  soundEnabled,
  onToggleSound,
}: ScanStatsBarProps) {
  return (
    <div className="scan-stats-bar">
      {totalCount > 0 && (
        <>
          <Badge bg="success" className="scan-stats-resolved">
            {resolvedCount}/{totalCount} 確定
          </Badge>
          {unmatchedCount > 0 && (
            <Badge bg="warning" text="dark" className="scan-stats-unmatched">
              {unmatchedCount} 要確認
            </Badge>
          )}
        </>
      )}
      <button
        type="button"
        className="scan-stats-sound-btn"
        onClick={onToggleSound}
        aria-label={soundEnabled ? 'サウンドをオフ' : 'サウンドをオン'}
      >
        <i className={soundEnabled ? 'bi bi-volume-up-fill' : 'bi bi-volume-mute-fill'} />
      </button>
    </div>
  );
}
