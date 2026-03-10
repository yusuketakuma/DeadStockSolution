import { useSearchParams, useNavigate } from 'react-router-dom';
import AppCard from '../components/ui/AppCard';

export default function VerificationPendingPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const email = searchParams.get('email') || '';

  return (
    <div className="container mt-4" style={{ maxWidth: 600 }}>
      <AppCard>
        <AppCard.Header>アカウント審査中</AppCard.Header>
        <AppCard.Body>
          <p>登録申請を受け付けました。現在、薬局情報の審査を行っています。</p>
          <p>
            審査が完了しましたら{email ? <strong>{email}</strong> : 'ご登録のメールアドレス'}宛に
            メールでお知らせします。通常1営業日以内に完了します。
          </p>
          <div className="d-flex align-items-center mb-3">
            <div className="spinner-border spinner-border-sm me-2" role="status" />
            <span className="text-muted">審査中...</span>
          </div>
          <hr />
          <p className="text-muted small mb-2">
            承認済みの方はログインをお試しください。
          </p>
          <button className="btn btn-outline-primary" onClick={() => navigate('/login')}>
            ログインページへ
          </button>
        </AppCard.Body>
      </AppCard>
    </div>
  );
}
