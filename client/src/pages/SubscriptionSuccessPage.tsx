import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import AppCard from '../components/ui/AppCard';
import AppAlert from '../components/ui/AppAlert';
import InlineLoader from '../components/ui/InlineLoader';
import { getSubscriptionOverview, getSubscriptionPlanName, type SubscriptionRecord } from '../api/subscriptions';

type SyncState = 'idle' | 'checking' | 'synced' | 'timeout' | 'error';

export default function SubscriptionSuccessPage() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id');
  const [syncState, setSyncState] = useState<SyncState>(sessionId ? 'checking' : 'idle');
  const [activeSubscription, setActiveSubscription] = useState<SubscriptionRecord | null>(null);
  const [error, setError] = useState('');

  const syncMessage = useMemo(() => {
    if (syncState === 'synced' && activeSubscription) {
      return `${getSubscriptionPlanName(activeSubscription.planType)} の反映を確認しました。`;
    }
    if (syncState === 'timeout') {
      return '決済は完了していますが、契約反映に少し時間がかかっています。数分後にアカウント設定をご確認ください。';
    }
    if (syncState === 'error') {
      return error || '契約状況の確認に失敗しました。';
    }
    return 'プラン反映を確認しています。通常は数分以内に更新されます。';
  }, [activeSubscription, error, syncState]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    let cancelled = false;
    let attempts = 0;

    const poll = async () => {
      setSyncState('checking');
      while (!cancelled && attempts < 10) {
        attempts += 1;
        try {
          const result = await getSubscriptionOverview();
          if (cancelled) return;
          if (result.activeSubscription) {
            setActiveSubscription(result.activeSubscription);
            setSyncState('synced');
            return;
          }
        } catch (err) {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : '契約状況の取得に失敗しました');
          setSyncState('error');
          return;
        }

        await new Promise((resolve) => window.setTimeout(resolve, 3000));
      }

      if (!cancelled) {
        setSyncState('timeout');
      }
    };

    void poll();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return (
    <div className="container mt-4" style={{ maxWidth: 720 }}>
      <AppCard>
        <AppCard.Header>決済が完了しました</AppCard.Header>
        <AppCard.Body>
          <AppAlert variant="success">
            サブスクリプション登録ありがとうございます。決済手続きが正常に完了しました。
          </AppAlert>

          {syncState === 'checking' && <InlineLoader text="契約反映を確認中..." className="text-muted small mb-2" />}
          <AppAlert variant={syncState === 'synced' ? 'success' : syncState === 'error' ? 'danger' : 'info'}>
            {syncMessage}
          </AppAlert>
          {sessionId && (
            <p className="text-muted small mb-3">
              受付ID: <code>{sessionId}</code>
            </p>
          )}

          <div className="dl-action-row mobile-stack">
            <Link to="/" className="btn btn-primary">ダッシュボードへ</Link>
            <Link to="/account" className="btn btn-outline-secondary">アカウント設定へ</Link>
          </div>
        </AppCard.Body>
      </AppCard>
    </div>
  );
}
