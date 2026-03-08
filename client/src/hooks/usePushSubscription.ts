import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

/** Base64url → Uint8Array (for applicationServerKey) */
function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray.buffer as ArrayBuffer;
}

export type PushPermissionState = 'unsupported' | 'prompt' | 'granted' | 'denied' | 'loading';

function resolvePushPermissionState(subscription: PushSubscription | null): PushPermissionState {
  if (subscription) {
    return 'granted';
  }
  if (Notification.permission === 'denied') {
    return 'denied';
  }
  return 'prompt';
}

function buildPushSubscriptionPayload(subscription: PushSubscription) {
  const json = subscription.toJSON();
  return {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: json.keys?.p256dh ?? '',
      auth: json.keys?.auth ?? '',
    },
  };
}

interface UsePushSubscriptionReturn {
  /** 現在のプッシュ通知許可状態 */
  permissionState: PushPermissionState;
  /** プッシュ通知をサポートしているか */
  isSupported: boolean;
  /** 購読処理中か */
  subscribing: boolean;
  /** エラーメッセージ */
  error: string;
  /** プッシュ通知を購読する */
  subscribe: () => Promise<void>;
  /** プッシュ通知の購読を解除する */
  unsubscribe: () => Promise<void>;
}

export function usePushSubscription(): UsePushSubscriptionReturn {
  const [permissionState, setPermissionState] = useState<PushPermissionState>('loading');
  const [subscribing, setSubscribing] = useState(false);
  const [error, setError] = useState('');

  const isSupported = typeof window !== 'undefined'
    && 'PushManager' in window
    && 'serviceWorker' in navigator;

  // 初回: 現在の許可状態を確認
  useEffect(() => {
    if (!isSupported) {
      setPermissionState('unsupported');
      return;
    }

    const checkPermission = async () => {
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        setPermissionState(resolvePushPermissionState(subscription));
      } catch {
        setPermissionState('prompt');
      }
    };

    void checkPermission();
  }, [isSupported]);

  const subscribe = useCallback(async () => {
    if (!isSupported) return;
    setSubscribing(true);
    setError('');

    try {
      // 1. VAPID公開鍵を取得
      const { publicKey } = await api.get<{ publicKey: string }>('/push/vapid-public-key');

      // 2. SW registration を取得
      const registration = await navigator.serviceWorker.ready;

      // 3. プッシュ通知を購読
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      // 4. サーバーに購読情報を送信
      await api.post('/push/subscribe', buildPushSubscriptionPayload(subscription));

      setPermissionState('granted');
    } catch (err) {
      if (Notification.permission === 'denied') {
        setPermissionState('denied');
      } else {
        setError(err instanceof Error ? err.message : 'プッシュ通知の登録に失敗しました');
      }
    } finally {
      setSubscribing(false);
    }
  }, [isSupported]);

  const unsubscribe = useCallback(async () => {
    if (!isSupported) return;
    setSubscribing(true);
    setError('');

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        // サーバーから購読解除
        await api.delete('/push/subscribe', {
          endpoint: subscription.endpoint,
        });

        // ブラウザ側の購読解除
        await subscription.unsubscribe();
      }

      setPermissionState('prompt');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'プッシュ通知の解除に失敗しました');
    } finally {
      setSubscribing(false);
    }
  }, [isSupported]);

  return {
    permissionState,
    isSupported,
    subscribing,
    error,
    subscribe,
    unsubscribe,
  };
}
