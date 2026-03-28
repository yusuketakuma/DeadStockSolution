import { Button, Form, Spinner } from 'react-bootstrap';
import AppDataPanel from '../ui/AppDataPanel';
import { usePushSubscription } from '../../hooks/usePushSubscription';
import { usePushNotificationPreferences } from '../../hooks/usePushNotificationPreferences';

/**
 * アカウントページ用プッシュ通知設定セクション
 * PushManagerが非対応の場合は何も表示しない
 */
export default function PushNotificationSettings() {
  const { permissionState, isSupported, subscribing, error, subscribe, unsubscribe } = usePushSubscription();
  const {
    preferences,
    loading,
    saving,
    error: preferencesError,
    updatePreferences,
  } = usePushNotificationPreferences(isSupported && permissionState !== 'unsupported' && permissionState !== 'loading');

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

      {(permissionState === 'prompt' || permissionState === 'granted') && (
        <div className="mt-3 border-top pt-3">
          <div className="d-flex align-items-center justify-content-between mb-2">
            <strong className="small">通知カテゴリ</strong>
            {(loading || saving) && <Spinner animation="border" size="sm" />}
          </div>
          <div className="small text-muted mb-2">
            提案・要望・コメントなど、受け取りたい push の種類を調整できます。
          </div>
          <div className="d-grid gap-2">
            <Form.Check
              type="switch"
              id="push-category-proposals"
              label="提案の受信・承認依頼"
              checked={preferences.categories.proposals}
              disabled={loading || saving}
              onChange={() => void updatePreferences({
                categories: { ...preferences.categories, proposals: !preferences.categories.proposals },
              })}
            />
            <Form.Check
              type="switch"
              id="push-category-requests"
              label="要望対応・返答依頼"
              checked={preferences.categories.requests}
              disabled={loading || saving}
              onChange={() => void updatePreferences({
                categories: { ...preferences.categories, requests: !preferences.categories.requests },
              })}
            />
            <Form.Check
              type="switch"
              id="push-category-comments"
              label="コメント・やり取り更新"
              checked={preferences.categories.comments}
              disabled={loading || saving}
              onChange={() => void updatePreferences({
                categories: { ...preferences.categories, comments: !preferences.categories.comments },
              })}
            />
            <Form.Check
              type="switch"
              id="push-category-matching"
              label="マッチング更新・再計算結果"
              checked={preferences.categories.matching}
              disabled={loading || saving}
              onChange={() => void updatePreferences({
                categories: { ...preferences.categories, matching: !preferences.categories.matching },
              })}
            />
            <Form.Check
              type="switch"
              id="push-category-groups"
              label="グループ招待・参加"
              checked={preferences.categories.groups}
              disabled={loading || saving}
              onChange={() => void updatePreferences({
                categories: { ...preferences.categories, groups: !preferences.categories.groups },
              })}
            />
            <Form.Check
              type="switch"
              id="push-category-alerts"
              label="期限・運用アラート"
              checked={preferences.categories.alerts}
              disabled={loading || saving}
              onChange={() => void updatePreferences({
                categories: { ...preferences.categories, alerts: !preferences.categories.alerts },
              })}
            />
            <Form.Check
              type="switch"
              id="push-category-admin"
              label="管理・システム通知"
              checked={preferences.categories.admin}
              disabled={loading || saving}
              onChange={() => void updatePreferences({
                categories: { ...preferences.categories, admin: !preferences.categories.admin },
              })}
            />
            <Form.Check
              type="switch"
              id="push-allow-critical"
              label="重要通知はカテゴリOFFでも受け取る"
              checked={preferences.allowCritical}
              disabled={loading || saving}
              onChange={() => void updatePreferences({ allowCritical: !preferences.allowCritical })}
            />
          </div>
        </div>
      )}

      {error && <p className="text-danger small mt-2 mb-0">{error}</p>}
      {preferencesError && <p className="text-danger small mt-2 mb-0">{preferencesError}</p>}
    </AppDataPanel>
  );
}
