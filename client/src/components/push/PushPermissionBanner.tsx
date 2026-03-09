import { Alert, Button } from 'react-bootstrap';
import { usePushSubscription } from '../../hooks/usePushSubscription';

/**
 * プッシュ通知許可バナー
 * - PushManager非対応: 非表示
 * - 許可未設定: 「プッシュ通知を有効にする」を表示
 * - 許可済み: 非表示
 * - 拒否済み: ブラウザ設定案内を表示
 */
export default function PushPermissionBanner() {
  const { permissionState, subscribing, error, subscribe } = usePushSubscription();

  // 非対応 or ロード中 or 許可済み → 非表示
  if (permissionState === 'unsupported' || permissionState === 'loading' || permissionState === 'granted') {
    return null;
  }

  // 拒否済み: ブラウザ設定案内
  if (permissionState === 'denied') {
    return (
      <Alert variant="secondary" className="mb-3">
        <Alert.Heading as="h6" className="mb-1">プッシュ通知がブロックされています</Alert.Heading>
        <small>
          ブラウザの設定からこのサイトの通知を許可してください。
          設定 → サイトの権限 → 通知 で変更できます。
        </small>
      </Alert>
    );
  }

  // 未設定: 購読促進バナー
  return (
    <Alert variant="info" className="mb-3">
      <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
        <div>
          <strong>プッシュ通知を有効にする</strong>
          <br />
          <small className="text-muted">
            マッチング候補やアラートの通知をリアルタイムで受け取れます。
          </small>
        </div>
        <Button
          variant="primary"
          size="sm"
          disabled={subscribing}
          onClick={() => void subscribe()}
        >
          {subscribing ? '設定中...' : '有効にする'}
        </Button>
      </div>
      {error && <div className="text-danger small mt-2">{error}</div>}
    </Alert>
  );
}
