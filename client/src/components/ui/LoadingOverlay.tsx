import { Spinner } from 'react-bootstrap';
import type { ReactNode } from 'react';

interface LoadingOverlayProps {
  loading: boolean;
  children: ReactNode;
  text?: string;
}

/**
 * ローディング状態をオーバーレイ表示するコンポーネント
 * ページ全体またはセクションのローディング状態を統一的に表示
 */
export default function LoadingOverlay({ loading, children, text = '読み込み中...' }: LoadingOverlayProps) {
  return (
    <div className="position-relative">
      {children}
      {loading && (
        <div
          className="position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center bg-white bg-opacity-75"
          style={{ zIndex: 10, minHeight: '200px' }}
        >
          <div className="text-center">
            <Spinner animation="border" variant="primary" role="status">
              <span className="visually-hidden">{text}</span>
            </Spinner>
            <div className="mt-2 text-muted small">{text}</div>
          </div>
        </div>
      )}
    </div>
  );
}
