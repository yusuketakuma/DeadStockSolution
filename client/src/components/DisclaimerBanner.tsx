import { Alert } from 'react-bootstrap';

export default function DisclaimerBanner() {
  return (
    <Alert variant="warning" className="mb-3 small">
      本システムはあくまで業務補助ツールであり、医薬品の交換に関する一切の責任を負いません。
      実際の医薬品のやり取りは薬局間で直接行ってください。
    </Alert>
  );
}
