import { type ReactNode, type Ref } from 'react';

interface CameraViewportProps {
  videoRef: Ref<HTMLVideoElement>;
  canvasRef: Ref<HTMLCanvasElement>;
  cameraActive: boolean;
  cameraError: string;
  /**
   * モバイルでカメラを全画面表示するかどうか
   * true の場合、position: fixed で画面全体を覆う
   */
  fullscreen?: boolean;
  /**
   * フルスクリーン時にビデオの上に描画するオーバーレイ（ビューファインダー等）
   */
  children?: ReactNode;
}

/**
 * カメラ映像表示コンポーネント
 * モバイルファースト設計: fullscreen=true で全画面カメラ表示
 */
export default function CameraViewport({
  videoRef,
  canvasRef,
  cameraActive,
  cameraError,
  fullscreen = false,
  children,
}: CameraViewportProps) {
  const containerStyle = fullscreen
    ? {
        position: 'fixed' as const,
        inset: 0,
        zIndex: 100,
        backgroundColor: '#111',
        display: 'flex',
        flexDirection: 'column' as const,
      }
    : {
        maxWidth: 480,
        position: 'relative' as const,
      };

  const videoStyle = fullscreen
    ? {
        width: '100%',
        height: '100%',
        objectFit: 'cover' as const,
        backgroundColor: '#111',
      }
    : {
        width: '100%',
        minHeight: 220,
        borderRadius: 8,
        border: '1px solid #dee2e6',
        backgroundColor: '#111',
      };

  return (
    <div className="camera-mobile-video" style={containerStyle}>
      <video
        ref={videoRef}
        muted
        playsInline
        autoPlay
        style={videoStyle}
      />
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* Viewfinder overlay slot (fullscreen only) */}
      {fullscreen && children}

      {cameraError && !fullscreen && (
        <div
          className="small text-warning mt-2"
          style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '0.5rem', backgroundColor: 'rgba(0,0,0,0.7)' }}
        >
          {cameraError}
        </div>
      )}
      {cameraError && fullscreen && (
        <div
          className="text-warning"
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            padding: '1rem',
            backgroundColor: 'rgba(0,0,0,0.8)',
            borderRadius: 8,
            textAlign: 'center',
          }}
        >
          {cameraError}
        </div>
      )}
      {!cameraActive && !cameraError && fullscreen && (
        <div
          className="text-light"
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            textAlign: 'center',
          }}
        >
          <div className="mb-2">カメラを開始してください</div>
        </div>
      )}
    </div>
  );
}
