import { Link, useSearchParams } from 'react-router-dom';
import AppCard from '../components/ui/AppCard';
import AppAlert from '../components/ui/AppAlert';

export default function SubscriptionSuccessPage() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id');

  return (
    <div className="container mt-4" style={{ maxWidth: 720 }}>
      <AppCard>
        <AppCard.Header>決済が完了しました</AppCard.Header>
        <AppCard.Body>
          <AppAlert variant="success">
            サブスクリプション登録ありがとうございます。決済手続きが正常に完了しました。
          </AppAlert>

          <p className="mb-2">プランの反映には数分かかる場合があります。</p>
          {sessionId && (
            <p className="text-muted small mb-3">
              受付ID: <code>{sessionId}</code>
            </p>
          )}

          <div className="d-flex gap-2 flex-wrap">
            <Link to="/" className="btn btn-primary">ダッシュボードへ</Link>
            <Link to="/account" className="btn btn-outline-secondary">アカウント設定へ</Link>
          </div>
        </AppCard.Body>
      </AppCard>
    </div>
  );
}
