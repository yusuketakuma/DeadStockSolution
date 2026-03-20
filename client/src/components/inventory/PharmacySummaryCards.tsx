import { Card, Badge, Button } from 'react-bootstrap';

interface PharmacySummary {
  pharmacyId: number;
  pharmacyName: string;
  matchedCount: number;
  totalDrugs: number;
  totalYakka: number;
  distance: number | null;
  businessStatus: { isOpen: boolean; message: string; isConfigured: boolean };
  isFavorite: boolean;
  isGroupMember: boolean;
}

interface Props {
  summaries: PharmacySummary[];
  onPropose: (pharmacyId: number) => void;
}

export default function PharmacySummaryCards({ summaries, onPropose }: Props) {
  const fullMatch = summaries.filter(s => s.matchedCount === s.totalDrugs);
  const partialMatch = summaries.filter(s => s.matchedCount < s.totalDrugs);

  return (
    <div>
      {fullMatch.length > 0 && (
        <div className="mb-3">
          <h6 className="text-success mb-2">すべて揃う薬局</h6>
          {fullMatch.map(s => (
            <PharmacyCard key={s.pharmacyId} summary={s} onPropose={onPropose} />
          ))}
        </div>
      )}
      {partialMatch.length > 0 && (
        <div className="mb-3">
          <h6 className="text-warning mb-2">一部揃う薬局</h6>
          {partialMatch.map(s => (
            <PharmacyCard key={s.pharmacyId} summary={s} onPropose={onPropose} />
          ))}
        </div>
      )}
    </div>
  );
}

function PharmacyCard({ summary: s, onPropose }: { summary: PharmacySummary; onPropose: (id: number) => void }) {
  return (
    <Card className="mb-2">
      <Card.Body className="d-flex justify-content-between align-items-center py-2">
        <div>
          <div className="fw-bold">
            {s.pharmacyName}
            {s.isFavorite && <Badge bg="warning" className="ms-1">★</Badge>}
            {s.isGroupMember && <Badge bg="info" className="ms-1">グループ</Badge>}
          </div>
          <small className="text-muted">
            {s.matchedCount}/{s.totalDrugs}品目
            {' '}合計¥{s.totalYakka.toLocaleString()}
            {s.distance != null && ` ${s.distance}km`}
          </small>
          <div>
            <Badge bg={s.businessStatus.isOpen ? 'success' : 'secondary'} className="mt-1">
              {s.businessStatus.isOpen ? '営業中' : '営業時間外'}
            </Badge>
          </div>
        </div>
        <Button size="sm" variant="outline-primary" onClick={() => onPropose(s.pharmacyId)}>
          提案する
        </Button>
      </Card.Body>
    </Card>
  );
}
