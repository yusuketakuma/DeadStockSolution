import { Col, Row } from 'react-bootstrap';
import AppKpiCard from '../../../components/ui/AppKpiCard';
import { formatDateTimeJa } from '../../../utils/formatters';

interface Stats {
  totalItems: number;
  listedItems: number;
  transitionItems: number;
  delistedItems: number;
  lastSyncAt: string | null;
}

interface DrugMasterStatsCardsProps {
  stats: Stats | null;
}

export default function DrugMasterStatsCards({ stats }: DrugMasterStatsCardsProps) {
  return (
    <Row className="g-3 mb-3">
      <Col md={4} xl>
        <AppKpiCard value={stats?.totalItems?.toLocaleString() ?? '-'} label="総品目数" />
      </Col>
      <Col md={4} xl>
        <AppKpiCard value={stats?.listedItems?.toLocaleString() ?? '-'} label="収載中" />
      </Col>
      <Col md={4} xl>
        <AppKpiCard value={stats?.transitionItems?.toLocaleString() ?? '-'} label="経過措置中" />
      </Col>
      <Col md={4} xl>
        <AppKpiCard value={stats?.delistedItems?.toLocaleString() ?? '-'} label="削除済" />
      </Col>
      <Col md={4} xl>
        <AppKpiCard
          value={stats?.lastSyncAt ? formatDateTimeJa(stats.lastSyncAt) : '未実行'}
          label="最終同期"
        />
      </Col>
    </Row>
  );
}
