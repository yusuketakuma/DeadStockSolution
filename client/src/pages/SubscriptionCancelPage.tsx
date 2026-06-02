import { Link } from 'react-router-dom';
import AppCard from '../components/ui/AppCard';
import AppAlert from '../components/ui/AppAlert';

export default function SubscriptionCancelPage() {
  return (
    <div className="container mt-4" style={{ maxWidth: 720 }}>
      <AppCard>
        <AppCard.Header>決済をキャンセルしました</AppCard.Header>
        <AppCard.Body>
          <AppAlert variant="warning">
            決済は完了していません。必要な場合は再度お申し込みください。
          </AppAlert>

          <p className="mb-3">ご不明点がある場合はサポートまでご連絡ください。</p>

          <div className="dl-action-row mobile-stack">
            <Link to="/account" className="btn btn-primary">アカウント設定へ戻る</Link>
            <Link to="/" className="btn btn-outline-secondary">ダッシュボードへ</Link>
          </div>
        </AppCard.Body>
      </AppCard>
    </div>
  );
}
