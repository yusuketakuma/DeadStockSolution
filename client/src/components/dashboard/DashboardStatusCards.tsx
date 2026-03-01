import { Row, Col, Badge } from 'react-bootstrap';
import AppAlert from '../ui/AppAlert';
import { Link } from 'react-router-dom';
import { UploadStatus } from './types';
import AppDataPanel from '../ui/AppDataPanel';
import { formatDateJa } from '../../utils/formatters';

interface Props {
  status: UploadStatus | null;
  userName: string | null | undefined;
}

export default function DashboardStatusCards({ status, userName }: Props) {
  return (
    <>
      <p>ようこそ、{userName} さん</p>

      <Row className="g-3">
        <Col md={6} lg={4}>
          <AppDataPanel>
              <div className="d-flex justify-content-between align-items-start">
                <h5 className="mb-0">デッドストックリスト</h5>
                {status?.lastDeadStockUpload && (
                  <small className="text-muted">最終: {formatDateJa(status.lastDeadStockUpload)}</small>
                )}
              </div>
              <div className="mt-2">
                {status?.deadStockUploaded
                  ? <Badge bg="success">アップロード済み</Badge>
                  : <Badge bg="secondary">未アップロード</Badge>}
              </div>
              <Link to="/upload" className="btn btn-outline-primary btn-sm">アップロード</Link>
              {' '}
              <Link to="/inventory/dead-stock" className="btn btn-outline-secondary btn-sm">一覧を見る</Link>
          </AppDataPanel>
        </Col>

        <Col md={6} lg={4}>
          <AppDataPanel>
              <div className="d-flex justify-content-between align-items-start">
                <h5 className="mb-0">医薬品使用量リスト</h5>
                {status?.lastUsedMedicationUpload && (
                  <small className="text-muted">最終: {formatDateJa(status.lastUsedMedicationUpload)}</small>
                )}
              </div>
              <div className="mt-2">
                {status?.usedMedicationUploaded
                  ? <Badge bg="success">当月アップロード済み</Badge>
                  : <Badge bg="warning" text="dark">当月未アップロード</Badge>}
              </div>
              <Link to="/upload" className="btn btn-outline-primary btn-sm">アップロード</Link>
              {' '}
              <Link to="/inventory/used-medication" className="btn btn-outline-secondary btn-sm">一覧を見る</Link>
          </AppDataPanel>
        </Col>

        <Col md={6} lg={4}>
          <AppDataPanel>
              <h5>マッチング</h5>
              <p>
                {status?.usedMedicationUploaded
                  ? 'デッドストックリストの交換先を検索できます'
                  : '医薬品使用量リストのアップロードが必要です'}
              </p>
              {status?.usedMedicationUploaded ? (
                <Link to="/matching" className="btn btn-sm btn-primary">
                  マッチングを実行
                </Link>
              ) : (
                <span className="btn btn-sm btn-secondary disabled">マッチングを実行</span>
              )}
          </AppDataPanel>
        </Col>

        <Col md={6} lg={4}>
          <AppDataPanel>
              <h5>在庫参照</h5>
              <p>全薬局の医薬品在庫を検索・閲覧</p>
              <Link to="/inventory/browse" className="btn btn-outline-primary btn-sm">在庫を検索</Link>
          </AppDataPanel>
        </Col>

        <Col md={6} lg={4}>
          <AppDataPanel>
              <h5>マッチング状況</h5>
              <p>仮マッチング・確定済みの一覧を確認</p>
              <Link to="/proposals" className="btn btn-outline-primary btn-sm">マッチング一覧</Link>
          </AppDataPanel>
        </Col>

        <Col md={6} lg={4}>
          <AppDataPanel>
              <h5>交換履歴</h5>
              <p>過去の交換記録を確認</p>
              <Link to="/exchange-history" className="btn btn-outline-primary btn-sm">履歴を見る</Link>
          </AppDataPanel>
        </Col>
      </Row>

      {!status?.usedMedicationUploaded && (
        <AppAlert variant="info" className="mt-3">
          マッチング機能を利用するには、当月の医薬品使用量Excelをアップロードしてください。
        </AppAlert>
      )}
    </>
  );
}
