import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import AppCard from '../components/ui/AppCard';
import AppAlert from '../components/ui/AppAlert';
import { api } from '../api/client';

export default function VerificationPendingPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const email = searchParams.get('email') || '';
  const [status, setStatus] = useState<string>('pending_verification');
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);

  useEffect(() => {
    if (!email) return;
    const interval = setInterval(async () => {
      try {
        const res = await api.get<{
          verificationStatus: string;
          rejectionReason: string | null;
        }>(`/auth/verification-status?email=${encodeURIComponent(email)}`);
        setStatus(res.verificationStatus);
        setRejectionReason(res.rejectionReason);
        if (res.verificationStatus === 'verified') {
          clearInterval(interval);
        }
      } catch { /* ignore polling errors */ }
    }, 10000);
    return () => clearInterval(interval);
  }, [email]);

  if (status === 'verified') {
    return (
      <div className="container mt-4" style={{ maxWidth: 600 }}>
        <AppAlert variant="success">
          アカウントが承認されました。ログインしてご利用ください。
        </AppAlert>
        <button className="btn btn-primary" onClick={() => navigate('/login')}>
          ログインページへ
        </button>
      </div>
    );
  }

  return (
    <div className="container mt-4" style={{ maxWidth: 600 }}>
      <AppCard>
        <AppCard.Header>アカウント審査中</AppCard.Header>
        <AppCard.Body>
          {status === 'rejected' ? (
            <AppAlert variant="danger">
              申請が却下されました。{rejectionReason && `理由: ${rejectionReason}`}
              <br />情報を修正して再度お申し込みください。
            </AppAlert>
          ) : (
            <>
              <p>登録申請を受け付けました。現在、薬局情報の審査を行っています。</p>
              <p>審査が完了しましたらメールでお知らせします。通常1営業日以内に完了します。</p>
              <div className="spinner-border spinner-border-sm me-2" role="status" />
              <span className="text-muted">審査中...</span>
            </>
          )}
        </AppCard.Body>
      </AppCard>
    </div>
  );
}
