import { useState, useEffect } from 'react';
import AppAlert from './ui/AppAlert';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import PageLoader from './ui/PageLoader';
import AppButton from './ui/AppButton';

interface UploadStatus {
  deadStockUploaded: boolean;
  usedMedicationUploaded: boolean;
}

interface Props {
  children: React.ReactNode;
}

export default function RequireUpload({ children }: Props) {
  const [status, setStatus] = useState<UploadStatus | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.get<UploadStatus>('/upload/status')
      .then((data) => setStatus(data))
      .catch(() => setStatus({ deadStockUploaded: false, usedMedicationUploaded: false }));
  }, []);

  if (status === null) {
    return <PageLoader />;
  }

  const missingDeadStock = !status.deadStockUploaded;
  const missingUsedMedication = !status.usedMedicationUploaded;

  if (missingDeadStock || missingUsedMedication) {
    const bothMissing = missingDeadStock && missingUsedMedication;

    return (
      <div className="p-3">
        {bothMissing ? (
          <AppAlert variant="warning" className="mb-2">
            <div className="d-flex align-items-start justify-content-between gap-2 flex-wrap">
              <div>
                <div className="fw-semibold mb-1">マッチングを利用するにはデータのアップロードが必要です</div>
                <ul className="mb-0 ps-3">
                  <li>デッドストックリスト</li>
                  <li>当月の医薬品使用量リスト</li>
                </ul>
              </div>
              <AppButton variant="warning" size="sm" onClick={() => { void navigate('/upload'); }}>
                アップロードページへ
              </AppButton>
            </div>
          </AppAlert>
        ) : (
          <>
            {missingDeadStock && (
              <AppAlert variant="warning" className="d-flex align-items-center justify-content-between gap-2 flex-wrap mb-2">
                <span>マッチング機能を利用するには、デッドストックリストをアップロードしてください。</span>
                <AppButton variant="warning" size="sm" onClick={() => { void navigate('/upload'); }}>
                  アップロードページへ
                </AppButton>
              </AppAlert>
            )}
            {missingUsedMedication && (
              <AppAlert variant="warning" className="d-flex align-items-center justify-content-between gap-2 flex-wrap mb-2">
                <span>マッチング機能を利用するには、当月の医薬品使用量をアップロードしてください。</span>
                <AppButton variant="warning" size="sm" onClick={() => { void navigate('/upload'); }}>
                  アップロードページへ
                </AppButton>
              </AppAlert>
            )}
          </>
        )}
      </div>
    );
  }

  return <>{children}</>;
}
