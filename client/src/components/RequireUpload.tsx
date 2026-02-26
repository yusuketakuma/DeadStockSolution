import { useState, useEffect } from 'react';
import AppAlert from './ui/AppAlert';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import PageLoader from './ui/PageLoader';

interface Props {
  children: React.ReactNode;
}

export default function RequireUpload({ children }: Props) {
  const [uploaded, setUploaded] = useState<boolean | null>(null);

  useEffect(() => {
    api.get<{ usedMedicationUploaded: boolean }>('/upload/status')
      .then((data) => setUploaded(data.usedMedicationUploaded))
      .catch(() => setUploaded(false));
  }, []);

  if (uploaded === null) {
    return <PageLoader />;
  }

  if (!uploaded) {
    return (
      <AppAlert variant="warning">
        マッチング機能を利用するには、当月の医薬品使用量Excelをアップロードする必要があります。
        <Link to="/upload" className="alert-link ms-2">アップロードページへ</Link>
      </AppAlert>
    );
  }

  return <>{children}</>;
}
