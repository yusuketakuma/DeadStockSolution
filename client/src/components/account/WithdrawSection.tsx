import { Button, Card, Form } from 'react-bootstrap';

interface WithdrawSectionProps {
  withdrawPassword: string;
  withdrawing: boolean;
  onPasswordChange: (value: string) => void;
  onWithdraw: () => void;
}

export default function WithdrawSection({ withdrawPassword, withdrawing, onPasswordChange, onWithdraw }: WithdrawSectionProps) {
  return (
    <Card className="mt-3 border-danger">
      <Card.Header className="bg-danger-subtle text-danger-emphasis">退会</Card.Header>
      <Card.Body>
        <p className="small mb-3">
          退会するとアカウントは無効化され、ログインできなくなります。再利用する場合は管理者へお問い合わせください。
        </p>
        <Form.Group className="mb-3 form-max-360">
          <Form.Label>現在のパスワード</Form.Label>
          <Form.Control
            type="password"
            value={withdrawPassword}
            onChange={(e) => onPasswordChange(e.target.value)}
            autoComplete="current-password"
          />
          <Form.Text className="text-muted">本人確認のため必須です</Form.Text>
        </Form.Group>
        <Button
          variant="outline-danger"
          onClick={onWithdraw}
          disabled={withdrawing || !withdrawPassword}
        >
          {withdrawing ? '処理中...' : '退会する'}
        </Button>
      </Card.Body>
    </Card>
  );
}
