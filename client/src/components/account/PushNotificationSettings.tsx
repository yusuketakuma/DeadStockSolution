import { Button } from 'react-bootstrap';
import AppDataPanel from '../ui/AppDataPanel';
import { usePushSubscription } from '../../hooks/usePushSubscription';

/**
 * アカウントページ用プッシュ通知設定セクション
 * PushManagerが非対応の場合は何も表示しない
 */
export default function PushNotificationSettings() {
  const { permissionState, isSupported, subscribing, error, subscribe, unsubscribe } = usePushSubscription();

  // PushManager非対応→セクション自体を非表示
  if (!isSupported || permissionState === 'unsupported' || permissionState === 'loading') {
    return null;
  }

  return (
    <AppDataPanel title="プッシュ通知設定" className="mb-3">
      {permissionState === 'granted' && (
        <div>
          <p className="mb-2 text-success small">
            ✓ プッシュ通知は有効です
          </p>
          <Button
            variant="outline-danger"
            size="sm"
            disabled={subscribing}
            onClick={() => void unsubscribe()}
          >
            {subscribing ? '解除中...' : 'プッシュ通知を無効にする'}
          </Button>
        </div>
      )}

      {permissionState === 'prompt' && (
        <div>
          <p className="mb-2 text-muted small">
            プッシュ通知を有効にすると、マッチング候補やアラートをリアルタイムで受け取れます。
          </p>
          <Button
            variant="primary"
            size="sm"
            disabled={subscribing}
            onClick={() => void subscribe()}
          >
            {subscribing ? '設定中...' : 'プッシュ通知を有効にする'}
          </Button>
        </div>
      )}

      {permissionState === 'denied' && (
        <div>
          <p className="mb-2 text-warning small">
            プッシュ通知がブラウザでブロックされています。
          </p>
          <p className="mb-0 text-muted small">
            ブラウザの設定からこのサイトの通知を許可してください。
            設定 → サイトの権限 → 通知 で変更できます。
          </p>
        </div>
      )}

      {error && <p className="text-danger small mt-2 mb-0">{error}</p>}
    </AppDataPanel>
  );
}
