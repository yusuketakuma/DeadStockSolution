import type { ScanFlashType } from '../../hooks/useScanFeedback';

interface ScanViewfinderProps {
  /** スキャナーが稼働中か */
  scanning: boolean;
  /** ビューファインダーのフラッシュタイプ (250ms間だけ非null) */
  flashType: ScanFlashType;
  /** ガイドテキスト */
  hintText: string;
}

/**
 * カメラ全画面時のビューファインダーオーバーレイ
 * 暗い周囲 + コーナーブラケット + スキャンライン + ガイドテキスト
 */
export default function ScanViewfinder({
  scanning,
  flashType,
  hintText,
}: ScanViewfinderProps) {
  const cutoutClass = [
    'viewfinder-cutout',
    flashType === 'success' ? 'viewfinder-cutout--success' : '',
    flashType === 'unmatched' ? 'viewfinder-cutout--unmatched' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="viewfinder-overlay">
      <div className={cutoutClass}>
        {/* Corner brackets */}
        <div className="viewfinder-corner viewfinder-corner--tl" />
        <div className="viewfinder-corner viewfinder-corner--tr" />
        <div className="viewfinder-corner viewfinder-corner--bl" />
        <div className="viewfinder-corner viewfinder-corner--br" />

        {/* Scan animation line */}
        {scanning && <div className="viewfinder-scanline" />}

        {/* Guide text */}
        <div className={`viewfinder-hint${hintText ? '' : ' viewfinder-hint--hidden'}`}>
          {hintText || '\u00A0'}
        </div>
      </div>
    </div>
  );
}
