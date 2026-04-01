import { Row, Col } from 'react-bootstrap';
import AppDataPanel from '../../components/ui/AppDataPanel';
import type { PharmacyInfo } from './types';

interface ProposalPharmacyInfoProps {
  pharmacyA: PharmacyInfo;
  pharmacyB: PharmacyInfo;
}

export function ProposalPharmacyInfo({ pharmacyA, pharmacyB }: ProposalPharmacyInfoProps) {
  return (
    <Row className="g-3 mb-3">
      <Col md={6}>
        <AppDataPanel title={`${pharmacyA.name} (A)`} bodyClassName="small">
          <p>{pharmacyA.prefecture} {pharmacyA.address}</p>
          <p>TEL: {pharmacyA.phone} / FAX: {pharmacyA.fax}</p>
        </AppDataPanel>
      </Col>
      <Col md={6}>
        <AppDataPanel title={`${pharmacyB.name} (B)`} bodyClassName="small">
          <p>{pharmacyB.prefecture} {pharmacyB.address}</p>
          <p>TEL: {pharmacyB.phone} / FAX: {pharmacyB.fax}</p>
        </AppDataPanel>
      </Col>
    </Row>
  );
}
