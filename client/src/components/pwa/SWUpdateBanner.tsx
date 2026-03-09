import { Alert, Button } from 'react-bootstrap';
import { useSWUpdate } from '../../hooks/useSWUpdate';

/**
 * Service Worker 更新通知バナー
 * registerType: 'prompt' 前提で、新しいSWが待機中のとき表示
 */
export default function SWUpdateBanner() {
  const { needsUpdate, updateSW } = useSWUpdate();

  if (!needsUpdate) return null;

  return (
    <Alert
      variant="info"
      className="sw-update-banner position-fixed bottom-0 start-50 translate-middle-x mb-3"
      style={{ zIndex: 1050, maxWidth: '480px', width: '90%' }}
    >
      <div className="d-flex align-items-center justify-content-between gap-2">
        <span>新しいバージョンがあります。更新しますか？</span>
        <Button variant="primary" size="sm" onClick={updateSW}>
          更新する
        </Button>
      </div>
    </Alert>
  );
}
