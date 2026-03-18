import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';

interface SwipeCoachingOverlayProps {
  featureKey: string;
  message?: string;
}

function getStorageKey(userId: number | undefined, featureKey: string): string {
  return `swipe-coaching-${userId ?? 'anon'}-${featureKey}`;
}

export default function SwipeCoachingOverlay({
  featureKey,
  message = '\u2190 \u5DE6\u30B9\u30EF\u30A4\u30D7\u3067\u62D2\u5426 / \u53F3\u30B9\u30EF\u30A4\u30D7\u3067\u627F\u8A8D \u2192',
}: SwipeCoachingOverlayProps) {
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const key = getStorageKey(user?.id, featureKey);
    try {
      if (!localStorage.getItem(key)) {
        setVisible(true);
      }
    } catch {
      // localStorage unavailable - don't show overlay
    }
  }, [user?.id, featureKey]);

  const handleDismiss = useCallback(() => {
    const key = getStorageKey(user?.id, featureKey);
    try {
      localStorage.setItem(key, '1');
    } catch {
      // ignore
    }
    setVisible(false);
  }, [user?.id, featureKey]);

  if (!visible) return null;

  return (
    <div
      onClick={handleDismiss}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') handleDismiss(); }}
      tabIndex={0}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1070,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)',
        animation: 'swipe-coaching-fadein 200ms ease-out',
        cursor: 'pointer',
      }}
      role="dialog"
      aria-modal="true"
      aria-label="スワイプ操作ガイド"
    >
      <div
        style={{
          color: '#fff',
          fontSize: '1.125rem',
          fontWeight: 600,
          textAlign: 'center',
          padding: '24px 32px',
          maxWidth: '90vw',
          lineHeight: 1.6,
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <span
            style={{
              display: 'inline-block',
              animation: 'swipe-coaching-arrow 1.5s ease-in-out infinite',
            }}
          >
            {message}
          </span>
        </div>
        <div style={{ fontSize: '0.8125rem', opacity: 0.7 }}>
          タップして閉じる
        </div>
      </div>

      <style>{`
        @keyframes swipe-coaching-fadein {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes swipe-coaching-arrow {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-10px); }
          75% { transform: translateX(10px); }
        }
        @media (prefers-reduced-motion: reduce) {
          @keyframes swipe-coaching-fadein {
            from { opacity: 1; }
            to { opacity: 1; }
          }
          @keyframes swipe-coaching-arrow {
            0%, 100% { transform: translateX(0); }
          }
        }
      `}</style>
    </div>
  );
}
