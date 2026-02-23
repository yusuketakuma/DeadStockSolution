import { useState, useEffect } from 'react';
import { Alert, Container, Spinner } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { api } from '../api/client';

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
    return (
      <Container className="d-flex justify-content-center py-5">
        <Spinner animation="border" variant="primary" />
      </Container>
    );
  }

  if (!uploaded) {
    return (
      <Alert variant="warning">
        マッチング機能を利用するには、当月の使用薬剤Excelをアップロードする必要があります。
        <Link to="/upload" className="alert-link ms-2">アップロードページへ</Link>
      </Alert>
    );
  }

  return <>{children}</>;
}
