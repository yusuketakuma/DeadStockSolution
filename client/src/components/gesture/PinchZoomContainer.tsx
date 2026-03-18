import type { ReactNode } from 'react';
import { usePinchZoom, type UsePinchZoomOptions } from '../../hooks/usePinchZoom';

interface PinchZoomContainerProps extends UsePinchZoomOptions {
  children: ReactNode;
  className?: string;
}

/**
 * ピンチズーム対応のコンテナコンポーネント。
 * 子要素をピンチ操作でズーム・ドラッグでき、ダブルタップで 1x⇔2x をトグルする。
 * isZoomed 時に右上にリセットボタン (×) を表示する。
 */
export default function PinchZoomContainer({
  children,
  className,
  minScale,
  maxScale,
}: PinchZoomContainerProps) {
  const { ref, scale, position, isZoomed, reset, bindGestures, handleDoubleClick } =
    usePinchZoom({ minScale, maxScale });

  return (
    <div style={{ position: 'relative', overflow: 'hidden' }} className={className}>
      <div
        ref={ref}
        {...bindGestures()}
        onDoubleClick={handleDoubleClick}
        style={{
          transform: `scale(${scale}) translate(${position.x}px, ${position.y}px)`,
          transformOrigin: 'center center',
          touchAction: isZoomed ? 'none' : 'auto',
          willChange: isZoomed ? 'transform' : undefined,
        }}
      >
        {children}
      </div>
      {isZoomed && (
        <button
          type="button"
          onClick={reset}
          aria-label="ズームリセット"
          style={{
            position: 'fixed',
            top: 16,
            right: 16,
            zIndex: 9999,
            width: 36,
            height: 36,
            borderRadius: '50%',
            border: 'none',
            background: 'rgba(0,0,0,0.6)',
            color: '#fff',
            fontSize: 18,
            lineHeight: 1,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          &times;
        </button>
      )}
    </div>
  );
}
