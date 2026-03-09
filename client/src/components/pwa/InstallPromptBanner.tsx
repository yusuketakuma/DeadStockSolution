import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button } from 'react-bootstrap';

const SNOOZE_KEY = 'installPromptSnoozed';
const SNOOZE_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7日間

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function isSnoozed(): boolean {
  try {
    const snoozedAt = localStorage.getItem(SNOOZE_KEY);
    if (!snoozedAt) return false;
    const elapsed = Date.now() - Number(snoozedAt);
    return elapsed < SNOOZE_DURATION_MS;
  } catch {
    return false;
  }
}

/**
 * PWA インストール促進バナー
 * - beforeinstallprompt イベントをキャプチャ
 * - 「ホーム画面に追加」バナー表示
 * - 「あとで」で7日間スヌーズ
 */
export default function InstallPromptBanner() {
  const [show, setShow] = useState(false);
  const deferredPromptRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isSnoozed()) return;

    const handler = (e: Event) => {
      e.preventDefault();
      deferredPromptRef.current = e as BeforeInstallPromptEvent;
      setShow(true);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = useCallback(async () => {
    const prompt = deferredPromptRef.current;
    if (!prompt) return;

    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') {
      setShow(false);
    }
    deferredPromptRef.current = null;
  }, []);

  const handleSnooze = useCallback(() => {
    try {
      localStorage.setItem(SNOOZE_KEY, Date.now().toString());
    } catch {
      // localStorage unavailable
    }
    setShow(false);
    deferredPromptRef.current = null;
  }, []);

  if (!show) return null;

  return (
    <Alert
      variant="success"
      className="install-prompt-banner position-fixed bottom-0 start-50 translate-middle-x mb-3"
      style={{ zIndex: 1050, maxWidth: '480px', width: '90%' }}
    >
      <div className="d-flex align-items-center justify-content-between gap-2 flex-wrap">
        <span>ホーム画面に追加して素早くアクセスできます。</span>
        <div className="d-flex gap-2">
          <Button variant="outline-secondary" size="sm" onClick={handleSnooze}>
            あとで
          </Button>
          <Button variant="success" size="sm" onClick={() => void handleInstall()}>
            ホーム画面に追加
          </Button>
        </div>
      </div>
    </Alert>
  );
}
