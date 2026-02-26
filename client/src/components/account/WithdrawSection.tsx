import { Form } from 'react-bootstrap';
import AppCard from '../ui/AppCard';
import LoadingButton from '../ui/LoadingButton';
import AppControl from '../ui/AppControl';

interface WithdrawSectionProps {
  withdrawPassword: string;
  withdrawing: boolean;
  onPasswordChange: (value: string) => void;
  onWithdraw: () => void;
}

export default function WithdrawSection({ withdrawPassword, withdrawing, onPasswordChange, onWithdraw }: WithdrawSectionProps) {
  return (
    <AppCard className="mt-3 border-danger">
      <AppCard.Header className="bg-danger-subtle text-danger-emphasis">退会</AppCard.Header>
      <AppCard.Body>
        <p className="small mb-3">
          退会するとアカウントは無効化され、ログインできなくなります。再利用する場合は管理者へお問い合わせください。
        </p>
        <Form.Group className="mb-3 form-max-360">
          <Form.Label>現在のパスワード</Form.Label>
          <AppControl
            type="password"
            value={withdrawPassword}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onPasswordChange(e.target.value)}
            autoComplete="current-password"
          />
          <Form.Text className="text-muted">本人確認のため必須です</Form.Text>
        </Form.Group>
        <LoadingButton
          variant="outline-danger"
          onClick={onWithdraw}
          disabled={!withdrawPassword}
          loading={withdrawing}
          loadingLabel="処理中..."
        >
          退会する
        </LoadingButton>
      </AppCard.Body>
    </AppCard>
  );
}
